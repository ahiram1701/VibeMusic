import { beatsToSeconds, secondsToBeats, type Project } from '@shared/project'
import { snapBeat } from '@shared/timeline'
import { engine } from '../audio/engine'
import { useUi } from '../store/ui'

// Lo que comparten el timeline y la barra de transporte sobre la vista: el contenedor
// que se desplaza, el zoom anclado, seguir la línea de reproducción y arrastrarla.
// Las coordenadas "de pistas" empiezan donde acaba la columna de nombres (HEADER_W).

export const HEADER_W = 160
/** Margen a la derecha antes de pasar página al seguir la reproducción. */
const FOLLOW_MARGIN = 40

let container: HTMLElement | null = null
/** Hasta cuándo no se sigue la línea porque el usuario ha desplazado la vista a mano. */
let userScrollUntil = 0
let programmatic = false
/** Se está arrastrando la línea: no hay que mover la vista bajo el ratón. */
export let scrubbing = false

/** El timeline registra aquí su contenedor con scroll (el <section> de la app). */
export function setTimelineContainer(el: HTMLElement | null): () => void {
  container = el
  const onScroll = (): void => {
    if (programmatic) programmatic = false
    else userScrollUntil = performance.now() + 3000
  }
  el?.addEventListener('scroll', onScroll, { passive: true })
  return () => {
    el?.removeEventListener('scroll', onScroll)
    if (container === el) container = null
  }
}

function scrollTo(left: number): void {
  if (!container) return
  const next = Math.max(0, Math.round(left))
  if (Math.abs(container.scrollLeft - next) < 1) return
  programmatic = true
  container.scrollLeft = next
}

/** Posición de la línea en píxeles del área de pistas. */
export function playheadPx(project: Project, pxPerBeat: number): number {
  return secondsToBeats(engine.positionSec, project.bpm) * pxPerBeat
}

/**
 * Mantiene la línea a la vista. Mientras suena (y "Seguir" está activo) pasa página
 * cuando se sale; parada, solo lleva la vista a ella si un salto la dejó fuera.
 */
export function followPlayhead(x: number, jumped: boolean): void {
  if (!container || scrubbing) return
  const view = container.clientWidth - HEADER_W
  const left = container.scrollLeft
  const outside = x < left || x > left + view - FOLLOW_MARGIN
  if (!outside) return
  const playing = engine.isPlaying()
  if (playing && (!useUi.getState().follow || performance.now() < userScrollUntil)) return
  if (playing || jumped) scrollTo(x - view * 0.2)
}

/**
 * Zoom que mantiene quieto el pulso que hay bajo `clientX` (o bajo la línea de
 * reproducción si no se indica, como hacen los botones − y +).
 */
export function zoomAt(factor: number, project: Project, clientX?: number): void {
  const { pxPerBeat, zoom } = useUi.getState()
  if (!container) {
    zoom(factor)
    return
  }
  const view = container.clientWidth - HEADER_W
  const anchor =
    clientX === undefined
      ? Math.min(view, Math.max(0, playheadPx(project, pxPerBeat) - container.scrollLeft))
      : clientX - container.getBoundingClientRect().left - HEADER_W
  const content = container.scrollLeft + anchor
  const applied = zoom(factor)
  // El ancho nuevo se aplica al re-renderizar: se desplaza en el siguiente fotograma.
  requestAnimationFrame(() => scrollTo(content * applied - anchor))
}

/**
 * Empieza a arrastrar la línea de reproducción desde un pointerdown. `origin` es el
 * elemento cuyo borde izquierdo es el pulso 0. Se ajusta a la rejilla (Alt: libre).
 * Si estaba sonando, se pausa mientras se arrastra y sigue al soltar.
 */
export function startScrub(
  e: React.PointerEvent<HTMLElement>,
  origin: HTMLElement,
  project: Project
): void {
  if (e.button !== 0) return
  const target = e.currentTarget
  target.setPointerCapture(e.pointerId)
  const wasPlaying = engine.isPlaying()
  if (wasPlaying) engine.stop()
  scrubbing = true
  const seekAt = (clientX: number, free: boolean): void => {
    const { pxPerBeat, grid } = useUi.getState()
    const raw = Math.max(0, (clientX - origin.getBoundingClientRect().left) / pxPerBeat)
    const beat = free ? raw : snapBeat(raw, grid, project)
    engine.seek(project, beatsToSeconds(beat, project.bpm))
  }
  seekAt(e.clientX, e.altKey)
  const onMove = (ev: PointerEvent): void => seekAt(ev.clientX, ev.altKey)
  const onUp = (): void => {
    target.removeEventListener('pointermove', onMove)
    target.removeEventListener('pointerup', onUp)
    target.removeEventListener('pointercancel', onUp)
    scrubbing = false
    if (wasPlaying) void engine.play(project, engine.positionSec)
  }
  target.addEventListener('pointermove', onMove)
  target.addEventListener('pointerup', onUp)
  target.addEventListener('pointercancel', onUp)
}
