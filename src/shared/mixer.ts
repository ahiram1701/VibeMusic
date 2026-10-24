import type { Track, TrackRole } from './project'

export const MIN_GAIN_DB = -60
export const MAX_GAIN_DB = 6

/** Convierte decibelios a ganancia lineal (0 dB → 1, -6 dB ≈ 0.5). -60 dB se trata como silencio. */
export function dbToGain(db: number): number {
  return db <= MIN_GAIN_DB ? 0 : Math.pow(10, db / 20)
}

/**
 * ¿Debe sonar esta pista, teniendo en cuenta mute y solo de todas las pistas?
 *
 * Ejemplo con 3 pistas: Drums, Bass, Piano
 *   - Nadie en solo, Bass en mute            → suenan Drums y Piano
 *   - Drums en solo                          → solo suena Drums
 *   - Drums y Piano en solo                  → suenan Drums y Piano
 *   - Drums en solo Y en mute                → no suena nada (mute siempre gana, como en la mayoría de DAWs)
 */
export function isTrackAudible(track: Track, allTracks: Track[]): boolean {
  if (track.mute) return false
  const anySolo = allTracks.some((t) => t.solo)
  return anySolo ? track.solo : true
}

/**
 * Mezcla inicial de una pista nueva según su papel: la base rítmica delante, la
 * armonía y los efectos más atrás y un poco abiertos para que no tapen al resto.
 */
export const DEFAULT_MIX: Record<TrackRole, { gainDb: number; pan: number }> = {
  drums: { gainDb: 0, pan: 0 },
  bass: { gainDb: -3, pan: 0 },
  chords: { gainDb: -6, pan: -0.2 },
  melody: { gainDb: -4, pan: 0.15 },
  vocal: { gainDb: -2, pan: 0 },
  fx: { gainDb: -8, pan: 0.25 },
  full: { gainDb: 0, pan: 0 }
}

export function withDefaultMix(track: Track): Track {
  return { ...track, ...DEFAULT_MIX[track.role] }
}
