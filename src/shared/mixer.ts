import type { Track } from './project'

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
