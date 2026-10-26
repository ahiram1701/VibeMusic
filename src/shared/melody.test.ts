import { describe, expect, it } from 'vitest'
import {
  alignLine,
  buildUstx,
  lineSyllables,
  melodyEndBeat,
  noteToMidi,
  parseNotes,
  placeMelody,
  syllables,
  vowelJoins
} from './melody'

describe('sílabas en español', () => {
  it.each([
    ['caminando', 'ca-mi-nan-do'],
    ['playa', 'pla-ya'],
    ['mañana', 'ma-ña-na'],
    ['amor', 'a-mor'],
    ['bailar', 'bai-lar'],
    ['corazón', 'co-ra-zón'],
    ['quiero', 'quie-ro'],
    ['guitarra', 'gui-ta-rra'],
    ['noche', 'no-che'],
    ['estrella', 'es-tre-lla'],
    ['instrumento', 'ins-tru-men-to'],
    ['poesía', 'po-e-sí-a'],
    ['día', 'dí-a'],
    ['canción', 'can-ción'],
    ['hoy', 'hoy'],
    ['construir', 'cons-truir'],
    ['¡Ay!', 'ay']
  ])('%s → %s', (word, expected) => {
    expect(syllables(word).join('-')).toBe(expected)
  })

  it('separa una frase en palabras con sus sílabas', () => {
    expect(lineSyllables('Ven a bailar, mi amor').map((w) => w.syllables.length)).toEqual([
      1, 1, 2, 1, 2
    ])
  })
})

describe('notas', () => {
  it('lee nombres de notas', () => {
    expect(noteToMidi('C4')).toBe(60)
    expect(noteToMidi('A4')).toBe(69)
    expect(noteToMidi('F#3')).toBe(54)
    expect(noteToMidi('Bb4')).toBe(70)
    expect(noteToMidi('H4')).toBeNull()
  })

  it('lee duraciones y silencios, y explica los errores', () => {
    expect(parseNotes('A4:0.5 B4 R:2')).toEqual([
      { midi: 69, beats: 0.5 },
      { midi: 71, beats: 1 },
      { midi: null, beats: 2 }
    ])
    expect(() => parseNotes('A4:0')).toThrow(/duración/)
    expect(() => parseNotes('do4')).toThrow(/no es una nota/)
  })

  it('una nota por sílaba: la palabra en la primera y "+" en las demás', () => {
    const { notes, beats } = alignLine(
      { text: 'Caminando por la playa', notes: 'A4:0.5 B4:0.5 C5:0.5 B4 R:0.5 A4 G4 A4 E4:2' },
      4,
      { strict: true }
    )
    expect(beats).toBe(8)
    expect(notes.map((n) => n.lyric)).toEqual([
      'caminando',
      '+',
      '+',
      '+',
      'por',
      'la',
      'playa',
      '+'
    ])
    expect(notes.map((n) => n.beat)).toEqual([4, 4.5, 5, 5.5, 7, 8, 9, 10])
  })

  it('acepta la sinalefa y la sinéresis, pero no menos notas que eso', () => {
    // 9 sílabas; cantando "ca-e" y "sobre el" se unen: con 8 notas vale.
    const luna = alignLine(
      { text: 'la luna cae sobre el mar', notes: 'A4 A4 B4 C5 B4 A4 G4 A4:2' },
      0,
      { strict: true }
    )
    expect(luna.notes).toHaveLength(9) // la nota más larga se parte en dos
    expect(luna.beats).toBe(9)
    expect(luna.notes.map((n) => n.lyric).slice(0, 4)).toEqual(['la', 'luna', '+', 'cae'])
    // 7 sílabas sin vocales que se toquen: con 6 notas no vale.
    expect(() =>
      alignLine({ text: 'quédate cerca de mí', notes: 'A4 B4 C5 B4 A4 G4' }, 0, { strict: true })
    ).toThrow(/tiene 7 sílabas \(qué-da-te cer-ca de mí\) y solo 6 notas/)
    expect(() =>
      alignLine({ text: 'la luna cae sobre el mar', notes: 'A4 B4 C5 B4 A4 G4' }, 0, {
        strict: true
      })
    ).toThrow(/9 sílabas .*, 7 uniendo las vocales que se tocan, y solo 6 notas/)
  })

  it('cuenta las vocales que se pueden unir al cantar', () => {
    expect(vowelJoins(lineSyllables('la luna cae sobre el mar'))).toBe(2)
    expect(vowelJoins(lineSyllables('mi amor y hoy'))).toBe(2) // "mi amor" y "y hoy"
    expect(vowelJoins(lineSyllables('caminando por la playa'))).toBe(0)
  })

  it('las notas de más alargan la última sílaba; las que faltan dan un error claro', () => {
    const extra = alignLine({ text: 'amor', notes: 'A4 G4 F4' }, 0, { strict: true })
    expect(extra.notes.map((n) => n.lyric)).toEqual(['amor', '+', '+'])
    expect(() => alignLine({ text: 'caminando', notes: 'A4 B4' }, 0, { strict: true })).toThrow(
      /4 sílabas \(ca-mi-nan-do\) y solo 2 notas/
    )
    // Desde el editor (no estricto) parte las notas largas.
    const loose = alignLine({ text: 'caminando', notes: 'A4:2 B4:2' }, 0, { strict: false })
    expect(loose.notes).toHaveLength(4)
    expect(loose.beats).toBe(4)
  })
})

describe('colocar la melodía y generar el .ustx', () => {
  const sections = [
    { name: 'Intro', startBar: 1, bars: 2 },
    {
      name: 'Verso',
      startBar: 3,
      bars: 2,
      melody: [
        { text: 'bajo el sol', notes: 'A4 B4 C5 D5' },
        { text: 'de la mañana', notes: 'C5:0.5 B4:0.5 C5 B4 A4' }
      ]
    }
  ]

  it('cada sección empieza en su compás y sus frases van seguidas', () => {
    const notes = placeMelody(sections, 4, { strict: true })
    expect(notes[0]).toMatchObject({ beat: 8, lyric: 'bajo' })
    expect(notes[4]).toMatchObject({ beat: 12, lyric: 'de' })
    expect(melodyEndBeat(notes)).toBe(16)
  })

  it('avisa si una sección se pasa o si una nota sale del registro', () => {
    expect(() => placeMelody([{ ...sections[1], bars: 1 }], 4, { strict: true })).toThrow(
      /"Verso" dura 8 pulsos y la sección tiene 4/
    )
    expect(() => placeMelody(sections, 4, { strict: true, range: [60, 72] })).toThrow(
      /D5 está fuera del registro del cantante \(C4–C5\)/
    )
  })

  it('genera un .ustx con el cantante, el fonemizador del idioma y las notas en ticks', () => {
    const ustx = buildUstx({
      singer: 'Hanami ~AIdol~ v1.0',
      language: 'es',
      bpm: 96,
      beatsPerBar: 4,
      notes: placeMelody(sections, 4, { strict: true })
    })
    expect(ustx).toContain("- singer: 'Hanami ~AIdol~ v1.0'")
    expect(ustx).toContain('phonemizer: OpenUtau.Core.DiffSinger.DiffSingerSpanishPhonemizer')
    expect(ustx).toContain('bpm: 96')
    expect(ustx).toContain("  - position: 3840\n    duration: 480\n    tone: 69\n    lyric: 'bajo'")
    expect(ustx.match(/ {2}- position:/g)).toHaveLength(9) // notas (sin contar el tempo)
  })
})
