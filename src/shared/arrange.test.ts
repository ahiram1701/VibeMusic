import { describe, expect, it } from 'vitest'
import {
  chunkBars,
  clampWords,
  fillSections,
  lastRegionIn,
  layerPrompt,
  lyricsTag,
  loopBars,
  parseSongSpec,
  planChunks,
  polishSong,
  reviewProject,
  sectionCoverage,
  tileRegions,
  trackBusy,
  vocalSongRequest,
  type ChunkStep
} from './arrange'
import { createProject, createTrack, type Project, type Region } from './project'
import { sectionsOf, setSections } from './sections'

const region = (id: string, startBeat: number, lengthSec: number, clipId = 'c'): Region => ({
  id,
  clipId,
  startBeat,
  offsetSec: 0,
  lengthSec,
  fadeInSec: 0,
  fadeOutSec: 0
})

/** 120 BPM, 4/4: 1 compás = 4 beats = 2 s. */
const base = (): Project => ({ ...createProject('t'), bpm: 120 })

const song = (over: Record<string, unknown> = {}) => ({
  style: 'dark techno',
  sections: [
    { name: 'Intro', bars: 8, energy: 2, arrangement: 'kick and pad' },
    { name: 'Coro', bars: 12, energy: 5, arrangement: 'everything, acid lead' },
    { name: 'Break', bars: 4, energy: 1, arrangement: 'pad only' },
    { name: 'Coro', bars: 12, reuse: true }
  ],
  ...over
})

const generated = (steps: ChunkStep[]) =>
  steps.filter((s): s is Extract<ChunkStep, { kind: 'generate' }> => s.kind === 'generate')

describe('parseSongSpec', () => {
  it('normaliza la canción: energía acotada, reuse y arreglo por sección', () => {
    const spec = parseSongSpec(
      song({
        sections: [
          { name: 'Intro', bars: '8', energy: '9', arrangement: ' kick ' },
          { name: 'Coro', bars: 8, arrangement: 'all' },
          { name: 'coro', bars: 8, reuse: 'true' }
        ]
      })
    )
    expect(spec.sections).toEqual([
      {
        name: 'Intro',
        bars: 8,
        arrangement: 'kick',
        energy: 5,
        reuse: false,
        lyrics: null,
        melody: null
      },
      {
        name: 'Coro',
        bars: 8,
        arrangement: 'all',
        energy: null,
        reuse: false,
        lyrics: null,
        melody: null
      },
      {
        name: 'coro',
        bars: 8,
        arrangement: '',
        energy: null,
        reuse: true,
        lyrics: null,
        melody: null
      }
    ])
  })

  it('tolera la lista de secciones como texto', () => {
    const spec = parseSongSpec({
      style: 's',
      sections: JSON.stringify([{ name: 'A', bars: 4, arrangement: 'x' }])
    })
    expect(spec.sections[0].name).toBe('A')
  })

  it('explica cada error para que el modelo lo corrija', () => {
    expect(() => parseSongSpec(song({ style: '' }))).toThrow(/style/)
    expect(() => parseSongSpec(song({ sections: [] }))).toThrow(/sections/)
    expect(() => parseSongSpec(song({ sections: [{ name: 'A', bars: 8 }] }))).toThrow(
      /falta "arrangement"/
    )
    expect(() =>
      parseSongSpec(song({ sections: [{ name: 'A', bars: 100, arrangement: 'x' }] }))
    ).toThrow(/de 1 a 64/)
    expect(() =>
      parseSongSpec(
        song({
          sections: [
            { name: 'A', bars: 8, arrangement: 'x' },
            { name: 'B', bars: 8, reuse: true }
          ]
        })
      )
    ).toThrow(/no hay ninguna antes/)
  })
})

describe('planChunks', () => {
  it('calcula cuántos compases caben por tramo con el contexto de la continuación', () => {
    // 30 s máx. − 8 s de contexto = 22 s nuevos.
    expect(chunkBars(1.905, 30, 8)).toBe(8) // 126 BPM
    expect(chunkBars(3.43, 30, 8)).toBe(4) // 70 BPM
    expect(chunkBars(6, 30, 8)).toBe(3)
    expect(chunkBars(30, 30, 8)).toBe(1)
  })

  it('divide cada sección en tramos encadenados y recorta el último', () => {
    const steps = planChunks(parseSongSpec(song()), 8)
    expect(
      steps.map((s) => (s.kind === 'reuse' ? ['reuse', s.from] : [s.startBar, s.bars]))
    ).toEqual([
      [1, 8],
      [9, 8],
      [17, 4],
      [21, 4],
      ['reuse', 1]
    ])
  })

  it('prompts cortos tipo etiquetas: estilo, arreglo, energía, tempo y transición', () => {
    const [intro, coro1, coro2, brk] = generated(
      planChunks(parseSongSpec(song()), 8, { bpm: 128, key: 'A minor' })
    )
    expect(intro.prompt).toBe(
      'dark techno, kick and pad, intro, soft drums, groove, 128 bpm, A minor, build-up and drum fill at the end'
    )
    expect(coro1.prompt).toBe(
      'dark techno, everything, acid lead, energetic, full drums, 128 bpm, A minor'
    ) // a mitad de sección no hay transición
    expect(coro2.prompt).toMatch(/energetic, full drums, 128 bpm, A minor, drum fill at the end$/)
    expect(brk.prompt).toMatch(/^dark techno, pad only, soft drums, groove/)
  })

  it('recorta estilos y arreglos largos por frases y nunca usa negaciones', () => {
    const long = Array.from({ length: 12 }, (_, i) => `word${i} sound${i}`).join(', ')
    const [step] = generated(
      planChunks(
        parseSongSpec(song({ style: long, sections: [{ name: 'A', bars: 8, arrangement: long }] })),
        8,
        { bpm: 96 }
      )
    )
    expect(step.prompt.split(/\s+/).length).toBeLessThanOrEqual(40)
    expect(step.prompt).toMatch(/^word0 sound0, word1 sound1/)
    expect(step.prompt).toMatch(/96 bpm/)
    expect(step.prompt).not.toMatch(/\bnot\b|\bno\b/)
    expect(clampWords('one two three four five six', 3)).toBe('one two three')
  })

  it('una sección repetida sin copiar escucha a la original', () => {
    const steps = generated(
      planChunks(
        parseSongSpec(
          song({
            sections: [
              { name: 'Coro', bars: 8, arrangement: 'hook' },
              { name: 'Verso', bars: 8, arrangement: 'groove' },
              { name: 'Coro 2', bars: 16, arrangement: 'hook again' }
            ]
          })
        ),
        8
      )
    )
    expect(steps.map((s) => s.contextFrom)).toEqual([undefined, undefined, 0, undefined])
  })

  it('el último tramo de la canción termina en fundido', () => {
    const steps = generated(
      planChunks(parseSongSpec(song({ sections: [{ name: 'A', bars: 8, arrangement: 'x' }] })), 8)
    )
    expect(steps.at(-1)!.prompt).toMatch(/fade out ending$/)
  })
})

describe('pulido', () => {
  it('fundido mínimo en las costuras, entrada en un compás y salida en dos', () => {
    const track = {
      ...createTrack('Canción', 'full'),
      regions: [region('b', 16, 8), region('a', 0, 8), region('c', 32, 8)]
    }
    const p = polishSong({ ...base(), tracks: [track] }, track.id)
    const fades = Object.fromEntries(
      p.tracks[0].regions.map((r) => [r.id, [r.fadeInSec, r.fadeOutSec]])
    )
    expect(fades).toEqual({ a: [2, 0.01], b: [0.01, 0.01], c: [0.01, 4] })
  })

  it('encuentra la última región de una pista dentro de una sección', () => {
    const p0 = setSections(base(), [
      { name: 'A', startBar: 1, bars: 8 },
      { name: 'B', startBar: 9, bars: 8 }
    ])
    const track = {
      ...createTrack('Canción', 'full'),
      regions: [region('x', 0, 8), region('y', 16, 8)]
    }
    const p = { ...p0, tracks: [track] }
    const [a, b] = sectionsOf(p)
    expect(lastRegionIn(p, track.id, a)?.id).toBe('y')
    expect(lastRegionIn(p, track.id, b)).toBeUndefined()
  })
})

describe('loops y relleno', () => {
  it('elige 8 compases si caben, si no 4 o lo que quepa, nunca más que la sección', () => {
    expect(loopBars(15, 16)).toBe(8)
    expect(loopBars(7, 16)).toBe(4)
    expect(loopBars(3, 16)).toBe(3)
    expect(loopBars(15, 4)).toBe(4)
  })

  it('pone primero lo propio de la capa y luego el estilo común', () => {
    expect(layerPrompt(' rolling bass ', 'dark techno')).toBe('rolling bass, dark techno')
    expect(layerPrompt('rolling bass', undefined)).toBe('rolling bass')
  })

  it('repite un loop hasta el final y recorta la última copia', () => {
    // Loop de 8 s (4 compases = 16 beats) en un hueco de 40 beats: 16 + 16 + 8.
    const tiles = tileRegions(region('r', 0, 8), 0, 40, 120)
    expect(tiles.map((t) => [t.startBeat, t.lengthSec])).toEqual([
      [0, 8],
      [16, 8],
      [32, 4]
    ])
    expect(tiles[2].fadeOutSec).toBeGreaterThan(0)
    expect(new Set(tiles.map((t) => t.id)).size).toBe(3)
  })

  it('llena secciones sustituyendo lo que la pista tenía dentro', () => {
    let p = setSections(base(), [
      { name: 'A', startBar: 1, bars: 8 },
      { name: 'B', startBar: 9, bars: 8 },
      { name: 'C', startBar: 17, bars: 4 }
    ])
    const loop = region('loop', 0, 8, 'nuevo')
    const track = { ...createTrack('Bajo', 'bass'), regions: [loop, region('viejo', 64, 8)] }
    p = { ...p, tracks: [track] }
    const [a, , c] = sectionsOf(p)
    const next = fillSections(p, track.id, loop, [a, c])
    const starts = next.tracks[0].regions.map((r) => [r.startBeat, r.clipId])
    // A (beats 0-32) con dos copias, C (64-80) con una recortada; lo viejo de C, fuera.
    expect(starts).toEqual([
      [0, 'nuevo'],
      [16, 'nuevo'],
      [64, 'nuevo']
    ])
    expect(trackBusy(next, next.tracks[0], 32, 64)).toBe(false)
    expect(trackBusy(next, next.tracks[0], 60, 66)).toBe(true)
  })
})

describe('cobertura y revisión', () => {
  const arranged = (): Project => {
    const p = setSections(base(), [
      { name: 'Intro', startBar: 1, bars: 4, sparse: true },
      { name: 'Verso', startBar: 5, bars: 4 },
      { name: 'Coro', startBar: 9, bars: 4 },
      { name: 'Final', startBar: 13, bars: 4 }
    ])
    const drums = { ...createTrack('Batería', 'drums'), regions: [region('d', 0, 24)] } // compases 1-12
    const bass = {
      ...createTrack('Bajo', 'bass'),
      regions: [region('b', 16, 8), region('b2', 32, 4)]
    }
    const muted = { ...createTrack('Pad', 'chords'), mute: true, regions: [region('m', 0, 32)] }
    return { ...p, tracks: [drums, bass, muted] }
  }

  it('dice qué capas suenan en cada sección y cuáles dejan huecos', () => {
    const cov = sectionCoverage(arranged())
    expect(cov.map((c) => [c.section.name, c.layers.map((l) => l.track), c.partial])).toEqual([
      ['Intro', ['Batería'], []],
      ['Verso', ['Batería', 'Bajo'], []],
      ['Coro', ['Batería', 'Bajo'], ['Bajo']],
      ['Final', [], []]
    ])
  })

  it('avisa de secciones vacías, de una sola capa y con huecos (no de las escasas a propósito)', () => {
    const note = reviewProject(arranged())!
    expect(note).toMatch(/"Final".*is empty/)
    expect(note).toMatch(/"Coro".*Bajo stop\(s\) before the section ends/)
    expect(note).not.toMatch(/"Intro"/)
    expect(note).toMatch(/fill_section/)
  })

  it('una mezcla completa cuenta como sección llena; una capa suelta no', () => {
    const p = setSections(base(), [{ name: 'A', startBar: 1, bars: 4 }])
    const only = (role: 'full' | 'drums') => ({
      ...p,
      tracks: [{ ...createTrack('Pista', role), regions: [region('r', 0, 8)] }]
    })
    expect(sectionCoverage(only('full'))[0].thin).toBe(false)
    expect(reviewProject(only('full'))).toBeNull()
    expect(sectionCoverage(only('drums'))[0].thin).toBe(true)
    expect(reviewProject(only('drums'))).toMatch(/only one layer/)
  })

  it('no dice nada si aún no hay audio o si todo está bien', () => {
    expect(reviewProject(setSections(base(), [{ name: 'A', startBar: 1, bars: 4 }]))).toBeNull()
    const p = setSections(base(), [{ name: 'A', startBar: 1, bars: 4 }])
    const full = {
      ...p,
      tracks: [
        { ...createTrack('Batería', 'drums'), regions: [region('d', 0, 8)] },
        { ...createTrack('Bajo', 'bass'), regions: [region('b', 0, 8)] }
      ]
    }
    expect(reviewProject(full)).toBeNull()
  })
})

describe('letra', () => {
  it('parseSongSpec guarda letra, voz e idioma (y limpia la letra)', () => {
    const spec = parseSongSpec({
      style: 'pop',
      vocals: ' bright female vocal ',
      language: 'ES',
      sections: [
        { name: 'Intro', bars: 4, arrangement: 'pad' },
        {
          name: 'Verso',
          bars: 8,
          arrangement: 'beat',
          lyrics: '  línea uno \r\n\r\n\r\nlínea dos  '
        }
      ]
    })
    expect(spec.vocals).toBe('bright female vocal')
    expect(spec.language).toBe('es')
    expect(spec.sections.map((s) => s.lyrics)).toEqual([null, 'línea uno\n\nlínea dos'])
    expect(
      parseSongSpec({
        style: 'x',
        language: 'español',
        sections: [{ name: 'A', bars: 4, arrangement: 'y' }]
      }).language
    ).toBeNull()
  })

  it('lyricsTag reconoce los nombres en español e inglés', () => {
    expect(lyricsTag('Estribillo 2', true)).toBe('Chorus')
    expect(lyricsTag('Pre-coro', true)).toBe('Pre-Chorus')
    expect(lyricsTag('Estrofa', true)).toBe('Verse')
    expect(lyricsTag('Puente', true)).toBe('Bridge')
    expect(lyricsTag('Drop', true)).toBe('Verse')
    expect(lyricsTag('Drop', false)).toBe('Instrumental')
    expect(lyricsTag('Introducción', false)).toBe('Intro')
    expect(lyricsTag('Final', false)).toBe('Outro')
  })

  it('vocalSongRequest junta estilo, voz y letra de todas las secciones', () => {
    const p = {
      ...createProject('X'),
      style: 'ballad',
      vocals: 'soft male vocal',
      lyricsLanguage: 'es',
      sections: [
        { id: 'b', name: 'Coro', startBar: 9, bars: 8, lyrics: 'te quiero' },
        { id: 'a', name: 'Verso', startBar: 1, bars: 8 }
      ]
    }
    expect(vocalSongRequest(p)).toEqual({
      prompt: 'ballad, soft male vocal',
      lyrics: '[Instrumental]\n\n[Chorus]\nte quiero',
      language: 'es',
      bars: 16
    })
    expect(() => vocalSongRequest({ ...p, sections: [p.sections[1]] })).toThrow(/no tiene letra/)
  })

  it('vocalSongRequest no fija el idioma si la letra mezcla español e inglés', () => {
    const p = {
      ...createProject('X'),
      style: 'reggaeton',
      vocals: 'male vocal',
      lyricsLanguage: 'es',
      sections: [
        { id: 'a', name: 'Verso', startBar: 1, bars: 8, lyrics: 'ven a bailar conmigo' },
        { id: 'b', name: 'Coro', startBar: 9, bars: 8, lyrics: "baby don't stop tonight" }
      ]
    }
    const req = vocalSongRequest(p)
    expect(req.language).toBeUndefined()
    expect(req.prompt).toBe(
      'reggaeton, male vocal, bilingual Spanish and English lyrics, English lines sung with native English pronunciation'
    )
  })
})
