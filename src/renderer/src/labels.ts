import type { TrackRole } from '@shared/project'

export const ROLE_LABELS: Record<TrackRole, string> = {
  drums: 'Batería',
  bass: 'Bajo',
  chords: 'Acordes',
  melody: 'Melodía',
  vocal: 'Voz',
  fx: 'Efectos',
  full: 'Completo'
}
