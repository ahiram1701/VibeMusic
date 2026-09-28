import type { Project, Region } from './project'

// Utilidades puras del timeline. Las usan tanto la UI (arrastrar regiones)
// como el agente productor (herramienta `move_region`), así que viven en shared/.

export type GridResolution = 'bar' | 'beat' | 'half' | 'quarter' | 'off'

/** Tamaño de una celda de la rejilla, en beats, para un compás dado. */
export function gridSizeBeats(grid: GridResolution, timeSignature: [number, number]): number {
  switch (grid) {
    case 'bar':
      return timeSignature[0]
    case 'beat':
      return 1
    case 'half':
      return 0.5
    case 'quarter':
      return 0.25
    case 'off':
      return 0
  }
}

/**
 * Ajusta la posición (en beats) a la que el usuario o el agente quiere mover una región.
 *
 * @param rawBeat   posición sin ajustar (p. ej. donde se soltó el ratón); puede ser negativa
 * @param grid      resolución de la rejilla activa
 * @param project   para conocer el compás
 * @returns         posición final en beats, nunca negativa
 */
export function snapBeat(rawBeat: number, grid: GridResolution, project: Project): number {
  const size = gridSizeBeats(grid, project.timeSignature)
  if (size === 0) return Math.max(0, rawBeat)
  const cells = Math.round(rawBeat / size) // celda más cercana
  // toFixed limpia el ruido de coma flotante (3.9999999 → 4)
  return Math.max(0, Number((cells * size).toFixed(6)))
}

export function moveRegion(
  region: Region,
  rawBeat: number,
  grid: GridResolution,
  project: Project
): Region {
  return { ...region, startBeat: snapBeat(rawBeat, grid, project) }
}
