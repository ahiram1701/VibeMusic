// Modelo de datos del proyecto. Es el "código fuente" de la canción:
// el agente productor lo muta mediante herramientas y cada turno queda versionado.

export type TrackRole = 'drums' | 'bass' | 'chords' | 'melody' | 'vocal' | 'fx' | 'full'

/** Nombre visible de cada tipo de pista. */
export const ROLE_LABELS: Record<TrackRole, string> = {
  drums: 'Batería',
  bass: 'Bajo',
  chords: 'Acordes',
  melody: 'Melodía',
  vocal: 'Voz',
  fx: 'Efectos',
  full: 'Completo'
}

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
  /**
   * Letra cantada (canción completa con voz), con etiquetas de sección como
   * "[verse]" o "[chorus]". Solo la usan los motores que saben cantar.
   */
  lyrics?: string
  /** Idioma de la letra (ISO 639-1, p. ej. "es"); ayuda al motor a pronunciarla bien. */
  lyricsLanguage?: string
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
  /** Estructura de la canción (intro, estrofa…). Opcional: proyectos antiguos no la tienen. */
  sections?: Section[]
  /**
   * Sonido común de la canción (en inglés), fijado por el productor al componerla. Se
   * añade a cada capa nueva para que todas suenen a la misma canción.
   */
  style?: string
  /** Cómo es la voz que canta (en inglés, p. ej. "warm female pop vocal"). */
  vocals?: string
  /** Idioma de la letra (ISO 639-1). */
  lyricsLanguage?: string
}

/** Una parte de la canción, medida en compases (el primero es el 1). */
export interface Section {
  id: string
  name: string
  startBar: number
  bars: number
  /** Sección escasa a propósito (intro de solo batería, break…): no avisa de "una sola capa". */
  sparse?: boolean
  /** Letra que se canta en esta sección (vacía o ausente: instrumental). */
  lyrics?: string
  /**
   * Melodía de la letra para el cantante local: una frase por línea con sus notas
   * ("A4:0.5 B4 …", ver shared/melody.ts).
   */
  melody?: { text: string; notes: string }[]
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

/** Nombre de carpeta válido en Windows, macOS y Linux a partir del nombre de la canción. */
export function folderName(name: string): string {
  const clean = [...name]
    // Fuera los caracteres de control y los que Windows no admite en nombres de carpeta.
    .filter((c) => c.charCodeAt(0) >= 32 && !'<>:"/\\|?*'.includes(c))
    .join('')
    .replace(/[. ]+$/, '')
    .trim()
  return clean.slice(0, 80) || 'Nueva canción'
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
