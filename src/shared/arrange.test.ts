import { describe, expect, it } from 'vitest'
import {
  steadyArrangement,
  contextLift,
  MAX_CURVE_BRIGHT_DB,
  chunkBars,
  energyHint,
  clampWords,
  fillSections,
  lastRegionIn,
  layerPrompt,
  lyricsTag,
  loopBars,
  loopRegion,
  parseSongSpec,
  phraseBars,
  planChunks,
  polishSong,
  reviewProject,
  sectionCoverage,
  brightened,
  sectionBrightness,
  sectionCurves,
  sectionGains,
  tileRegions,
  trackBusy,
  vocalSongRequest,
  withoutFilterWords,
  withoutPercussion,
  bedText,
  withRegionBright,
  withRegionEq,
  withRegionGains,
  withoutStyleRepeats,
  type ChunkStep
} from './arrange'
import { GENRES } from './genres'
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

describe('cama con batería programada', () => {
  it('quita las palabras de filtro del arreglo y el "soft" de la calma', () => {
    expect(withoutFilterWords('filtered kick and metallic percussion, muffled pad')).toBe(
      'kick and metallic percussion, pad'
    )
    expect(withoutFilterWords('lowpassed, bass')).toBe('bass')
    expect(energyHint(2, { drums: true })).toBe('groove')
    expect(energyHint(2)).toBe('soft drums, groove')
  })
})

describe('cama sin percusión', () => {
  it('quita los trozos que nombran percusión y deja el resto', () => {
    expect(withoutPercussion('kick and rolling bassline, congas, distorted synth stabs')).toBe(
      'rolling bassline, distorted synth stabs'
    )
    expect(
      withoutPercussion('tech house, punchy four-on-the-floor kick, metallic percussion, cowbell')
    ).toBe('tech house')
    expect(withoutPercussion('full groove, synth riff with claps, energetic, full drums')).toBe(
      'full groove, synth riff, energetic'
    )
    expect(bedText('filtered kick and metallic percussion, muffled pad')).toBe('pad')
  })

  it('la cama no pide graves que la hunden ni repite el estilo (test11)', () => {
    expect(bedText('industrial tech house, distorted synth stabs, low rolling bassline')).toBe(
      'tech house, distorted synth stabs, rolling bassline'
    )
    const style = 'tech house, distorted synth stabs, rolling bassline, acid synth riff'
    expect(withoutStyleRepeats('acid synth riff and rolling bassline, simpler', style)).toBe(
      'simpler'
    )
    expect(withoutStyleRepeats('full groove, Rolling  bassline, acid riff', style)).toBe(
      'full groove, acid riff'
    )
  })

  it('con batería, la energía y las transiciones se piden sin batería', () => {
    expect(energyHint(5, { drums: true })).toBe('energetic, full groove')
    expect(energyHint(3, { drums: true })).toBe('steady groove')
    const steps = planChunks(
      parseSongSpec(
        song({
          sections: [
            { name: 'Intro', bars: 8, energy: 2, arrangement: 'kick and pad' },
            { name: 'Coro', bars: 8, energy: 5, arrangement: 'acid lead, claps' },
            { name: 'Coro', bars: 8, reuse: true }
          ]
        })
      ),
      8,
      { bpm: 128, drums: true }
    )
    const [intro, coro, again] = steps
    expect(intro).toMatchObject({
      prompt: 'techno, pad, intro, groove, 128 bpm, build-up at the end'
    })
    expect(coro).toMatchObject({
      prompt: 'techno, acid lead, energetic, full groove, 128 bpm'
    })
    // La repetición lleva, por si acaso, los tramos para grabarla igual que la original.
    expect(again).toMatchObject({
      kind: 'reuse',
      from: 1,
      fallback: [
        {
          startBar: 17,
          bars: 8,
          prompt: 'techno, acid lead, energetic, full groove, 128 bpm, fade out ending'
        }
      ]
    })
  })
})

describe('mezcla por sección', () => {
  // test9: intro, verso, coro (repetido tres veces), verso, break y outro.
  const plan = [
    { startBar: 1, bars: 8, energy: 2 },
    { startBar: 9, bars: 8, energy: 3 },
    { startBar: 17, bars: 8, energy: 5 },
    { startBar: 25, bars: 8, energy: 3 },
    { startBar: 33, bars: 8, energy: 5 },
    { startBar: 41, bars: 8, energy: 3 },
    { startBar: 49, bars: 8, energy: 5 },
    { startBar: 57, bars: 8, energy: 2 }
  ]
  const at = (bar: number, clipId: string, db: number) => ({
    id: `r${bar}`,
    clipId,
    offsetSec: 0.5,
    startBeat: (bar - 1) * 4,
    lengthSec: 15.2,
    db
  })
  const regions = [
    at(1, 'intro', -16.6),
    at(9, 'verso', -19.1),
    at(17, 'coro', -29),
    at(25, 'verso2', -18.9),
    at(33, 'coro', -29),
    at(41, 'break', -24.7),
    at(49, 'coro', -29),
    at(57, 'outro', -26.8)
  ]

  it('sube el coro apagado y lo deja junto al verso, sin pasarse', () => {
    const g = sectionGains(plan, regions, 4)
    // Hacía falta casi +12 dB: sube el máximo y el resto baja 3 dB para compensar.
    for (const id of ['r17', 'r33', 'r49']) expect(g.get(id)).toBe(6)
    expect(g.get('r9')).toBe(-3)
    expect(g.get('r1')).toBe(-6)
    expect(g.get('r57')).toBe(3.5)
    const after = (id: string) => regions.find((r) => r.id === id)!.db + g.get(id)!
    expect(after('r17')).toBeGreaterThan(after('r9') - 1)
  })

  it('un coro repetido sin energía usa la del primero', () => {
    const named = [
      { name: 'Verso', startBar: 1, bars: 8, energy: 3 },
      { name: 'Coro', startBar: 9, bars: 8, energy: 5 },
      { name: 'Coro', startBar: 17, bars: 8 }
    ]
    const g = sectionGains(named, [at(1, 'v', -19), at(9, 'c', -29), at(17, 'c', -29)], 4)
    expect(g.get('r17')).toBe(g.get('r9'))
  })

  it('una canción ya pareja no se toca', () => {
    const even = regions.map((r, i) => ({ ...r, clipId: `c${i}`, db: -18 + (plan[i].energy - 3) }))
    expect([...sectionGains(plan, even, 4).values()].every((g) => g === 0)).toBe(true)
  })

  it('no sube el siseo: una sección bajita y de puros agudos se queda', () => {
    const g = sectionGains(
      plan.slice(0, 3),
      [
        { ...at(1, 'intro', -18), highDb: -20 },
        { ...at(9, 'verso', -18), highDb: -20 },
        { ...at(17, 'coro', -30), highDb: -6 }
      ],
      4
    )
    expect(g.get('r17')).toBe(0)
  })

  it('la ganancia no agranda una unión (test11: break a −4 y verso a +6)', () => {
    const sections = [
      { startBar: 1, bars: 8, energy: 5 },
      { startBar: 9, bars: 8, energy: 2 },
      { startBar: 17, bars: 8, energy: 3 }
    ]
    const g = sectionGains(
      sections,
      [
        { ...at(1, 'drop', -14), headDb: -14, tailDb: -14 },
        { ...at(9, 'break', -15), headDb: -14, tailDb: -38 },
        { ...at(17, 'verso', -31), headDb: -29, tailDb: -30 }
      ],
      4
    )
    const heard = -29 + g.get('r17')! - (-38 + g.get('r9')!)
    // El salto crudo era de 9 dB: la mezcla no lo empeora.
    expect(heard).toBeLessThanOrEqual(9)
  })

  it('bajar del coro a un verso suave no deja el coro sin subir (test18)', () => {
    const named = [
      { name: 'Verso', startBar: 1, bars: 8, energy: 3 },
      { name: 'Coro', startBar: 9, bars: 8, energy: 5 },
      { name: 'Verso', startBar: 17, bars: 8, energy: 3 },
      { name: 'Solo', startBar: 25, bars: 8, energy: 5 }
    ]
    const g = sectionGains(
      named,
      [
        { ...at(1, 'v', -16), headDb: -22, tailDb: -14 },
        { ...at(9, 'c', -17.4), headDb: -18, tailDb: -16 },
        { ...at(17, 'v', -16), headDb: -22, tailDb: -14 },
        { ...at(25, 's', -16.4), headDb: -16, tailDb: -18 }
      ],
      4
    )
    const after = (id: string, db: number) => db + g.get(id)!
    expect(after('r9', -17.4)).toBeGreaterThan(after('r1', -16) + 1)
  })

  it('pone y quita la ganancia de las regiones', () => {
    const p = createProject('X')
    const t = createTrack('Canción', 'full')
    const r: Region = {
      id: 'a',
      clipId: 'c',
      startBeat: 0,
      offsetSec: 0,
      lengthSec: 4,
      fadeInSec: 0,
      fadeOutSec: 0
    }
    const withGain = withRegionGains(
      { ...p, tracks: [{ ...t, regions: [r] }] },
      new Map([['a', 4]])
    )
    expect(withGain.tracks[0].regions[0].gainDb).toBe(4)
    const cleared = withRegionGains(withGain, new Map([['a', 0]]))
    expect('gainDb' in cleared.tracks[0].regions[0]).toBe(false)
  })

  describe('brillo por sección (test15: coros opacos)', () => {
    const sections = [
      { name: 'Intro', startBar: 1, bars: 8, energy: 3 },
      { name: 'Verso', startBar: 9, bars: 8, energy: 3 },
      { name: 'Coro', startBar: 17, bars: 8, energy: 5 },
      { name: 'Puente', startBar: 25, bars: 8, energy: 2 }
    ]
    const bright = (bar: number, db: number, highDb: number) => ({
      ...at(bar, `c${bar}`, db),
      highDb
    })

    it('realza lo que se oscureció respecto al primer tramo, con tope', () => {
      const b = sectionBrightness(
        sections,
        [bright(1, -18, -14), bright(9, -19, -18), bright(17, -17, -29), bright(25, -20, -30)],
        4
      )
      // El verso está dentro del margen; el coro sube el tope; el puente tranquilo, nada.
      expect(b.get('r1')).toBe(0)
      expect(b.get('r9')).toBe(0)
      expect(b.get('r17')).toBe(6)
      expect(b.get('r25')).toBe(0)
    })

    it('no realza el siseo ni una canción con un solo tramo', () => {
      const b = sectionBrightness(sections, [bright(1, -18, -2), bright(9, -30, -9)], 4)
      expect(b.get('r9')).toBe(0)
      expect(sectionBrightness(sections, [bright(1, -18, -14)], 4).size).toBe(0)
    })

    it('lo realzado se mide con más agudos, y se pone y se quita', () => {
      const lit = brightened({ db: -20, highDb: -28 }, 6)
      expect(lit.highDb).toBeCloseTo(-22, 0)
      expect(lit.db).toBeGreaterThan(-20)
      expect(brightened({ db: -20, highDb: -28 }, 0)).toEqual({ db: -20, highDb: -28 })
      const t = createTrack('Canción', 'full')
      const r: Region = {
        id: 'a',
        clipId: 'c',
        startBeat: 0,
        offsetSec: 0,
        lengthSec: 4,
        fadeInSec: 0,
        fadeOutSec: 0
      }
      const p = withRegionBright(
        { ...createProject('X'), tracks: [{ ...t, regions: [r] }] },
        new Map([['a', 4]])
      )
      expect(p.tracks[0].regions[0].brightDb).toBe(4)
      expect('brightDb' in withRegionBright(p, new Map([['a', 0]])).tracks[0].regions[0]).toBe(
        false
      )
    })
  })

  it('tapa una región con compases sanos de otra, en su posición de la frase', () => {
    const p = { ...createProject('X'), bpm: 120 } // un compás = 2 s
    const t = createTrack('Canción', 'full')
    const good: Region = {
      id: 'good',
      clipId: 'sano',
      startBeat: 32,
      offsetSec: 0.5,
      lengthSec: 16,
      fadeInSec: 0,
      fadeOutSec: 0,
      gainDb: 2
    }
    const bad: Region = {
      id: 'bad',
      clipId: 'mudo',
      startBeat: 68,
      offsetSec: 0.5,
      lengthSec: 14,
      fadeInSec: 0,
      fadeOutSec: 0
    }
    const { project, regionId } = loopRegion(
      { ...p, tracks: [{ ...t, regions: [good, bad] }] },
      'bad',
      good,
      { atBeat: 68, offsetBars: 1, bars: 7 }
    )
    const regions = project.tracks[0].regions
    expect(regions.map((r) => r.id)).toEqual(['good', regionId])
    expect(regions[1]).toMatchObject({
      clipId: 'sano',
      startBeat: 68,
      offsetSec: 2.5,
      lengthSec: 14,
      gainDb: 2
    })
    // Sin región que reemplazar se añade a la pista de la fuente y no se quita nada.
    const added = loopRegion({ ...p, tracks: [{ ...t, regions: [good, bad] }] }, null, good, {
      atBeat: 96,
      offsetBars: 7,
      bars: 1
    })
    expect(added.project.tracks[0].regions.map((r) => r.id)).toEqual([
      'good',
      'bad',
      added.regionId
    ])
  })
})

describe('phraseBars', () => {
  it('completa la última frase de 4 compases y respeta los remates cortos', () => {
    expect([22, 16, 13, 64, 3, 2, 1].map(phraseBars)).toEqual([24, 16, 16, 64, 3, 2, 1])
    const spec = parseSongSpec(song({ sections: [{ name: 'Verso', bars: 22, arrangement: 'x' }] }))
    expect(spec.sections[0].bars).toBe(24)
  })
})

describe('curva de mezcla dentro de la sección (test17)', () => {
  const sections = [
    { name: 'Intro', startBar: 1, bars: 8, energy: 3 },
    { name: 'Verso', startBar: 9, bars: 8, energy: 3 },
    { name: 'Puente', startBar: 17, bars: 8, energy: 2 }
  ]
  const flat = (n: number, db: number, highDb: number) =>
    Array.from({ length: n }, () => ({ db, highDb }))
  const region = (bar: number, seconds: { db: number; highDb: number }[], extra = {}) => ({
    id: `r${bar}`,
    startBeat: (bar - 1) * 4,
    offsetSec: 1,
    seconds,
    ...extra
  })
  const intro = region(1, flat(16, -17, -5))

  it('realza solo la mitad que se oscureció, hasta el tope', () => {
    const verso = region(9, [...flat(8, -17, -4), ...flat(8, -17, -18)], { brightDb: 2 })
    const eq = sectionCurves(sections, [intro, verso], 4, -5).get('r9')!
    // Primera mitad sin tocar; la segunda sube lo que falta, sin pasar de 9 en total.
    expect(eq.slice(0, 6).every((q) => q.brightDb === 0)).toBe(true)
    expect(eq[14].brightDb).toBe(7)
    expect(eq[14].clipSec).toBe(15.5)
    expect(eq.every((q) => q.gainDb === 0)).toBe(true)
  })

  it('iguala los dos clips de una sección: sin escalón en la unión (test18)', () => {
    const coro = [
      { name: 'Intro', startBar: 1, bars: 8, energy: 3 },
      { name: 'Coro', startBar: 9, bars: 16, energy: 5 }
    ]
    const a = region(9, flat(16, -20, -5))
    const b = region(17, flat(16, -15, -5))
    const curves = sectionCurves(coro, [intro, a, b], 4, -5)
    const heard = (eq: { gainDb: number }[], db: number) => db + (eq[8]?.gainDb ?? 0)
    expect(Math.abs(heard(curves.get('r17')!, -15) - heard(curves.get('r9')!, -20))).toBeLessThan(1)
  })

  it('baja un golpe y sube un hueco pasado el margen', () => {
    const s = flat(16, -17, -5)
    s[7] = { db: -10, highDb: -5 }
    s[8] = { db: -10, highDb: -5 }
    s[9] = { db: -10, highDb: -5 }
    const eq = sectionCurves(sections, [intro, region(9, s)], 4, -5).get('r9')!
    expect(eq[8].gainDb).toBe(-6)
    expect(eq[2].gainDb).toBe(0)
  })

  it('deja la sección tranquila, el siseo, los bordes de la canción y lo pequeño', () => {
    const dark = flat(16, -17, -20)
    const puente = region(17, dark, { eq: [{ clipSec: 1, gainDb: 3, brightDb: 3 }] })
    const curves = sectionCurves(
      sections,
      [region(1, dark), region(9, flat(16, -40, -1)), puente],
      4,
      -5
    )
    // Energía 2: se quita la curva que tuviera.
    expect(curves.get('r17')).toEqual([])
    // Siseo: nada.
    expect(curves.get('r9')).toEqual([])
    // Primer segundo de la canción intacto aunque esté oscuro.
    const intro = curves.get('r1')!
    expect(intro[0].brightDb).toBe(0)
    expect(intro[5].brightDb).toBeGreaterThan(0)
    // Una diferencia de 1 dB no se corrige.
    expect(sectionCurves(sections, [region(1, flat(16, -17, -9))], 4, -5).get('r1')).toEqual([])
  })

  it('sin referencia (batería programada) solo iguala el volumen', () => {
    const eq = sectionCurves(sections, [intro, region(9, flat(16, -17, -25))], 4, null).get('r9')
    expect(eq).toEqual([])
  })

  it('se guarda en la región y viaja con los loops', () => {
    const p = createProject('X')
    const t = {
      ...createTrack('Canción', 'full'),
      regions: [
        {
          id: 'a',
          clipId: 'c',
          startBeat: 0,
          offsetSec: 0,
          lengthSec: 16,
          fadeInSec: 0,
          fadeOutSec: 0
        }
      ]
    }
    const curve = [{ clipSec: 4.5, gainDb: 0, brightDb: 3 }]
    const withEq = withRegionEq({ ...p, tracks: [t] }, new Map([['a', curve]]))
    const src = withEq.tracks[0].regions[0] as Region
    expect(src.eq).toEqual(curve)
    const looped = loopRegion(withEq, null, src, { atBeat: 32, offsetBars: 2, bars: 1 })
    const copy = looped.project.tracks[0].regions.find((r) => r.id === looped.regionId)!
    expect(copy.eq).toEqual(curve)
    expect(withRegionEq(withEq, new Map([['a', []]])).tracks[0].regions[0].eq).toBeUndefined()
  })
})

describe('partida realzada para que la canción no se apague (test19)', () => {
  it('realza lo que le falta a la partida, con tope, y nada si ya brilla', () => {
    expect(contextLift(-11, -17)).toBe(3)
    expect(contextLift(-11, -30)).toBe(MAX_CURVE_BRIGHT_DB)
    expect(contextLift(-11, -13)).toBe(0)
    expect(contextLift(-11, -5)).toBe(0)
  })
})

describe('arreglos sin entradas escalonadas (test18)', () => {
  it('quita "alone" y "enters": todo suena a la vez', () => {
    expect(steadyArrangement('guitar riff alone, live drums enter')).toBe('guitar riff, live drums')
    expect(steadyArrangement('kick alone, bassline kicks in')).toBe('kick, bassline')
    expect(steadyArrangement('bass and hats enter')).toBe('bass and hats')
    expect(steadyArrangement('electric guitar solo over full band')).toBe(
      'electric guitar solo over full band'
    )
  })

  it('las guías de género no piden entradas', () => {
    for (const g of GENRES) {
      for (const text of Object.values(g.arrangements)) expect(steadyArrangement(text)).toBe(text)
    }
  })
})
