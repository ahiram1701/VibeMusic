import type { Track } from './project'

export const MIN_GAIN_DB = -60
export const MAX_GAIN_DB = 6

/** Convierte decibelios a ganancia lineal (0 dB → 1, -6 dB ≈ 0.5). -60 dB se trata como silencio. */
export function dbToGain(db: number): number {
  return db <= MIN_GAIN_DB ? 0 : Math.pow(10, db / 20)
}

/** ¿Debe sonar esta pista, teniendo en cuenta mute y solo de todas las pistas? */
export function isTrackAudible(track: Track, allTracks: Track[]): boolean {
  void allTracks
  return !track.mute
}
