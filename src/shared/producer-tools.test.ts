import { describe, expect, it } from 'vitest'
import type { ProviderInfo } from './generation'
import { createProject, createTrack, newId, secondsToBeats, type Project } from './project'
import {
  AGENT_PREFIX,
  createProducerTools,
  maxBarsPerClip,
  type ProducerHost
} from './producer-tools'
import { barsToSeconds } from './prompt'
import { drumPlan, findPattern, kickBeats } from './drums'
import { withDrumTrack, withoutDrums } from './production'
import { sectionsOf } from './sections'

const demo: ProviderInfo = {
  id: 'demo',
  label: 'Demo',
  description: '',
  ready: true,
  capabilities: {
    maxDurationSec: 30,
    supportsSeed: true,
    supportsContinue: true,
    supportsMelody: false,
    supportsLyrics: false
  }
}

const singer: ProviderInfo = {
  id: 'huggingface',
  label: 'ACE-Step',
  description: '',
  ready: true,
  capabilities: {
    maxDurationSec: 240,
    supportsSeed: true,
    supportsContinue: false,
    supportsMelody: false,
    supportsLyrics: true
  }
}

/** Host en memoria: la "generación" crea la región al instante. */
function fakeHost(
  initial: Project,
  provider: ProviderInfo | undefined = demo,
  vocal: ProviderInfo | undefined = undefined
) {
  const generated: Parameters<ProducerHost['generate']>[0][] = []
  const myVoices: ReturnType<ProducerHost['myVoices']> = { ready: false, voices: [] }
  const singer = {
    ready: false,
    preference: 'auto' as ReturnType<ProducerHost['singingPreference']>,
    sung: [] as string[]
  }
  const state = { project: initial, messages: [] as string[], playedFrom: -1 }
  const host: ProducerHost = {
    getProject: () => state.project,
    commit: async (next, message) => {
      state.project = next
      state.messages.push(message)
    },
    setTempo: async (bpm, key, prefix) => {
      state.project = { ...state.project, bpm, key: key ?? state.project.key }
      state.messages.push(`${prefix}Tempo ${bpm} BPM`)
      return { adjusted: 0, skipped: 0 }
    },
    audioProvider: () => provider,
    vocalProvider: () => vocal,
    localSingerReady: () => singer.ready,
    singingPreference: () => singer.preference,
    singMelody: async (ustx, message) => {
      singer.sung.push(ustx)
      state.messages.push(message)
      return { trackId: 'tvoz', regionId: 'rvoz' }
    },
    myVoices: () => myVoices,
    convertVoice: async (regionId, opts) => {
      state.messages.push(`voice ${regionId} ${opts.voiceName} ${opts.pitch}`)
      return { trackId: 'tv', regionId: 'rv' }
    },
    generate: async (g) => {
      generated.push(g)
      const p = state.project
      const clipId = newId('clp')
      const region = {
        id: newId('rgn'),
        clipId,
        startBeat: g.atBeat,
        offsetSec: 0,
        lengthSec: barsToSeconds(g.bars, p),
        fadeInSec: 0,
        fadeOutSec: 0
      }
      const track = g.trackId
        ? p.tracks.find((t) => t.id === g.trackId)!
        : { ...createTrack(g.trackName ?? g.role, g.role), regions: [] }
      const tracks = g.trackId
        ? p.tracks.map((t) => (t.id === g.trackId ? { ...t, regions: [...t.regions, region] } : t))
        : [...p.tracks, { ...track, regions: [region] }]
      state.project = {
        ...p,
        tracks,
        clips: {
          ...p.clips,
          [clipId]: {
            id: clipId,
            file: '',
            durationSec: region.lengthSec,
            spec: {
              prompt: g.prompt,
              role: g.role,
              bpm: p.bpm,
              key: p.key,
              durationSec: region.lengthSec,
              mode: 'text',
              ...(g.lyrics && { lyrics: g.lyrics })
            },
            provider: g.lyrics ? 'huggingface' : 'demo'
          }
        }
      }
      return { trackId: track.id, regionId: region.id }
    },
    vary: async (regionId) => {
      state.messages.push(`vary ${regionId}`)
      return { trackId: 't', regionId: 'variada' }
    },
    extend: async (regionId, bars, opts) => {
      state.messages.push(`extend ${regionId} ${bars} ${opts?.instructions ?? ''}`.trim())
      return { trackId: 't', regionId: 'continuada' }
    },
    // Por defecto todo suena bien; un test puede decidir qué tramos se atascan.
    inspectRegion: async () => ({ collapseAtSec: null }),
    separate: async (regionId) => {
      state.messages.push(`separate ${regionId}`)
      return { trackIds: ['v', 'd'], stems: ['Voz', 'Batería'], skipped: ['Bajo'] }
    },
    playheadSec: () => 0,
    play: (sec) => {
      state.playedFrom = sec
    }
  }
  const tools = Object.fromEntries(createProducerTools(host).map((t) => [t.def.name, t]))
  const run = (name: string, input: Record<string, unknown> = {}) =>
    tools[name].run(input, new AbortController().signal)
  return { state, run, host, generated, myVoices, singer }
}

describe('herramientas del productor', () => {
  it('construye una canción: tempo, capas en paralelo y repetición', async () => {
    const { state, run } = fakeHost(createProject('Demo'))
    await run('set_tempo_key', { bpm: 90, key: 'A minor' })
    const [drums, bass] = (await Promise.all([
      run('generate_clip', { prompt: 'boom bap drums', role: 'drums', bars: 4, start_bar: 1 }),
      run('generate_clip', {
        prompt: 'deep bass',
        role: 'bass',
        bars: 4,
        start_bar: 1,
        track_name: 'Sub'
      })
    ])) as { region_id: string; track_id: string }[]
    const repeated = (await run('repeat_region', { region_id: drums.region_id, times: 3 })) as {
      ends_at_bar: number
    }

    expect(state.project.bpm).toBe(90)
    expect(state.project.tracks.map((t) => t.name)).toEqual(['drums', 'Sub'])
    expect(state.project.tracks[0].regions.map((r) => r.startBeat)).toEqual([0, 16, 32, 48])
    expect(repeated.ends_at_bar).toBe(17)
    expect(bass.track_id).toBe(state.project.tracks[1].id)
    expect(state.messages.every((m) => m.startsWith(AGENT_PREFIX))).toBe(true)
  })

  it('genre_guide da el estilo y la estructura de un género, o los conocidos si no está', async () => {
    const { run } = fakeHost(createProject('X'))
    const g = (await run('genre_guide', { genre: 'corridos tumbados' })) as {
      found: boolean
      bpm_range: number[]
      style: string
      example_prompts: string[]
    }
    expect(g.found).toBe(true)
    expect(g.style).toMatch(/requinto/)
    expect(g.example_prompts.length).toBeGreaterThan(10)
    const missing = (await run('genre_guide', { genre: 'polka checa' })) as {
      found: boolean
      known_genres: string[]
    }
    expect(missing.found).toBe(false)
    expect(missing.known_genres).toContain('cumbia')
  })

  it('describe el proyecto en compases, con el límite del motor', async () => {
    const { run } = fakeHost({ ...createProject('X'), bpm: 120 })
    await run('generate_clip', { prompt: 'pads', role: 'chords', bars: 2, start_bar: 3 })
    const state = (await run('get_project_state')) as {
      song_length_bars: number
      audio_engine: { max_bars_per_clip: number }
      tracks: { regions: { start_bar: number; length_bars: number; source: string }[] }[]
    }
    expect(state.song_length_bars).toBe(4)
    expect(state.audio_engine.max_bars_per_clip).toBe(15) // 30 s a 120 BPM en 4/4
    expect(state.tracks[0].regions[0]).toMatchObject({
      start_bar: 3,
      length_bars: 2,
      source: 'pads'
    })
  })

  it('rechaza parámetros inválidos con mensajes claros', async () => {
    const { run } = fakeHost(createProject('X'))
    await expect(
      run('generate_clip', { prompt: 'x', role: 'drums', bars: 99, start_bar: 1 })
    ).rejects.toThrow(/"bars" debe estar entre 1 y 15/)
    await expect(
      run('generate_clip', { prompt: 'x', role: 'kazoo', bars: 2, start_bar: 1 })
    ).rejects.toThrow(/"role" debe ser uno de/)
    await expect(run('set_track', { track_id: 'nope', mute: true })).rejects.toThrow(
      /No existe la pista/
    )
    await expect(run('set_tempo_key', {})).rejects.toThrow(/Indica bpm/)
  })

  it('avisa si el motor de audio no está listo', async () => {
    const { run } = fakeHost(createProject('X'), {
      ...demo,
      ready: false,
      notReadyReason: 'Falta la API key'
    })
    await expect(
      run('generate_clip', { prompt: 'x', role: 'drums', bars: 2, start_bar: 1 })
    ).rejects.toThrow(/no está listo: Falta la API key/)
  })

  it('mezcla, mueve, borra y reproduce', async () => {
    const { state, run } = fakeHost(createProject('X'))
    const a = (await run('generate_clip', {
      prompt: 'a',
      role: 'drums',
      bars: 2,
      start_bar: 1
    })) as {
      region_id: string
      track_id: string
    }
    const b = (await run('generate_clip', {
      prompt: 'b',
      role: 'bass',
      bars: 2,
      start_bar: 1
    })) as {
      track_id: string
    }
    await run('set_track', { track_id: a.track_id, gain_db: -3.3, pan: 0.33, name: 'Kit' })
    expect(state.project.tracks[0]).toMatchObject({ name: 'Kit', gainDb: -3.5, pan: 0.35 })

    await run('move_region', { region_id: a.region_id, start_bar: 5, track_id: b.track_id })
    expect(state.project.tracks[0].regions).toHaveLength(0)
    expect(secondsToBeats(0, 120) + state.project.tracks[1].regions[1].startBeat).toBe(16)

    await run('delete_track', { track_id: a.track_id })
    expect(state.project.tracks).toHaveLength(1)

    await run('play', { from_bar: 3 })
    expect(state.playedFrom).toBe(4) // compás 3 a 120 BPM en 4/4 = 4 s
  })

  it('calcula cuántos compases caben por clip', () => {
    expect(maxBarsPerClip({ ...createProject('x'), bpm: 90 }, demo)).toBe(11)
    expect(maxBarsPerClip(createProject('x'), undefined)).toBe(0)
  })

  it('pide variaciones y continuaciones al host con la región correcta', async () => {
    const { state, run } = fakeHost(createProject('X'))
    const a = (await run('generate_clip', {
      prompt: 'a',
      role: 'bass',
      bars: 4,
      start_bar: 1
    })) as {
      region_id: string
    }
    expect(await run('create_variation', { region_id: a.region_id })).toMatchObject({
      new_region_id: 'variada'
    })
    expect(
      await run('extend_region', { region_id: a.region_id, bars: 2, instructions: 'build up' })
    ).toMatchObject({ new_region_id: 'continuada', starts_at_bar: 5 })
    expect(state.messages.slice(-2)).toEqual([
      `vary ${a.region_id}`,
      `extend ${a.region_id} 2 build up`
    ])
    await expect(run('extend_region', { region_id: 'nope', bars: 2 })).rejects.toThrow(
      /No existe la región/
    )
  })

  it('planifica la estructura y copia una sección con su audio', async () => {
    const { state, run } = fakeHost({ ...createProject('X'), bpm: 120 })
    const planned = (await run('set_sections', {
      sections: [
        { name: 'Intro', start_bar: 1, bars: 2 },
        { name: 'Estribillo', start_bar: 3, bars: 4 }
      ]
    })) as { sections: { id: string; name: string }[] }
    const chorus = planned.sections[1]
    await run('generate_clip', { prompt: 'hook', role: 'melody', bars: 4, start_bar: 3 })

    const copied = (await run('copy_section', { section_id: chorus.id })) as { start_bar: number }
    expect(copied.start_bar).toBe(7)
    expect(state.project.tracks[0].regions.map((r) => r.startBeat)).toEqual([8, 24])

    const described = (await run('get_project_state')) as {
      sections: { name: string; start_bar: number }[]
    }
    expect(described.sections.map((s) => [s.name, s.start_bar])).toEqual([
      ['Intro', 1],
      ['Estribillo', 3],
      ['Estribillo', 7]
    ])
    await expect(
      run('set_sections', {
        sections: [
          { name: 'A', start_bar: 1, bars: 4 },
          { name: 'B', start_bar: 2, bars: 4 }
        ]
      })
    ).rejects.toThrow(/se solapa/)
  })

  it('tolera números como texto y secciones mal formateadas (modelos tipo Llama)', async () => {
    const { state, run } = fakeHost(createProject('X'))
    const clip = (await run('generate_clip', {
      prompt: 'boom bap drums',
      role: 'drums',
      bars: '8',
      start_bar: ' 1 '
    })) as { bars: number; start_bar: number }
    expect(clip).toMatchObject({ bars: 8, start_bar: 1 })
    await run('set_track', { track_id: state.project.tracks[0].id, mute: 'true' })
    expect(state.project.tracks[0].mute).toBe(true)
    await expect(
      run('generate_clip', { prompt: 'x', role: 'drums', bars: 'ocho', start_bar: 1 })
    ).rejects.toThrow(/"bars" debe ser un número/)

    const fromStrings = (await run('set_sections', {
      sections: '["Intro 4", "Verse 8", "Chorus 8"]'
    })) as { sections: { name: string; start_bar: number; bars: number }[] }
    expect(fromStrings.sections.map((s) => [s.name, s.start_bar, s.bars])).toEqual([
      ['Intro', 1, 4],
      ['Verse', 5, 8],
      ['Chorus', 13, 8]
    ])
    const chained = (await run('set_sections', {
      sections: [
        { name: 'A', bars: '4' },
        { name: 'B', bars: 2 }
      ]
    })) as { sections: { start_bar: number }[] }
    expect(chained.sections.map((s) => s.start_bar)).toEqual([1, 5])

    await expect(run('set_sections', { sections: ['Intro'] })).rejects.toThrow(/indica su duración/)
    await expect(run('set_sections', { sections: 'Intro, Verso' })).rejects.toThrow(
      /lista de objetos/
    )
  })

  it('separa una región en pistas a través del host', async () => {
    const { state, run } = fakeHost(createProject('X'))
    const a = (await run('generate_clip', {
      prompt: 'song',
      role: 'full',
      bars: 4,
      start_bar: 1
    })) as {
      region_id: string
    }
    expect(await run('separate_stems', { region_id: a.region_id })).toMatchObject({
      stems: ['Voz', 'Batería'],
      empty_stems_skipped: ['Bajo']
    })
    expect(state.messages.at(-1)).toBe(`separate ${a.region_id}`)
  })
})

describe('productor · canciones completas', () => {
  const songInput = {
    style: 'dark techno',
    bpm: 124,
    key: 'E minor',
    sections: [
      { name: 'Intro', bars: 8, energy: 2, arrangement: 'kick and pad' },
      { name: 'Verso', bars: 16, energy: 3, arrangement: 'bass and hats enter' },
      { name: 'Coro', bars: 12, energy: 5, arrangement: 'everything, acid lead' },
      { name: 'Coro', bars: 12, reuse: true }
    ]
  }

  type Composed = {
    ok: boolean
    bars_per_part: number
    parts_generated: number
    failed?: { section: string; start_bar: number; error: string }[]
    sections: { name: string; start_bar: number; has_music: boolean }[]
    check: string
  }

  /** Continuación en memoria, como en la app: región nueva en la misma pista. */
  function chainable(h: ReturnType<typeof fakeHost>) {
    const calls: {
      from: string
      bars: number
      prompt?: string
      atBeat?: number
      crossfade?: boolean
    }[] = []
    h.host.extend = async (regionId, bars, opts) => {
      calls.push({
        from: regionId,
        bars,
        prompt: opts?.prompt,
        atBeat: opts?.atBeat,
        crossfade: opts?.crossfade
      })
      const p = h.state.project
      const track = p.tracks.find((t) => t.regions.some((r) => r.id === regionId))!
      const src = track.regions.find((r) => r.id === regionId)!
      const clipId = newId('clp')
      const lengthSec = barsToSeconds(bars, p)
      const region = {
        ...src,
        id: newId('rgn'),
        clipId,
        offsetSec: 0,
        lengthSec,
        startBeat: opts?.atBeat ?? src.startBeat + secondsToBeats(src.lengthSec, p.bpm)
      }
      h.state.project = {
        ...p,
        tracks: p.tracks.map((t) =>
          t.id === track.id ? { ...t, regions: [...t.regions, region] } : t
        ),
        clips: {
          ...p.clips,
          [clipId]: {
            id: clipId,
            file: '',
            durationSec: lengthSec,
            spec: {
              prompt: opts?.prompt ?? '',
              role: track.role,
              bpm: p.bpm,
              key: p.key,
              durationSec: lengthSec,
              mode: 'continue'
            },
            provider: 'demo'
          }
        }
      }
      return { trackId: track.id, regionId: region.id }
    }
    return calls
  }

  /** Hace que los tramos que empiezan en ciertos beats "se atasquen" en el segundo dado. */
  function collapsing(h: ReturnType<typeof fakeHost>, byBeat: Record<number, number>) {
    const inspected: { beat: number; ignoreTailSec?: number }[] = []
    h.host.inspectRegion = async (regionId, opts) => {
      const region = h.state.project.tracks
        .flatMap((t) => t.regions)
        .find((r) => r.id === regionId)!
      inspected.push({ beat: region.startBeat, ignoreTailSec: opts?.ignoreTailSec })
      const at = byBeat[region.startBeat]
      // Cada beat se atasca una sola vez: la reparación (mismo beat o más tarde) suena bien.
      delete byBeat[region.startBeat]
      return { collapseAtSec: at ?? null }
    }
    return inspected
  }

  type Repaired = Composed & {
    repaired?: { section: string; start_bar: number; bars: number }[]
    drone?: { section: string; start_bar: number }[]
  }

  it('compose_song recorta un tramo atascado en un drone y regenera solo lo que falta', async () => {
    const h = fakeHost(createProject('X'))
    const calls = chainable(h)
    // A 124 BPM un compás dura ~1,94 s: atascarse a los 5 s deja 2 compases buenos.
    const inspected = collapsing(h, { 32: 5 })
    const res = (await h.run('compose_song', songInput)) as Repaired
    expect(res.ok).toBe(true)
    expect(res.repaired).toEqual([{ section: 'Verso', start_bar: 11, bars: 6 }])
    const song = h.state.project.tracks.find((t) => t.name === 'Canción')!
    const trimmed = song.regions.find((r) => r.startBeat === 32)!
    expect(trimmed.lengthSec).toBeCloseTo(barsToSeconds(2, h.state.project))
    // La reparación continúa desde el audio sano recortado, justo detrás.
    const repair = calls.find((c) => c.atBeat === 40)!
    expect(repair).toMatchObject({ from: trimmed.id, bars: 6 })
    // El final de la canción es el coro copiado: ningún tramo generado ignora su cola.
    expect(inspected.filter((i) => i.ignoreTailSec! > 0)).toEqual([])
  })

  it('compose_song no confunde el fundido final de la canción con un atasco', async () => {
    const h = fakeHost(createProject('X'))
    chainable(h)
    const inspected = collapsing(h, {})
    await h.run('compose_song', { ...songInput, sections: songInput.sections.slice(0, 2) })
    // Verso: tramos en los beats 32 y 64; el segundo termina la canción.
    expect(inspected.filter((i) => i.ignoreTailSec! > 0).map((i) => i.beat)).toEqual([64])
  })

  it('compose_song quita un tramo atascado desde el principio y continúa desde el anterior', async () => {
    const h = fakeHost(createProject('X'))
    const calls = chainable(h)
    collapsing(h, { 32: 0 })
    const res = (await h.run('compose_song', songInput)) as Repaired
    expect(res.repaired).toEqual([{ section: 'Verso', start_bar: 9, bars: 8 }])
    const atVerse = calls.filter((c) => c.atBeat === 32)
    expect(atVerse).toHaveLength(2)
    expect(atVerse[1].from).toBe(atVerse[0].from) // otra vez desde la intro
    const song = h.state.project.tracks.find((t) => t.name === 'Canción')!
    expect(song.regions.filter((r) => r.startBeat === 32)).toHaveLength(1)
  })

  it('compose_song repara una sola vez: si vuelve a atascarse, lo deja y avisa', async () => {
    const h = fakeHost(createProject('X'))
    const calls = chainable(h)
    h.host.inspectRegion = async (regionId) => {
      const r = h.state.project.tracks.flatMap((t) => t.regions).find((x) => x.id === regionId)!
      return { collapseAtSec: r.startBeat === 32 ? 0 : null }
    }
    const res = (await h.run('compose_song', songInput)) as Repaired
    expect(calls.filter((c) => c.atBeat === 32)).toHaveLength(2)
    expect(res.drone).toEqual([{ section: 'Verso', start_bar: 9 }])
  })

  it('compose_song tapa con compases sanos de la sección un tramo que se atasca dos veces', async () => {
    const h = fakeHost(createProject('X'))
    const calls = chainable(h)
    // La segunda mitad del verso (pulso 64) se calla siempre, también al repararla.
    h.host.inspectRegion = async (regionId) => {
      const r = h.state.project.tracks.flatMap((t) => t.regions).find((x) => x.id === regionId)!
      return { collapseAtSec: r.startBeat === 64 ? 0 : null }
    }
    const res = (await h.run('compose_song', songInput)) as Repaired & {
      filled?: { section: string; start_bar: number; bars: number }[]
    }
    expect(calls.filter((c) => c.atBeat === 64)).toHaveLength(2)
    expect(res.drone).toBeUndefined()
    expect(res.filled).toEqual([{ section: 'Verso', start_bar: 17, bars: 8 }])
    const song = h.state.project.tracks.find((t) => t.name === 'Canción')!
    const at64 = song.regions.filter((r) => r.startBeat === 64)
    expect(at64).toHaveLength(1)
    expect(at64[0].clipId).toBe(song.regions.find((r) => r.startBeat === 32)!.clipId)
    // El coro continúa desde el loop, no desde el tramo atascado.
    expect(calls.find((c) => c.atBeat === 96)!.from).toBe(at64[0].id)
  })

  it('compose_song iguala el volumen: un coro apagado sube', async () => {
    const h = fakeHost(createProject('X'))
    chainable(h)
    const level = (db: number) => ({
      head: { db, highDb: -15, pulseDb: 5 },
      tail: { db, highDb: -15, pulseDb: 5 },
      mean: { db, highDb: -15, pulseDb: 5 },
      staticRun: null,
      opening: [db, db, db]
    })
    h.host.inspectRegion = async (regionId) => {
      const r = h.state.project.tracks.flatMap((t) => t.regions).find((x) => x.id === regionId)!
      return { collapseAtSec: null, sound: level(r.startBeat >= 96 ? -29 : -19) }
    }
    const res = (await h.run('compose_song', songInput)) as Composed & {
      review: { sections: { name: string; level_db: number }[] }
    }
    const song = h.state.project.tracks.find((t) => t.name === 'Canción')!
    const coro = song.regions.filter((r) => r.startBeat >= 96)
    expect(coro.length).toBeGreaterThan(0)
    for (const r of coro) expect(r.gainDb).toBeGreaterThan(0)
    // La revisión oye la mezcla: el coro ya no queda 10 dB por debajo.
    const coroDb = res.review.sections.find((x) => x.name === 'Coro')!.level_db
    expect(coroDb).toBeGreaterThan(-25)
  })

  it('genre_guide sigue la fusión que pidió el usuario aunque el LLM pregunte por una parte', async () => {
    const h = fakeHost(createProject('X'))
    h.host.userMessages = () => [
      'quiero un house/techno bien tumbado al estilo de Victor Mendivil, con letra'
    ]
    const g = (await h.run('genre_guide', { genre: 'techno' })) as { genre: string }
    expect(g.genre).toBe('house-tumbado')
    // Sin fusión en sus palabras, manda la consulta.
    h.host.userMessages = () => ['algo tranquilo', 'un reggaeton']
    expect(((await h.run('genre_guide', { genre: 'techno' })) as { genre: string }).genre).toBe(
      'techno'
    )
  })

  it('compose_song lleva el tempo al rango del género consultado', async () => {
    const h = fakeHost(createProject('X'))
    chainable(h)
    await h.run('genre_guide', { genre: 'house/techno bien tumbado' })
    const res = (await h.run('compose_song', { ...songInput, bpm: 108 })) as {
      bpm: number
      tempo_note?: string
    }
    expect(res.bpm).toBe(124)
    expect(res.tempo_note).toMatch(/house-tumbado/)
  })

  it('compose_song usa el estilo de la guía si el del productor no nombra el género', async () => {
    const h = fakeHost(createProject('X'))
    const calls = chainable(h)
    await h.run('genre_guide', { genre: 'house tumbado' })
    const res = (await h.run('compose_song', {
      ...songInput,
      style: 'industrial techno, distorted kick'
    })) as { style_note?: string }
    expect(res.style_note).toMatch(/industrial techno/)
    expect(h.state.project.style).toMatch(/^tech house, /)
    expect(calls[0].prompt).toMatch(/^tech house, .*guitar riff/)
    // Si ya lo nombra, se respeta.
    await h.run('compose_song', { ...songInput, style: 'tech house, congas, guitar' })
    expect(h.state.project.style).toBe('tech house, congas, guitar')
  })

  it('compose_song escucha la canción al final y avisa si el coro no sube', async () => {
    const h = fakeHost(createProject('X'))
    chainable(h)
    h.host.inspectRegion = async (regionId) => {
      const r = h.state.project.tracks.flatMap((t) => t.regions).find((x) => x.id === regionId)!
      // El Coro (energía 5) suena tan por debajo del verso que ni igualando sube del todo.
      const s = { db: r.startBeat >= 96 ? -30 : -14, highDb: -15, pulseDb: 5 }
      return {
        collapseAtSec: null,
        sound: { head: s, tail: s, mean: s, staticRun: null, opening: [] }
      }
    }
    const res = (await h.run('compose_song', songInput)) as {
      review: { issues: { type: string; section: string }[]; sections: unknown[] }
    }
    expect(res.review.sections.length).toBeGreaterThan(0)
    expect(res.review.issues).toContainEqual(
      expect.objectContaining({ type: 'flat_energy', section: 'Coro' })
    )
    const again = (await h.run('review_song')) as { issues: unknown[] }
    expect(again.issues).toEqual(res.review.issues)
  })

  it('compose_song siempre continúa lo anterior (sin cortes)', async () => {
    const h = fakeHost(createProject('X'))
    const calls = chainable(h)
    await h.run('compose_song', songInput)
    const song = h.state.project.tracks.find((t) => t.name === 'Canción')!
    const at = (beat: number): string => song.regions.find((r) => r.startBeat === beat)!.id
    // A mitad del verso (beat 64) y al entrar al coro (beat 96): continúa y se funde.
    expect(calls.find((c) => c.atBeat === 64)).toMatchObject({ from: at(32), crossfade: true })
    expect(calls.find((c) => c.atBeat === 96)).toMatchObject({ from: at(64), crossfade: true })
  })

  it('compose_song repara un atasco continuando lo anterior si está sano', async () => {
    const h = fakeHost(createProject('X'))
    const calls = chainable(h)
    let stuck = true
    h.host.inspectRegion = async (regionId) => {
      const r = h.state.project.tracks.flatMap((t) => t.regions).find((x) => x.id === regionId)!
      // El tramo del beat 64 se atasca desde el principio la primera vez.
      const collapse = r.startBeat === 64 && stuck ? 0 : null
      if (r.startBeat === 64) stuck = false
      return { collapseAtSec: collapse }
    }
    await h.run('compose_song', songInput)
    const song = h.state.project.tracks.find((t) => t.name === 'Canción')!
    const at = (beat: number): string => song.regions.find((r) => r.startBeat === beat)!.id
    const tries = calls.filter((c) => c.atBeat === 64)
    expect(tries).toHaveLength(2)
    expect(tries[1]).toMatchObject({ from: at(32), crossfade: true })
  })

  it('compose_song continúa desde la última región sana si la anterior quedó atascada', async () => {
    const h = fakeHost(createProject('X'))
    const calls = chainable(h)
    // El primer tramo del verso (beat 32) se atasca siempre y no hay compases sanos del
    // verso con que taparlo: se queda.
    h.host.inspectRegion = async (regionId) => {
      const r = h.state.project.tracks.flatMap((t) => t.regions).find((x) => x.id === regionId)!
      return { collapseAtSec: r.startBeat === 32 ? 0 : null }
    }
    const res = (await h.run('compose_song', songInput)) as Repaired
    expect(res.drone).toEqual([{ section: 'Verso', start_bar: 9 }])
    const song = h.state.project.tracks.find((t) => t.name === 'Canción')!
    const intro = song.regions.find((r) => r.startBeat === 0)!.id
    // El tramo siguiente no escucha ese final atascado, sino la intro, sin fundirse.
    expect(calls.find((c) => c.atBeat === 64)).toMatchObject({ from: intro, crossfade: false })
  })

  it('compose_song no continúa un tramo que termina apagado', async () => {
    const h = fakeHost(createProject('X'))
    const calls = chainable(h)
    const sound = (head: number, tail: number) => ({
      head: { db: head, highDb: -15, pulseDb: 5 },
      tail: { db: tail, highDb: -15, pulseDb: 5 },
      mean: { db: head, highDb: -15, pulseDb: 5 },
      staticRun: null,
      opening: [head, head, head, head, head, head]
    })
    // El tramo del beat 32 acaba 18 dB por debajo de como empezó (test11: el break).
    h.host.inspectRegion = async (regionId) => {
      const r = h.state.project.tracks.flatMap((t) => t.regions).find((x) => x.id === regionId)!
      return { collapseAtSec: null, sound: r.startBeat === 32 ? sound(-20, -38) : sound(-20, -20) }
    }
    const res = (await h.run('compose_song', songInput)) as Repaired
    expect(res.repaired).toBeUndefined()
    const song = h.state.project.tracks.find((t) => t.name === 'Canción')!
    const intro = song.regions.find((r) => r.startBeat === 0)!.id
    expect(calls.find((c) => c.atBeat === 64)).toMatchObject({ from: intro, crossfade: false })
  })

  describe('final apagado de un tramo', () => {
    const sound = (head: number, tail: number) => ({
      head: { db: head, highDb: -15, pulseDb: 5 },
      tail: { db: tail, highDb: -15, pulseDb: 5 },
      mean: { db: head, highDb: -15, pulseDb: 5 },
      staticRun: null,
      opening: [head, head, head, head, head, head]
    })
    /** El segundo tramo del verso (beat 64) termina 15 dB por debajo de como empezó. */
    function fadingVerse(h: ReturnType<typeof fakeHost>) {
      h.host.inspectRegion = async (regionId) => {
        const r = h.state.project.tracks.flatMap((t) => t.regions).find((x) => x.id === regionId)!
        return {
          collapseAtSec: null,
          sound: r.startBeat === 64 ? sound(-15, -30) : sound(-15, -15)
        }
      }
    }
    type Healed = Repaired & { healed?: { section: string; start_bar: number; bars: number }[] }

    it('se tapa con un final de frase sano de la sección y el coro se funde con él', async () => {
      const h = fakeHost(createProject('X'))
      const calls = chainable(h)
      fadingVerse(h)
      const res = (await h.run('compose_song', songInput)) as Healed
      expect(res.healed).toEqual([{ section: 'Verso', start_bar: 24, bars: 1 }])
      expect(res.repaired).toBeUndefined()
      const song = h.state.project.tracks.find((t) => t.name === 'Canción')!
      const bar = barsToSeconds(1, h.state.project)
      expect(song.regions.find((r) => r.startBeat === 64)!.lengthSec).toBeCloseTo(7 * bar)
      // El compás 24 (último de una frase) lo toca el compás 16, también fin de frase.
      const first = song.regions.find((r) => r.startBeat === 32)!
      const patch = song.regions.find((r) => r.startBeat === 92)!
      expect(patch.clipId).toBe(first.clipId)
      expect(patch.offsetSec).toBeCloseTo(first.offsetSec + 7 * bar)
      expect(calls.find((c) => c.atBeat === 96)).toMatchObject({ from: patch.id, crossfade: true })
    })

    it('no se toca si el arreglo pide acabar apagándose', async () => {
      const h = fakeHost(createProject('X'))
      const calls = chainable(h)
      fadingVerse(h)
      const sections = songInput.sections.map((s) =>
        s.name === 'Verso' ? { ...s, arrangement: 'bass and hats, fade out' } : s
      )
      const res = (await h.run('compose_song', { ...songInput, sections })) as Healed
      expect(res.healed).toBeUndefined()
      expect(calls.find((c) => c.atBeat === 96)).toMatchObject({ crossfade: false })
    })
  })

  it('compose_song repara como mucho cuatro tramos', async () => {
    const h = fakeHost(createProject('X'))
    const calls = chainable(h)
    // Todo tramo entero se atasca a la mitad (la intro no); las reparaciones salen bien.
    h.host.inspectRegion = async (regionId) => {
      const r = h.state.project.tracks.flatMap((t) => t.regions).find((x) => x.id === regionId)!
      return { collapseAtSec: r.startBeat > 0 && r.lengthSec > 10 ? 8 : null }
    }
    const part = (name: string, energy: number) => ({ name, bars: 8, energy, arrangement: 'bass' })
    const res = (await h.run('compose_song', {
      ...songInput,
      sections: [
        part('Intro', 2),
        part('Verso', 3),
        part('Coro', 5),
        part('Puente', 3),
        part('Break', 2),
        part('Subida', 4),
        part('Outro', 2)
      ]
    })) as Repaired
    expect(res.repaired).toHaveLength(4)
    // Pasado el tope no se vuelve a grabar: la subida y el outro se quedan como están.
    expect(res.drone?.map((d) => d.section)).toEqual(['Subida', 'Outro'])
    expect(calls).toHaveLength(6 + 4)
  })

  it('compose_song regenera un tramo que empieza con un hueco tras la unión', async () => {
    const h = fakeHost(createProject('X'))
    const calls = chainable(h)
    let first = true
    h.host.inspectRegion = async (regionId) => {
      const r = h.state.project.tracks.flatMap((t) => t.regions).find((x) => x.id === regionId)!
      const loud = { db: -14, highDb: -10, pulseDb: 5 }
      // El primer verso (beat 32) se calla 1,5 s tras el fundido.
      const silent = r.startBeat === 32 && first
      if (r.startBeat === 32) first = false
      const opening = silent ? [-40, -45, -50, -48, -40, -20] : [-15, -14, -16, -15, -14, -15]
      return {
        collapseAtSec: null,
        sound: { head: loud, tail: loud, mean: loud, staticRun: null, opening }
      }
    }
    const res = (await h.run('compose_song', songInput)) as {
      repaired?: { section: string; start_bar: number; bars: number }[]
    }
    expect(res.repaired).toEqual([{ section: 'Verso', start_bar: 9, bars: 8 }])
    expect(calls.filter((c) => c.atBeat === 32)).toHaveLength(2)
  })

  /** Batería en memoria: el plan real de drums.ts, con clips sin audio. */
  function withFakeDrums(h: ReturnType<typeof fakeHost>) {
    const applied: Parameters<NonNullable<ProducerHost['applyDrums']>>[0][] = []
    h.host.applyDrums = async (opts) => {
      applied.push(opts)
      const p = h.state.project
      const sections = sectionsOf(p)
      const pattern = findPattern(opts.pattern)!
      const hits = drumPlan(sections, 4, pattern, { intensity: opts.intensity })
      const clips = sections.map((s) => ({
        id: newId('clp'),
        file: '',
        durationSec: barsToSeconds(s.bars, p),
        spec: null,
        provider: 'drums'
      }))
      h.state.project = withDrumTrack(p, {
        pattern: pattern.id,
        intensity: opts.intensity ?? 0,
        sections,
        clips,
        kicks: kickBeats(hits),
        bedTrackId: opts.bedTrackId
      })
      return { trackId: h.state.project.tracks.find((t) => t.drums)!.id }
    }
    h.host.removeDrums = async () => {
      h.state.project = withoutDrums(h.state.project)
    }
    return applied
  }

  const houseSong = {
    style: 'groovy house, four-on-the-floor kick, bassline',
    bpm: 124,
    sections: [
      { name: 'Intro', bars: 8, energy: 2, arrangement: 'kick and hats' },
      { name: 'Coro', bars: 8, energy: 5, arrangement: 'full groove' },
      { name: 'Verso', bars: 8, energy: 3, arrangement: 'bass and congas' },
      { name: 'Coro', bars: 8, energy: 5, arrangement: 'full groove' }
    ]
  }

  it('en house, compose_song pone batería programada, filtros y sidechain', async () => {
    const h = fakeHost(createProject('X'))
    chainable(h)
    const applied = withFakeDrums(h)
    await h.run('genre_guide', { genre: 'house' })
    const res = (await h.run('compose_song', houseSong)) as { drums?: string }
    expect(res.drums).toMatch(/house/)
    const p = h.state.project
    const drums = p.tracks.find((t) => t.drums)!
    expect(drums.regions).toHaveLength(4)
    const song = p.tracks.find((t) => t.name === 'Canción')!
    expect(applied[0].bedTrackId).toBe(song.id)
    expect(song.duck!.beats.length).toBeGreaterThan(0)
    expect(song.sweeps!.lowpass![0]).toEqual({ beat: 0, hz: 500 })
  })

  it('con batería programada, el coro repetido reutiliza el primero', async () => {
    const h = fakeHost(createProject('X'))
    const calls = chainable(h)
    withFakeDrums(h)
    await h.run('genre_guide', { genre: 'house' })
    await h.run('compose_song', houseSong)
    // El segundo coro (compás 25, pulso 96) no se graba: se copia.
    expect(calls.some((c) => c.atBeat === 96)).toBe(false)
    const song = h.state.project.tracks.find((t) => t.name === 'Canción')!
    expect(song.regions.some((r) => r.startBeat === 96)).toBe(true)
    // Sin guía de un género con batería, se graba como siempre.
    const plain = fakeHost(createProject('Y'))
    const plainCalls = chainable(plain)
    await plain.run('compose_song', houseSong)
    expect(plainCalls.some((c) => c.atBeat === 96)).toBe(true)
  })

  it('con batería, la cama no pide filtro ni percusión (lo hacen la mezcla y la batería)', async () => {
    const h = fakeHost(createProject('X'))
    const calls = chainable(h)
    withFakeDrums(h)
    await h.run('genre_guide', { genre: 'house' })
    await h.run('compose_song', {
      ...houseSong,
      sections: [
        {
          ...houseSong.sections[0],
          arrangement: 'filtered kick and metallic percussion, distorted stab'
        },
        ...houseSong.sections.slice(1)
      ]
    })
    // El estilo de la guía de house también pierde su bombo y sus hats.
    expect(h.generated[0].prompt).toBe(
      'house music, groovy bassline, piano chords, distorted stab, intro, groove, 124 bpm, C minor, build-up at the end'
    )
    const prompts = [...h.generated.map((g) => g.prompt), ...calls.map((c) => c.prompt ?? '')]
    for (const t of prompts) expect(t).not.toMatch(/filtered|kick|percussion|drum|soft/)
  })

  it('con batería, un coro que salió atascado no se repite: se graba otra vez', async () => {
    const h = fakeHost(createProject('X'))
    const calls = chainable(h)
    withFakeDrums(h)
    // El primer coro (pulso 32) se queda en drone, también al repararlo.
    h.host.inspectRegion = async (regionId) => {
      const r = h.state.project.tracks.flatMap((t) => t.regions).find((x) => x.id === regionId)!
      return { collapseAtSec: r.startBeat === 32 ? 0 : null }
    }
    await h.run('genre_guide', { genre: 'house' })
    const res = (await h.run('compose_song', houseSong)) as { drone: { start_bar: number }[] }
    expect(res.drone).toEqual([expect.objectContaining({ start_bar: 9 })])
    // El segundo coro (pulso 96) se graba en vez de copiar el atascado.
    expect(calls.some((c) => c.atBeat === 96)).toBe(true)
    const song = h.state.project.tracks.find((t) => t.name === 'Canción')!
    const at96 = song.regions.filter((r) => r.startBeat === 96)
    expect(at96).toHaveLength(1)
    expect(at96[0].clipId).not.toBe(song.regions.find((r) => r.startBeat === 32)!.clipId)
  })

  it('con batería, la revisión no marca lo que la batería tapa', async () => {
    const h = fakeHost(createProject('X'))
    chainable(h)
    withFakeDrums(h)
    h.host.inspectRegion = async (regionId) => {
      const r = h.state.project.tracks.flatMap((t) => t.regions).find((x) => x.id === regionId)!
      // Cama oscura; el coro (pulso 32) entra mucho más apagado y termina más fuerte:
      // con batería solo cuenta un salto de volumen grande.
      const s = { db: -18, highDb: -30, pulseDb: 5 }
      const head = r.startBeat === 32 ? { ...s, highDb: -42 } : s
      const tail = r.startBeat === 32 ? { ...s, db: -10 } : s
      return { collapseAtSec: null, sound: { head, tail, mean: s, staticRun: null, opening: [] } }
    }
    await h.run('genre_guide', { genre: 'house' })
    const res = (await h.run('compose_song', houseSong)) as {
      review: { issues: { type: string; bar?: number }[] }
    }
    expect(res.review.issues).toEqual([expect.objectContaining({ type: 'seam', bar: 17 })])
    const again = (await h.run('review_song')) as { issues: unknown[] }
    expect(again.issues).toEqual(res.review.issues)
  })

  it('set_drums cambia el patrón en segundos y "off" la quita', async () => {
    const h = fakeHost(createProject('X'))
    chainable(h)
    withFakeDrums(h)
    await h.run('genre_guide', { genre: 'house' })
    await h.run('compose_song', houseSong)
    const before = h.state.project.tracks.find((t) => t.drums)!
    await h.run('set_drums', { pattern: 'techno', intensity: 1 })
    const after = h.state.project.tracks.find((t) => t.drums)!
    expect(after).toMatchObject({ id: before.id, drums: { pattern: 'techno', intensity: 1 } })
    await h.run('set_drums', { pattern: 'off' })
    expect(h.state.project.tracks.some((t) => t.drums)).toBe(false)
    expect(h.state.project.tracks.find((t) => t.name === 'Canción')!.duck).toBeUndefined()
    await expect(h.run('set_drums', { pattern: 'polka' })).rejects.toThrow(/No existe el patrón/)
  })

  it('redo_sections rehace solo esas secciones, continuando lo que suena antes', async () => {
    const h = fakeHost(createProject('X'))
    const calls = chainable(h)
    await h.run('compose_song', songInput)
    const before = h.state.project.tracks.find((t) => t.name === 'Canción')!.regions
    const intro = before.find((r) => r.startBeat === 0)!
    const chorus = before.find((r) => r.startBeat === 96)!
    const verse = h.state.project.sections!.find((s) => s.name === 'Verso')!
    calls.length = 0
    const progress: string[] = []
    const tool = createProducerTools(h.host).find((t) => t.def.name === 'redo_sections')!
    const res = (await tool.run({ section_ids: [verse.id] }, new AbortController().signal, (t) =>
      progress.push(t)
    )) as { ok: boolean; redone: string[]; parts_generated: number }
    expect(res).toMatchObject({ ok: true, redone: ['Verso'], parts_generated: 2 })
    // Los dos tramos del verso (beats 32 y 64), el primero tras la intro.
    expect(calls.map((c) => c.atBeat)).toEqual([32, 64])
    expect(calls[0]).toMatchObject({ from: intro.id, crossfade: true })
    const after = h.state.project.tracks.find((t) => t.name === 'Canción')!.regions
    expect(after.find((r) => r.startBeat === 0)!.id).toBe(intro.id)
    expect(after.find((r) => r.startBeat === 96)!.id).toBe(chorus.id)
    expect(after.filter((r) => r.startBeat === 32)).toHaveLength(1)
    expect(after.find((r) => r.startBeat === 32)!.id).not.toBe(
      before.find((r) => r.startBeat === 32)!.id
    )
    expect(progress[0]).toMatch(/^Parte 1 de 2 · Verso \(compases 9–16\)$/)
    expect(progress[1]).toMatch(/^Parte 2 de 2 · Verso/)
  })

  it('compose_song continúa un coro repetido sin copiar desde lo que suena antes', async () => {
    const h = fakeHost(createProject('X'))
    const calls = chainable(h)
    await h.run('compose_song', {
      ...songInput,
      sections: [
        { name: 'Coro', bars: 8, energy: 5, arrangement: 'hook' },
        { name: 'Verso', bars: 8, energy: 3, arrangement: 'groove' },
        { name: 'Coro 2', bars: 8, energy: 5, arrangement: 'hook bigger' }
      ]
    })
    const song = h.state.project.tracks.find((t) => t.name === 'Canción')!
    const verse = song.regions.find((r) => r.startBeat === 32)!
    // Escuchar el primer coro daría un cambio en seco tras el verso.
    expect(calls.find((c) => c.atBeat === 64)!.from).toBe(verse.id)
  })

  it('compose_song graba la canción como una sola pieza: tramos encadenados de principio a fin', async () => {
    const imported = {
      ...createTrack('Mi audio', 'full'),
      regions: [
        {
          id: 'imp',
          clipId: 'imp',
          startBeat: 0,
          offsetSec: 0,
          lengthSec: 4,
          fadeInSec: 0,
          fadeOutSec: 0
        }
      ]
    }
    const h = fakeHost({
      ...createProject('X'),
      tracks: [imported],
      clips: { imp: { id: 'imp', file: '', durationSec: 4, spec: null, provider: 'import' } }
    })
    const calls = chainable(h)
    await h.run('generate_clip', { prompt: 'old', role: 'melody', bars: 4, start_bar: 1 })

    const res = (await h.run('compose_song', songInput)) as Composed
    const p = h.state.project
    expect(res.ok).toBe(true)
    expect(res.bars_per_part).toBe(8)
    expect(res.parts_generated).toBe(5) // Intro 8 · Verso 8+8 · Coro 8+4 (el segundo se repite)
    expect(res.check).toBe('Every section has music.')
    expect(res.sections.every((s) => s.has_music)).toBe(true)
    expect(p.bpm).toBe(124)
    expect(p.key).toBe('E minor')
    expect(p.style).toBe('dark techno')
    // Lo generado antes desaparece; lo importado se queda. Una sola pista para la canción.
    expect(p.tracks.map((t) => [t.name, t.role])).toEqual([
      ['Mi audio', 'full'],
      ['Canción', 'full']
    ])

    // El primer tramo se genera; cada siguiente continúa al anterior en su compás.
    const songTrack = p.tracks[1]
    const byStart = [...songTrack.regions].sort((a, b) => a.startBeat - b.startBeat)
    expect(calls.map((c) => [c.atBeat, c.bars])).toEqual([
      [32, 8],
      [64, 8],
      [96, 8],
      [128, 4]
    ])
    calls.forEach((c, i) => expect(c.from).toBe(byStart[i].id))
    expect(calls[2].prompt).toMatch(/^dark techno, everything, acid lead, energetic/)
    expect(calls[2].prompt).toMatch(/124 bpm, E minor/)
    expect(calls[1].prompt).toMatch(/build-up and drum fill at the end$/)

    // El último coro repite el primero; la canción llega al final sin huecos.
    expect(byStart.map((r) => r.startBeat)).toEqual([0, 32, 64, 96, 128, 144, 176])
    expect(byStart[5].clipId).toBe(byStart[3].clipId)
    // Pulido: entrada en fundido de un compás y salida de dos.
    const bar = barsToSeconds(1, p)
    expect(byStart[0].fadeInSec).toBeCloseTo(bar)
    expect(byStart.at(-1)!.fadeOutSec).toBeCloseTo(2 * bar)
    expect(byStart[2].fadeOutSec).toBe(0.01)
    expect(h.state.messages.some((m) => m.startsWith(`${AGENT_PREFIX}nueva canción`))).toBe(true)
  })

  it('compose_song valida antes de tocar nada y exige un motor que sepa continuar', async () => {
    const h = fakeHost(createProject('X'))
    await expect(
      h.run('compose_song', { ...songInput, sections: [{ name: 'A', bars: 8 }] })
    ).rejects.toThrow(/falta "arrangement"/)
    expect(h.state.messages).toEqual([])

    const noContinue = {
      ...demo,
      capabilities: { ...demo.capabilities, supportsContinue: false }
    }
    await expect(
      fakeHost(createProject('X'), noContinue).run('compose_song', songInput)
    ).rejects.toThrow(/no sabe continuar audio/)
  })

  it('compose_song reintenta un tramo que falla y sigue desde el último bueno', async () => {
    const h = fakeHost(createProject('X'))
    const calls = chainable(h)
    const extend = h.host.extend
    h.host.extend = async (regionId, bars, opts) => {
      if (opts?.atBeat === 64) {
        calls.push({ from: regionId, bars, atBeat: 64 })
        throw new Error('sin memoria')
      }
      return extend(regionId, bars, opts)
    }
    const res = (await h.run('compose_song', songInput)) as Composed
    expect(res.ok).toBe(false)
    expect(res.failed).toEqual([{ section: 'Verso', start_bar: 17, error: 'sin memoria' }])
    expect(calls.filter((c) => c.atBeat === 64)).toHaveLength(2) // reintento
    // El coro continúa desde el primer tramo del verso, el último que salió bien.
    const verse1 = calls.find((c) => c.atBeat === 32)!
    const chorus = calls.find((c) => c.atBeat === 96)!
    const song = h.state.project.tracks.find((t) => t.name === 'Canción')!
    expect(chorus.from).toBe(song.regions.find((r) => r.startBeat === verse1.atBeat)!.id)
    expect(res.check).toMatch(/"Verso".*stop\(s\) before the section ends/)
  })

  it('fill_section rellena por nombre todas las secciones iguales en la pista del instrumento', async () => {
    const { state, run } = fakeHost(createProject('X'))
    await run('set_sections', {
      sections: [
        { name: 'Intro', start_bar: 1, bars: 4 },
        { name: 'Coro', start_bar: 5, bars: 16 },
        { name: 'Coro', start_bar: 21, bars: 12 }
      ]
    })
    const melodyTracks = () => state.project.tracks.filter((t) => t.role === 'melody')
    const res = (await run('fill_section', {
      section: 'coro',
      role: 'melody',
      prompt: 'new lead'
    })) as { filled: { name: string; bars: number }[]; loop_bars: number }
    expect(res.filled.map((s) => s.bars)).toEqual([16, 12])
    expect(res.loop_bars).toBe(8)
    expect(melodyTracks()).toHaveLength(1)
    const prompts = new Set(
      melodyTracks()[0].regions.map((r) => state.project.clips[r.clipId].spec!.prompt)
    )
    expect(prompts).toEqual(new Set(['new lead']))

    await expect(
      run('fill_section', { section: 'Puente', role: 'bass', prompt: 'x' })
    ).rejects.toThrow(/No existe la sección "Puente". Secciones: Intro/)
  })

  it('generate_clip reutiliza la pista del mismo instrumento si está libre', async () => {
    const { state, run } = fakeHost(createProject('X'))
    const clip = (startBar: number) =>
      run('generate_clip', {
        prompt: 'k',
        role: 'drums',
        bars: 4,
        start_bar: startBar
      }) as Promise<{
        track_id: string
      }>
    const a = await clip(1)
    const b = await clip(5)
    const c = await clip(3)
    expect(b.track_id).toBe(a.track_id)
    expect(c.track_id).not.toBe(a.track_id) // ahí ya suena algo: pista nueva
    expect(state.project.tracks).toHaveLength(2)
  })

  it('copy_section copia dentro de una sección ya planificada en vez de fallar', async () => {
    const { state, run } = fakeHost({ ...createProject('X'), bpm: 120 })
    const planned = (await run('set_sections', {
      sections: [
        { name: 'Coro', start_bar: 1, bars: 4 },
        { name: 'Coro', start_bar: 5, bars: 4 },
        { name: 'Coro', start_bar: 9, bars: 4 }
      ]
    })) as { sections: { id: string }[] }
    const [first, second, third] = planned.sections
    await run('generate_clip', { prompt: 'hook', role: 'melody', bars: 4, start_bar: 1 })

    // Lo que hizo el productor en la canción real: to_bar donde ya hay una sección.
    expect(await run('copy_section', { section_id: first.id, to_bar: 5 })).toMatchObject({
      section_id: second.id
    })
    await run('copy_section', { section_id: first.id, to_section_id: third.id })
    expect(state.project.sections).toHaveLength(3)
    expect(state.project.tracks[0].regions.map((r) => r.startBeat)).toEqual([0, 16, 32])

    const described = (await run('get_project_state')) as { sections: { status: string }[] }
    expect(described.sections.map((s) => s.status)).toEqual([
      'only one layer',
      'only one layer',
      'only one layer'
    ])
  })
})

describe('canciones con voz', () => {
  const sungSong = {
    style: 'romantic cumbia, accordion, guiro',
    bpm: 96,
    key: 'A minor',
    vocals: 'warm male latin vocal',
    language: 'es',
    sections: [
      { name: 'Intro', bars: 4, arrangement: 'accordion riff' },
      {
        name: 'Verso',
        bars: 16,
        arrangement: 'groove enters',
        lyrics: 'Caminando por la playa\nbajo el sol de la mañana'
      },
      { name: 'Coro', bars: 8, arrangement: 'full band', lyrics: 'Ay amor, ven a bailar' },
      { name: 'Outro', bars: 4, arrangement: 'fade' }
    ]
  }

  it('compose_song con letra canta la canción entera de una vez con el motor de voz', async () => {
    const h = fakeHost(createProject('X'), demo, singer)
    const res = (await h.run('compose_song', sungSong)) as { ok: boolean; sung: boolean }

    expect(res).toMatchObject({ ok: true, sung: true })
    // Una sola generación desde el compás 1 con toda la canción y su letra.
    expect(h.generated).toHaveLength(1)
    expect(h.generated[0]).toMatchObject({
      role: 'full',
      bars: 32,
      atBeat: 0,
      prompt: 'romantic cumbia, accordion, guiro, warm male latin vocal',
      lyricsLanguage: 'es'
    })
    expect(h.generated[0].lyrics).toBe(
      '[Intro]\n\n[Verse]\nCaminando por la playa\nbajo el sol de la mañana\n\n[Chorus]\nAy amor, ven a bailar\n\n[Outro]'
    )
    const p = h.state.project
    expect(p.vocals).toBe('warm male latin vocal')
    expect(p.sections!.map((s) => s.lyrics ?? null)).toEqual([
      null,
      'Caminando por la playa\nbajo el sol de la mañana',
      'Ay amor, ven a bailar',
      null
    ])
    expect(p.tracks.map((t) => t.name)).toEqual(['Canción'])
    expect(p.tracks[0].regions).toHaveLength(1)
  })

  it('compose_song con letra falla con un error claro si no hay motor de voz o la canción es larga', async () => {
    const sinVoz = fakeHost(createProject('X'))
    await expect(sinVoz.run('compose_song', sungSong)).rejects.toThrow(/instrumental/)
    expect(sinVoz.state.project.sections).toBeUndefined() // no tocó nada

    const larga = fakeHost(createProject('X'), demo, singer)
    await expect(
      larga.run('compose_song', {
        ...sungSong,
        bpm: 60,
        sections: [...sungSong.sections, { name: 'Coro', bars: 64, arrangement: 'x', lyrics: 'la' }]
      })
    ).rejects.toThrow(/canta como mucho 240 s/)
    expect(larga.generated).toHaveLength(0)
  })

  it('sing_song cambia la letra de una sección y la voz, y sustituye la toma anterior', async () => {
    const h = fakeHost(createProject('X'), demo, singer)
    await h.run('compose_song', sungSong)
    const coro = h.state.project.sections!.find((s) => s.name === 'Coro')!
    const before = h.state.project.tracks[0].regions[0].id

    await h.run('sing_song', {
      lyrics: [{ section_id: coro.id, text: 'Nueva letra del coro' }],
      vocals: 'deep female vocal'
    })
    const p = h.state.project
    expect(h.generated).toHaveLength(2)
    expect(h.generated[1].lyrics).toContain('[Chorus]\nNueva letra del coro')
    expect(h.generated[1].prompt).toContain('deep female vocal')
    expect(p.tracks).toHaveLength(1)
    expect(p.tracks[0].regions.map((r) => r.id)).not.toContain(before)
    expect(p.tracks[0].regions).toHaveLength(1)

    await expect(
      h.run('sing_song', { lyrics: [{ section_id: 'nope', text: 'x' }] })
    ).rejects.toThrow(/No existe la sección/)
  })

  it('get_project_state enseña el motor de voz y la letra de cada sección', async () => {
    const h = fakeHost(createProject('X'), demo, singer)
    await h.run('compose_song', sungSong)
    const d = (await h.run('get_project_state')) as {
      vocal_engine: { name: string; max_song_seconds: number }
      sections: { lyrics?: string }[]
    }
    expect(d.vocal_engine).toMatchObject({ name: 'ACE-Step', max_song_seconds: 240 })
    expect(d.sections[2].lyrics).toBe('Ay amor, ven a bailar')
  })
})

describe('cantar con la voz del usuario', () => {
  function withVocalTrack() {
    const h = fakeHost(createProject('X'))
    const vocal = {
      ...createTrack('Canción · Voz', 'vocal'),
      regions: [
        {
          id: 'rv1',
          clipId: 'c',
          startBeat: 0,
          offsetSec: 0,
          lengthSec: 8,
          fadeInSec: 0,
          fadeOutSec: 0
        }
      ]
    }
    const song = {
      ...createTrack('Canción', 'full'),
      regions: [{ ...vocal.regions[0], id: 'rs1' }]
    }
    h.state.project = { ...h.state.project, tracks: [song, vocal] }
    return h
  }

  it('convierte una región de voz con la voz elegida y el tono pedido', async () => {
    const h = withVocalTrack()
    h.myVoices.ready = true
    h.myVoices.voices.push({ id: 'alberto', name: 'Alberto' }, { id: 'coro', name: 'Coro grave' })
    const res = await h.run('sing_with_my_voice', { region_id: 'rv1', voice: 'grave', pitch: -12 })
    expect(res).toMatchObject({ ok: true, voice: 'Coro grave' })
    expect(h.state.messages.at(-1)).toBe('voice rv1 Coro grave -12')
    await h.run('sing_with_my_voice', { region_id: 'rv1' })
    expect(h.state.messages.at(-1)).toBe('voice rv1 Alberto 0')

    const d = (await h.run('get_project_state')) as { my_voice: unknown }
    expect(d.my_voice).toEqual({ ready: true, voices: ['Alberto', 'Coro grave'] })
  })

  it('explica qué falta: instalar, entrenar una voz o separar antes la canción', async () => {
    const h = withVocalTrack()
    await expect(h.run('sing_with_my_voice', { region_id: 'rv1' })).rejects.toThrow(
      /no está instalado/
    )
    expect((await h.run('get_project_state')) as object).not.toHaveProperty('my_voice')
    h.myVoices.ready = true
    await expect(h.run('sing_with_my_voice', { region_id: 'rv1' })).rejects.toThrow(/entrene una/)
    h.myVoices.voices.push({ id: 'alberto', name: 'Alberto' })
    await expect(h.run('sing_with_my_voice', { region_id: 'rs1' })).rejects.toThrow(
      /separate_stems/
    )
    await expect(h.run('sing_with_my_voice', { region_id: 'rv1', voice: 'Pedro' })).rejects.toThrow(
      /No existe la voz "Pedro"/
    )
    // La voz del cantante local no se convierte (condiciones de uso del voicebank).
    h.state.project = {
      ...h.state.project,
      clips: { c: { id: 'c', file: '', durationSec: 8, spec: null, provider: 'diffsinger' } }
    }
    await expect(h.run('sing_with_my_voice', { region_id: 'rv1' })).rejects.toThrow(
      /condiciones de uso no permiten/
    )
  })
})

describe('cantante local (melodía nota a nota)', () => {
  const localSong = {
    style: 'romantic latin pop',
    bpm: 100,
    key: 'A minor',
    vocals: 'female pop vocal',
    language: 'es',
    sections: [
      { name: 'Intro', bars: 2, arrangement: 'guitar intro' },
      {
        name: 'Coro',
        bars: 4,
        arrangement: 'full band',
        melody: [
          { text: 'Ay amor, ven a bailar', notes: 'E5:1 D5:0.5 C5:1.5 B4 C5 D5 C5:2' },
          { text: 'que la noche va a empezar', notes: 'C5:0.5 B4:0.5 A4 G4 A4 B4 C5 B4 A4' }
        ]
      }
    ]
  }

  function localHost() {
    const h = fakeHost(createProject('X'), demo, singer)
    h.singer.ready = true
    chainableExtend(h)
    return h
  }

  /** Continuación en memoria (como chainable, pero sin registrar llamadas). */
  function chainableExtend(h: ReturnType<typeof fakeHost>) {
    h.host.extend = async (regionId, bars, opts) => {
      const p = h.state.project
      const track = p.tracks.find((t) => t.regions.some((r) => r.id === regionId))!
      const src = track.regions.find((r) => r.id === regionId)!
      const region = {
        ...src,
        id: newId('rgn'),
        lengthSec: barsToSeconds(bars, p),
        startBeat: opts?.atBeat ?? src.startBeat + secondsToBeats(src.lengthSec, p.bpm)
      }
      h.state.project = {
        ...p,
        tracks: p.tracks.map((t) =>
          t.id === track.id ? { ...t, regions: [...t.regions, region] } : t
        )
      }
      return { trackId: track.id, regionId: region.id }
    }
  }

  it('con el cantante local, compose_song graba el instrumental sin voces y canta la melodía encima', async () => {
    const h = localHost()
    const res = (await h.run('compose_song', localSong)) as { ok: boolean; sung_by: string }
    expect(res).toMatchObject({ ok: true, sung_by: 'Hanami' })
    // El instrumental se pide sin voces y nunca al motor de la nube.
    expect(h.generated).toHaveLength(1)
    expect(h.generated[0].lyrics).toBeUndefined()
    expect(h.generated[0].prompt).toMatch(/^instrumental, /)
    // La melodía se canta una vez, con el fonemizador de español y desde el compás 3.
    expect(h.singer.sung).toHaveLength(1)
    const ustx = h.singer.sung[0]
    expect(ustx).toContain('DiffSingerSpanishPhonemizer')
    expect(ustx).toContain("lyric: 'ay'")
    expect(ustx).toMatch(/- position: 3840\n {4}duration: 480\n {4}tone: 76/) // E5 en el pulso 8
    const coro = h.state.project.sections!.find((s) => s.name === 'Coro')!
    expect(coro.lyrics).toBe('Ay amor, ven a bailar\nque la noche va a empezar')
    expect(coro.melody).toHaveLength(2)
  })

  it('exige la melodía y una nota por sílaba antes de tocar nada', async () => {
    const h = localHost()
    await expect(
      h.run('compose_song', {
        ...localSong,
        sections: [{ name: 'Coro', bars: 4, arrangement: 'x', lyrics: 'Ay amor' }]
      })
    ).rejects.toThrow(/necesita la melodía \("melody"\).*Coro/)
    await expect(
      h.run('compose_song', {
        ...localSong,
        sections: [
          {
            name: 'Coro',
            bars: 4,
            arrangement: 'x',
            melody: [{ text: 'caminando', notes: 'A4 B4' }]
          }
        ]
      })
    ).rejects.toThrow(/4 sílabas \(ca-mi-nan-do\) y solo 2 notas/)
    expect(h.generated).toHaveLength(0)
    expect(h.state.project.sections).toBeUndefined()
  })

  it('sing_melody cambia la melodía de una sección y vuelve a cantar', async () => {
    const h = localHost()
    await h.run('compose_song', localSong)
    const coro = h.state.project.sections!.find((s) => s.name === 'Coro')!
    await h.run('sing_melody', {
      sections: [{ section_id: coro.id, melody: [{ text: 'te quiero', notes: 'A4 B4 C5:2' }] }]
    })
    expect(h.singer.sung).toHaveLength(2)
    expect(h.singer.sung[1]).toContain("lyric: 'quiero'")
    expect(h.state.project.sections!.find((s) => s.id === coro.id)!.lyrics).toBe('te quiero')
  })

  it('quién canta: preferencia, y el local solo en automático si está instalado', async () => {
    const h = fakeHost(createProject('X'), demo, singer)
    const who = async () =>
      ((await h.run('get_project_state')) as { singing: { engine: string } | null }).singing
    expect(await who()).toEqual({ engine: 'cloud' })
    h.singer.ready = true
    expect((await who())?.engine).toBe('local')
    h.singer.preference = 'cloud'
    expect(await who()).toEqual({ engine: 'cloud' })
    h.singer.preference = 'local'
    h.singer.ready = false
    expect(await who()).toMatchObject({ engine: 'local', ready: false })
  })
})
