import type { GenerationSpec, Project, TrackRole } from './project'

// Traduce la intención musical (GenerationSpec) al texto que entienden los modelos
// de audio. Los modelos text-to-music responden mejor a descripciones concretas:
// instrumento, estilo, tempo y tonalidad, y a pedir explícitamente "solo X" para capas.

const ROLE_HINTS: Record<TrackRole, string> = {
  drums: 'drum loop only, percussion only, no melody, no bass',
  bass: 'solo bassline only, no drums, no other instruments',
  chords: 'chord progression only, harmonic pad, no drums',
  melody: 'lead melody only, no drums, no bass',
  vocal: 'vocal melody, singing voice',
  fx: 'sound effects, atmospheric texture, no rhythm',
  full: 'full arrangement'
}

export function buildMusicPrompt(spec: GenerationSpec): string {
  const parts = [spec.prompt.trim(), ROLE_HINTS[spec.role], `${Math.round(spec.bpm)} bpm`]
  if (spec.key) parts.push(`in the key of ${spec.key}`)
  return parts.filter(Boolean).join(', ')
}

/** Segundos que ocupan `bars` compases en el tempo y compás del proyecto. */
export function barsToSeconds(
  bars: number,
  project: Pick<Project, 'bpm' | 'timeSignature'>
): number {
  return (bars * project.timeSignature[0] * 60) / project.bpm
}

/**
 * Los modelos generan duraciones en segundos enteros. Pedimos el entero por encima
 * de la duración musical exacta y luego recortamos el sobrante (ver conform.ts).
 */
export function requestSeconds(durationSec: number, maxSec: number): number {
  return Math.min(maxSec, Math.max(1, Math.ceil(durationSec)))
}
