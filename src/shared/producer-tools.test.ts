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

const demo: ProviderInfo = {
  id: 'demo',
  label: 'Demo',
  description: '',
  ready: true,
  capabilities: {
    maxDurationSec: 30,
    supportsSeed: true,
    supportsContinue: false,
    supportsMelody: false
  }
}

/** Host en memoria: la "generación" crea la región al instante. */
function fakeHost(initial: Project, provider: ProviderInfo | undefined = demo) {
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
    generate: async (g) => {
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
              mode: 'text'
            },
            provider: 'demo'
          }
        }
      }
      return { trackId: track.id, regionId: region.id }
    },
    vary: async (regionId) => {
      state.messages.push(`vary ${regionId}`)
      return { trackId: 't', regionId: 'variada' }
    },
    extend: async (regionId, bars, instructions) => {
      state.messages.push(`extend ${regionId} ${bars} ${instructions ?? ''}`.trim())
      return { trackId: 't', regionId: 'continuada' }
    },
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
  return { state, run }
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
