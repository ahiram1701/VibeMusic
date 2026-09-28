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
  /**
   * Audio de partida para "continuar" (mode 'continue'): un fragmento corto del final
   * del clip original, guardado como WAV mono en el proyecto.
   */
  conditioning?: { clipId: string; file: string; seconds: number }
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
  /**
   * Si este clip es una versión estirada a otro tempo: el clip original y su BPM.
   * Los cambios de tempo siempre parten del original para no acumular pérdidas.
   */
  original?: { clipId: string; bpm: number }
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

// Actualizaciones inmutables: devuelven un proyecto nuevo, así cada versión es un snapshot limpio.

export function updateTrack(project: Project, trackId: string, patch: Partial<Track>): Project {
  return {
    ...project,
    tracks: project.tracks.map((t) => (t.id === trackId ? { ...t, ...patch } : t))
  }
}

export function updateRegion(
  project: Project,
  regionId: string,
  fn: (region: Region) => Region
): Project {
  return {
    ...project,
    tracks: project.tracks.map((t) => ({
      ...t,
      regions: t.regions.map((r) => (r.id === regionId ? fn(r) : r))
    }))
  }
}

export function removeRegion(project: Project, regionId: string): Project {
  return {
    ...project,
    tracks: project.tracks.map((t) => ({
      ...t,
      regions: t.regions.filter((r) => r.id !== regionId)
    }))
  }
}

export function removeTrack(project: Project, trackId: string): Project {
  return { ...project, tracks: project.tracks.filter((t) => t.id !== trackId) }
}
