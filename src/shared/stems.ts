import type { TrackRole } from './project'

// Pistas que devuelve la separación (Demucs htdemucs).

export interface StemResult {
  /** drums | bass | other | vocals */
  name: string
  /** Ruta relativa al proyecto del WAV de la pista. */
  file: string
  /** Nivel medio: casi 0 = la pista está vacía (p. ej. sin voz). */
  rms: number
}

export const STEM_INFO: Record<string, { label: string; role: TrackRole }> = {
  vocals: { label: 'Voz', role: 'vocal' },
  drums: { label: 'Batería', role: 'drums' },
  bass: { label: 'Bajo', role: 'bass' },
  other: { label: 'Otros', role: 'chords' }
}

/** Por debajo de este nivel la pista se considera vacía y no se añade. */
export const SILENT_RMS = 0.003

/** Orden en que se crean las pistas: voz primero, que suele ser lo que se busca. */
export const STEM_ORDER = ['vocals', 'drums', 'bass', 'other']
