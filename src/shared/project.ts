// Modelo de datos del proyecto. Es el "código fuente" de la canción:
// el agente productor lo muta mediante herramientas y cada turno queda versionado.

export type TrackRole = 'drums' | 'bass' | 'chords' | 'melody' | 'vocal' | 'fx' | 'full'

export type GenerationMode = 'text' | 'continue' | 'variation' | 'melody'

export interface GenerationSpec {
  prompt: string
  negativePrompt?: string
  bpm: number
  key: string
  durationSec: number
  role: TrackRole
  seed?: number
  conditioningClipId?: string
  mode: GenerationMode
}

export interface Clip {
  id: string
  /** Ruta relativa a la carpeta del proyecto (clips/<id>.wav). */
  file: string
  durationSec: number
  /** null para audio importado por el usuario. */
  spec: GenerationSpec | null
  provider: string
  parentClipId?: string
}

export interface Region {
  id: string
  clipId: string
  startBeat: number
  offsetSec: number
  lengthSec: number
  fadeInSec: number
  fadeOutSec: number
}

export interface Track {
  id: string
  name: string
  role: TrackRole
  gainDb: number
  pan: number
  mute: boolean
  solo: boolean
  regions: Region[]
}

export interface Project {
  schemaVersion: 1
  id: string
  name: string
  bpm: number
  key: string
  timeSignature: [number, number]
  tracks: Track[]
  clips: Record<string, Clip>
}

export interface VersionMeta {
  id: number
  createdAt: string
  /** Resumen legible del cambio, p. ej. "Añadida pista Bass (compases 9–16)". */
  message: string
}

export function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

export function createProject(name: string): Project {
  return {
    schemaVersion: 1,
    id: newId('prj'),
    name,
    bpm: 120,
    key: 'C minor',
    timeSignature: [4, 4],
    tracks: [],
    clips: {}
  }
}

export function createTrack(name: string, role: TrackRole): Track {
  return { id: newId('trk'), name, role, gainDb: 0, pan: 0, mute: false, solo: false, regions: [] }
}

export function beatsToSeconds(beats: number, bpm: number): number {
  return (beats * 60) / bpm
}

export function secondsToBeats(sec: number, bpm: number): number {
  return (sec * bpm) / 60
}
