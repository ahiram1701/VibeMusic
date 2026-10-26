import { beatsToSeconds, secondsToBeats, type Project, type Region } from './project'

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

/** Segundo en el que termina la última región del proyecto (duración de la canción). */
export function projectEndSec(project: Project): number {
  let end = 0
  for (const track of project.tracks) {
    for (const r of track.regions) {
      end = Math.max(end, beatsToSeconds(r.startBeat, project.bpm) + r.lengthSec)
    }
  }
  return end
}

/** Segundos como reloj: "0:47", "2:31", "12:05". */
export function formatClock(sec: number): string {
  const total = Math.max(0, Math.floor(sec + 1e-6))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/**
 * Interpreta lo que escribe el usuario para saltar a una posición: un compás ("9"),
 * compás y tiempo ("9.3") o minutos:segundos ("1:23"). Devuelve segundos, o null si
 * no se entiende o el tiempo no existe en el compás.
 */
export function parsePosition(text: string, project: Project): number | null {
  const t = text.trim().replace(',', '.')
  const clock = /^(\d+):([0-5]?\d(?:\.\d+)?)$/.exec(t)
  if (clock) return Number(clock[1]) * 60 + Number(clock[2])
  const bar = /^(\d+)(?:\.(\d+))?$/.exec(t)
  if (!bar) return null
  const perBar = project.timeSignature[0]
  const barN = Number(bar[1])
  const beatN = bar[2] === undefined ? 1 : Number(bar[2])
  if (barN < 1 || beatN < 1 || beatN > perBar) return null
  return beatsToSeconds((barN - 1) * perBar + (beatN - 1), project.bpm)
}

export type Jump = 'start' | 'end' | 'prevBar' | 'nextBar' | 'prevSection' | 'nextSection'

/**
 * Adónde salta la línea con un atajo, desde `sec`. Atrás va al principio del compás
 * (o sección) actual y, si ya está en él, al anterior, como en cualquier reproductor.
 */
export function jumpTarget(jump: Jump, sec: number, project: Project): number {
  const perBar = project.timeSignature[0]
  const beat = secondsToBeats(sec, project.bpm)
  const toSec = (b: number): number => beatsToSeconds(Math.max(0, b), project.bpm)
  const eps = 0.05
  switch (jump) {
    case 'start':
      return 0
    case 'end':
      return projectEndSec(project)
    case 'prevBar': {
      const barStart = Math.floor(beat / perBar + 1e-9) * perBar
      return toSec(beat - barStart > eps ? barStart : barStart - perBar)
    }
    case 'nextBar':
      return toSec((Math.floor(beat / perBar + 1e-9) + 1) * perBar)
    case 'prevSection':
    case 'nextSection': {
      const starts = [...(project.sections ?? [])]
        .map((s) => (s.startBar - 1) * perBar)
        .sort((a, b) => a - b)
      if (jump === 'prevSection') {
        const prev = starts.filter((b) => b < beat - eps).at(-1)
        return toSec(prev ?? 0)
      }
      const next = starts.find((b) => b > beat + eps)
      return next === undefined ? projectEndSec(project) : toSec(next)
    }
  }
}

/** Formatea una posición como "compás.beat" (1-indexado), como en cualquier DAW. */
export function formatPosition(sec: number, project: Project): string {
  const beats = secondsToBeats(sec, project.bpm)
  const perBar = project.timeSignature[0]
  return `${Math.floor(beats / perBar) + 1}.${Math.floor(beats % perBar) + 1}`
}
