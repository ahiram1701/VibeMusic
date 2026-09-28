import type { AgentTool } from './agent'
import type { ProviderInfo } from './generation'
import {
  beatsToSeconds,
  newId,
  removeRegion,
  removeTrack,
  secondsToBeats,
  updateTrack,
  type Project,
  type Region,
  type Track,
  type TrackRole
} from './project'
import { barsToSeconds } from './prompt'
import { MAX_GAIN_DB, MIN_GAIN_DB } from './mixer'
import { projectEndSec } from './timeline'

// Herramientas del agente productor. Hablan con la app a través de `ProducerHost`,
// así se pueden probar sin interfaz. Trabajan en compases (1 = primer compás),
// que es como piensa un músico, y validan cada parámetro: si el LLM se equivoca,
// recibe un error claro y puede corregirse.

export interface ProducerHost {
  getProject(): Project
  commit(next: Project, message: string): Promise<void>
  /** Cambia tempo/tonalidad estirando el audio generado; devuelve cuántos clips se ajustaron. */
  setTempo(
    bpm: number,
    key: string | undefined,
    messagePrefix: string
  ): Promise<{ adjusted: number; skipped: number }>
  /** Motor de audio que se usará para generar (el predeterminado). */
  audioProvider(): ProviderInfo | undefined
  generate(input: {
    prompt: string
    role: TrackRole
    bars: number
    atBeat: number
    trackId: string | null
    trackName?: string
  }): Promise<{ trackId: string; regionId: string }>
  playheadSec(): number
  play(fromSec: number): void
}

const ROLES: TrackRole[] = ['drums', 'bass', 'chords', 'melody', 'vocal', 'fx', 'full']
/** Prefijo de los cambios hechos por el agente en el historial. */
export const AGENT_PREFIX = '🤖 '

// --- Validación de entradas --------------------------------------------------

type Input = Record<string, unknown>

function num(input: Input, key: string, min: number, max: number): number
function num(
  input: Input,
  key: string,
  min: number,
  max: number,
  optional: true
): number | undefined
function num(
  input: Input,
  key: string,
  min: number,
  max: number,
  optional = false
): number | undefined {
  const v = input[key]
  if (v === undefined || v === null) {
    if (optional) return undefined
    throw new Error(`Falta el parámetro "${key}"`)
  }
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`"${key}" debe ser un número`)
  if (v < min || v > max)
    throw new Error(`"${key}" debe estar entre ${min} y ${max} (recibido ${v})`)
  return v
}

function str(input: Input, key: string): string
function str(input: Input, key: string, optional: true): string | undefined
function str(input: Input, key: string, optional = false): string | undefined {
  const v = input[key]
  if (v === undefined || v === null || v === '') {
    if (optional) return undefined
    throw new Error(`Falta el parámetro "${key}"`)
  }
  if (typeof v !== 'string') throw new Error(`"${key}" debe ser texto`)
  return v
}

function bool(input: Input, key: string): boolean | undefined {
  const v = input[key]
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'boolean') throw new Error(`"${key}" debe ser true o false`)
  return v
}

// --- Utilidades de compases --------------------------------------------------

const perBar = (p: Project): number => p.timeSignature[0]
const beatOfBar = (p: Project, bar: number): number => (bar - 1) * perBar(p)
const barOfBeat = (p: Project, beat: number): number => beat / perBar(p) + 1
const round2 = (n: number): number => Math.round(n * 100) / 100

function findTrack(p: Project, id: string): Track {
  const t = p.tracks.find((x) => x.id === id)
  if (!t) throw new Error(`No existe la pista "${id}". Usa get_project_state para ver los ids.`)
  return t
}

function findRegion(p: Project, id: string): { track: Track; region: Region } {
  for (const track of p.tracks) {
    const region = track.regions.find((r) => r.id === id)
    if (region) return { track, region }
  }
  throw new Error(`No existe la región "${id}". Usa get_project_state para ver los ids.`)
}

export function maxBarsPerClip(p: Project, provider: ProviderInfo | undefined): number {
  if (!provider) return 0
  return Math.max(1, Math.floor(provider.capabilities.maxDurationSec / barsToSeconds(1, p)))
}

/** Resumen del proyecto pensado para el LLM (compacto, en compases). */
export function describeProject(p: Project, host: ProducerHost): unknown {
  const provider = host.audioProvider()
  return {
    name: p.name,
    bpm: p.bpm,
    key: p.key,
    time_signature: p.timeSignature.join('/'),
    song_length_bars: round2(secondsToBeats(projectEndSec(p), p.bpm) / perBar(p)),
    playhead_bar: round2(barOfBeat(p, secondsToBeats(host.playheadSec(), p.bpm))),
    audio_engine: provider
      ? {
          name: provider.label,
          ready: provider.ready,
          ...(provider.notReadyReason && { problem: provider.notReadyReason }),
          max_bars_per_clip: maxBarsPerClip(p, provider)
        }
      : null,
    tracks: p.tracks.map((t) => ({
      id: t.id,
      name: t.name,
      role: t.role,
      gain_db: t.gainDb,
      pan: t.pan,
      mute: t.mute,
      solo: t.solo,
      regions: t.regions
        .map((r) => ({
          id: r.id,
          start_bar: round2(barOfBeat(p, r.startBeat)),
          length_bars: round2(secondsToBeats(r.lengthSec, p.bpm) / perBar(p)),
          source: p.clips[r.clipId]?.spec?.prompt ?? 'audio importado'
        }))
        .sort((a, b) => a.start_bar - b.start_bar)
    }))
  }
}

// --- Herramientas ------------------------------------------------------------

export function createProducerTools(host: ProducerHost): AgentTool[] {
  const commit = (next: Project, message: string): Promise<void> =>
    host.commit(next, AGENT_PREFIX + message)

  return [
    {
      def: {
        name: 'get_project_state',
        description:
          'Returns the current song: tempo, key, time signature, length, playhead, the audio engine (and the maximum bars it can generate per clip) and every track with its regions (ids, start bar, length in bars, and the prompt that generated each clip). Call it before making changes that depend on what already exists.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false }
      },
      run: async () => describeProject(host.getProject(), host)
    },
    {
      def: {
        name: 'set_tempo_key',
        description:
          'Sets the song tempo (BPM) and/or musical key, e.g. "A minor", "F# major". New clips are generated at this tempo and key. Existing generated clips are automatically time-stretched to keep their length in bars (pitch is not changed, so changing the key does not transpose existing audio). Imported audio is not stretched.',
        inputSchema: {
          type: 'object',
          properties: {
            bpm: { type: 'number', minimum: 40, maximum: 240 },
            key: { type: 'string', description: 'Key such as "C minor" or "E major"' }
          },
          additionalProperties: false
        }
      },
      run: async (input) => {
        const p = host.getProject()
        const bpm = num(input, 'bpm', 40, 240, true)
        const key = str(input, 'key', true)
        if (bpm === undefined && key === undefined) throw new Error('Indica bpm y/o key')
        const newBpm = bpm !== undefined ? Math.round(bpm) : p.bpm
        if (newBpm === p.bpm) {
          const next = { ...p, key: key ?? p.key }
          await commit(next, `tonalidad ${next.key}`)
          return { ok: true, bpm: p.bpm, key: next.key }
        }
        const result = await host.setTempo(newBpm, key, AGENT_PREFIX)
        return {
          ok: true,
          bpm: newBpm,
          key: key ?? p.key,
          clips_time_stretched: result.adjusted,
          ...(result.skipped > 0 && {
            warning: `${result.skipped} imported clip(s) could not be stretched and will not match the new tempo.`
          })
        }
      }
    },
    {
      def: {
        name: 'generate_clip',
        description:
          'Generates a new audio clip with the AI audio engine and places it on the timeline. Waits until the audio is ready (can take from seconds to a minute or more). Generate one instrument layer per call (drums, bass, chords, melody…) and request independent layers in the same turn so they run in parallel. Keep clips short (typically 4 or 8 bars, never more than max_bars_per_clip from get_project_state) and use repeat_region to extend them.',
        inputSchema: {
          type: 'object',
          properties: {
            prompt: {
              type: 'string',
              description:
                'Concrete description IN ENGLISH of the sound: genre, instruments, timbre, mood, playing style. Do not include tempo or key (added automatically).'
            },
            role: { type: 'string', enum: ROLES, description: 'Instrument layer of the clip' },
            bars: { type: 'integer', minimum: 1, description: 'Length in bars' },
            start_bar: {
              type: 'integer',
              minimum: 1,
              description: 'Bar where it starts (1 = start)'
            },
            track_id: {
              type: 'string',
              description: 'Existing track to put it on. Omit to create a new track.'
            },
            track_name: {
              type: 'string',
              description: 'Name for the new track (when track_id is omitted)'
            }
          },
          required: ['prompt', 'role', 'bars', 'start_bar'],
          additionalProperties: false
        }
      },
      run: async (input) => {
        const p = host.getProject()
        const provider = host.audioProvider()
        if (!provider?.ready) {
          throw new Error(
            `El motor de audio no está listo: ${provider?.notReadyReason ?? 'no hay ninguno configurado'}. Pide al usuario que lo configure en Ajustes.`
          )
        }
        const prompt = str(input, 'prompt')
        const role = str(input, 'role') as TrackRole
        if (!ROLES.includes(role)) throw new Error(`"role" debe ser uno de: ${ROLES.join(', ')}`)
        const max = maxBarsPerClip(p, provider)
        const bars = Math.round(num(input, 'bars', 1, max))
        const startBar = Math.round(num(input, 'start_bar', 1, 1000))
        const trackId = str(input, 'track_id', true) ?? null
        if (trackId) findTrack(p, trackId)
        const result = await host.generate({
          prompt,
          role,
          bars,
          atBeat: beatOfBar(p, startBar),
          trackId,
          trackName: str(input, 'track_name', true)
        })
        return {
          ok: true,
          track_id: result.trackId,
          region_id: result.regionId,
          start_bar: startBar,
          bars
        }
      }
    },
    {
      def: {
        name: 'repeat_region',
        description:
          'Repeats a region back-to-back right after itself on the same track, `times` extra copies. Use it to turn a short loop into a longer section.',
        inputSchema: {
          type: 'object',
          properties: {
            region_id: { type: 'string' },
            times: {
              type: 'integer',
              minimum: 1,
              maximum: 64,
              description: 'Number of extra copies'
            }
          },
          required: ['region_id', 'times'],
          additionalProperties: false
        }
      },
      run: async (input) => {
        const p = host.getProject()
        const { track, region } = findRegion(p, str(input, 'region_id'))
        const times = Math.round(num(input, 'times', 1, 64))
        const lenBeats = secondsToBeats(region.lengthSec, p.bpm)
        const copies: Region[] = Array.from({ length: times }, (_, i) => ({
          ...region,
          id: newId('rgn'),
          startBeat: region.startBeat + lenBeats * (i + 1)
        }))
        await commit(
          updateTrack(p, track.id, { regions: [...track.regions, ...copies] }),
          `${track.name}: repetida ${times} ${times === 1 ? 'vez' : 'veces'}`
        )
        return {
          ok: true,
          new_region_ids: copies.map((c) => c.id),
          ends_at_bar: round2(barOfBeat(p, copies.at(-1)!.startBeat + lenBeats))
        }
      }
    },
    {
      def: {
        name: 'move_region',
        description: 'Moves a region to another start bar and optionally to another track.',
        inputSchema: {
          type: 'object',
          properties: {
            region_id: { type: 'string' },
            start_bar: { type: 'number', minimum: 1 },
            track_id: {
              type: 'string',
              description: 'Destination track (omit to keep the same one)'
            }
          },
          required: ['region_id', 'start_bar'],
          additionalProperties: false
        }
      },
      run: async (input) => {
        const p = host.getProject()
        const { track, region } = findRegion(p, str(input, 'region_id'))
        const startBar = num(input, 'start_bar', 1, 1000)
        const destId = str(input, 'track_id', true) ?? track.id
        findTrack(p, destId)
        const moved = { ...region, startBeat: beatOfBar(p, startBar) }
        const next = {
          ...removeRegion(p, region.id),
          tracks: removeRegion(p, region.id).tracks.map((t) =>
            t.id === destId ? { ...t, regions: [...t.regions, moved] } : t
          )
        }
        await commit(next, `región movida al compás ${startBar}`)
        return { ok: true }
      }
    },
    {
      def: {
        name: 'delete_region',
        description: 'Deletes one region from the timeline.',
        inputSchema: {
          type: 'object',
          properties: { region_id: { type: 'string' } },
          required: ['region_id'],
          additionalProperties: false
        }
      },
      run: async (input) => {
        const p = host.getProject()
        const { track, region } = findRegion(p, str(input, 'region_id'))
        await commit(removeRegion(p, region.id), `${track.name}: región eliminada`)
        return { ok: true }
      }
    },
    {
      def: {
        name: 'set_track',
        description:
          'Changes a track: name, volume in dB (0 = unchanged, negative = quieter), pan (-1 left … 1 right), mute and solo. Only the given fields change.',
        inputSchema: {
          type: 'object',
          properties: {
            track_id: { type: 'string' },
            name: { type: 'string' },
            gain_db: { type: 'number', minimum: MIN_GAIN_DB, maximum: MAX_GAIN_DB },
            pan: { type: 'number', minimum: -1, maximum: 1 },
            mute: { type: 'boolean' },
            solo: { type: 'boolean' }
          },
          required: ['track_id'],
          additionalProperties: false
        }
      },
      run: async (input) => {
        const p = host.getProject()
        const track = findTrack(p, str(input, 'track_id'))
        const patch: Partial<Track> = {}
        const name = str(input, 'name', true)
        const gainDb = num(input, 'gain_db', MIN_GAIN_DB, MAX_GAIN_DB, true)
        const pan = num(input, 'pan', -1, 1, true)
        const mute = bool(input, 'mute')
        const solo = bool(input, 'solo')
        if (name !== undefined) patch.name = name.trim()
        if (gainDb !== undefined) patch.gainDb = Math.round(gainDb * 2) / 2
        if (pan !== undefined) patch.pan = Math.round(pan * 20) / 20
        if (mute !== undefined) patch.mute = mute
        if (solo !== undefined) patch.solo = solo
        if (Object.keys(patch).length === 0) throw new Error('No se indicó ningún cambio')
        const parts = Object.entries(patch).map(([k, v]) => `${k} ${v}`)
        await commit(updateTrack(p, track.id, patch), `${track.name}: ${parts.join(', ')}`)
        return { ok: true, track: { id: track.id, ...patch } }
      }
    },
    {
      def: {
        name: 'delete_track',
        description: 'Deletes a whole track and its regions.',
        inputSchema: {
          type: 'object',
          properties: { track_id: { type: 'string' } },
          required: ['track_id'],
          additionalProperties: false
        }
      },
      run: async (input) => {
        const p = host.getProject()
        const track = findTrack(p, str(input, 'track_id'))
        await commit(removeTrack(p, track.id), `pista ${track.name} eliminada`)
        return { ok: true }
      }
    },
    {
      def: {
        name: 'play',
        description: 'Starts playback so the user can listen, from a bar (default: the start).',
        inputSchema: {
          type: 'object',
          properties: { from_bar: { type: 'number', minimum: 1 } },
          additionalProperties: false
        }
      },
      run: async (input) => {
        const p = host.getProject()
        const fromBar = num(input, 'from_bar', 1, 1000, true) ?? 1
        host.play(beatsToSeconds(beatOfBar(p, fromBar), p.bpm))
        return { ok: true, playing_from_bar: fromBar }
      }
    }
  ]
}
