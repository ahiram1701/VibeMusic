import { releaseUrl, userFacingNotes, type WhatsNew } from '@shared/update'

/**
 * ¿Hay novedades que enseñar al abrir esta versión? Sí cuando se actualizó desde
 * otra versión, o cuando hay notas guardadas para esta (la versión anterior aún no
 * recordaba cuál se abrió por última vez). En una instalación nueva, no.
 */
export function computeWhatsNew(opts: {
  current: string
  lastRun?: string
  pending?: { version: string; notes: string }
}): WhatsNew | null {
  const { current, lastRun, pending } = opts
  const notesForThis = pending?.version === current ? pending.notes : null
  // Sin lastRun no se sabe si se actualizó: las notas guardadas para esta versión lo
  // confirman. Con lastRun basta compararla (si coincide, ya se enseñaron).
  const updated = lastRun === undefined ? notesForThis !== null : lastRun !== current
  if (!updated) return null
  return {
    version: current,
    notes: notesForThis ? userFacingNotes(notesForThis) : null,
    url: releaseUrl(current)
  }
}

/** Notas que entrega electron-updater: texto o una lista por versión. */
export function notesToHtml(
  notes: string | { version: string; note: string | null }[] | null | undefined
): string | null {
  if (!notes) return null
  if (typeof notes === 'string') return notes
  return notes.map((n) => n.note ?? '').join('\n') || null
}
