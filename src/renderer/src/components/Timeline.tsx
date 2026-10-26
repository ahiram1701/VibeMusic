import { useEffect, useRef, useState } from 'react'
import {
  beatsToSeconds,
  removeRegion,
  secondsToBeats,
  updateRegion,
  type Project,
  type Region,
  type Track
} from '@shared/project'
import { formatPosition, projectEndSec, snapBeat } from '@shared/timeline'
import { engine } from '../audio/engine'
import { ROLE_LABELS } from '../labels'
import { AddSectionButton, SECTIONS_H, SectionsLane } from './SectionsLane'
import { useProject } from '../store/project'
import { useGeneration } from '../store/generation'
import { useUi } from '../store/ui'
import { Waveform } from './Waveform'
import {
  followPlayhead,
  HEADER_W,
  playheadPx,
  setTimelineContainer,
  startScrub,
  zoomAt
} from './timeline-view'

const LANE_H = 72
const RULER_H = 24
const ROLE_COLORS: Record<Track['role'], string> = {
  drums: '#f97316',
  bass: '#22c55e',
  chords: '#3b82f6',
  melody: '#eab308',
  vocal: '#ec4899',
  fx: '#14b8a6',
  full: '#8b5cf6'
}

export function Timeline(): React.JSX.Element | null {
  const { project, commit } = useProject()
  const { pxPerBeat, selectedRegionId, select } = useUi()
  const rootRef = useRef<HTMLDivElement>(null)
  const hasTimeline = !!project && (project.tracks.length > 0 || !!project.sections?.length)

  // El contenedor con scroll (el <section> de la app): para seguir la línea y el zoom.
  // Ctrl + rueda acerca o aleja manteniendo quieto lo que hay bajo el ratón.
  useEffect(() => {
    const section = rootRef.current?.closest('section') ?? null
    const off = setTimelineContainer(section)
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const p = useProject.getState().project
      if (p) zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, p, e.clientX)
    }
    section?.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      off()
      section?.removeEventListener('wheel', onWheel)
    }
  }, [hasTimeline])

  // Borrar la región seleccionada con Supr / Retroceso.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      if ((e.target as HTMLElement).closest('input, textarea, select')) return
      const { project } = useProject.getState()
      const id = useUi.getState().selectedRegionId
      if (!project || !id) return
      select(null)
      void commit(removeRegion(project, id), 'Región eliminada')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [commit, select])

  if (!project) return null

  const perBar = project.timeSignature[0]
  const lastSectionBar = Math.max(
    0,
    ...(project.sections ?? []).map((s) => s.startBar + s.bars - 1)
  )
  const totalBeats = Math.max(
    perBar * 32,
    Math.ceil(secondsToBeats(projectEndSec(project), project.bpm) / perBar + 8) * perBar,
    (lastSectionBar + 8) * perBar
  )
  const width = totalBeats * pxPerBeat

  if (project.tracks.length === 0 && !project.sections?.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted">
        <p>Pídele una canción al productor, genera un clip o importa audio.</p>
        <div className="w-32">
          <AddSectionButton />
        </div>
      </div>
    )
  }

  return (
    <div ref={rootRef} className="relative min-h-full" style={{ width: width + HEADER_W }}>
      {/* Secciones y regla de compases (fijas arriba al desplazarse) */}
      <div
        className="sticky top-0 z-20 flex border-b border-line bg-bg"
        style={{ height: SECTIONS_H }}
      >
        <div
          className="sticky left-0 z-10 flex shrink-0 items-center bg-panel px-1"
          style={{ width: HEADER_W }}
        >
          <AddSectionButton />
        </div>
        <SectionsLane project={project} width={width} />
      </div>
      <div
        className="sticky z-20 flex border-b border-line bg-panel"
        style={{ height: RULER_H, top: SECTIONS_H }}
      >
        <div className="sticky left-0 z-10 shrink-0 bg-panel" style={{ width: HEADER_W }} />
        <Ruler project={project} width={width} bars={totalBeats / perBar} />
      </div>

      {project.tracks.map((track) => (
        <div key={track.id} className="flex border-b border-line" style={{ height: LANE_H }}>
          <div
            className="sticky left-0 z-10 flex shrink-0 flex-col justify-center gap-0.5 border-r border-line bg-panel px-3"
            style={{ width: HEADER_W, borderLeft: `3px solid ${ROLE_COLORS[track.role]}` }}
          >
            <span className="truncate text-sm">{track.name}</span>
            <span className="text-[10px] uppercase text-muted">{ROLE_LABELS[track.role]}</span>
          </div>
          <div
            className="relative"
            style={{
              width,
              backgroundImage: `repeating-linear-gradient(to right, var(--color-line) 0 1px, transparent 1px ${perBar * pxPerBeat}px)`
            }}
            onPointerDown={(e) => {
              select(null)
              // Clic (o arrastre) en una zona vacía: la línea va ahí.
              if (e.target === e.currentTarget) startScrub(e, e.currentTarget, project)
            }}
          >
            {track.regions.map((region) => (
              <RegionView
                key={region.id}
                project={project}
                region={region}
                color={ROLE_COLORS[track.role]}
                selected={region.id === selectedRegionId}
              />
            ))}
            <PendingRegions track={track} color={ROLE_COLORS[track.role]} />
          </div>
        </div>
      ))}

      <Playhead offset={HEADER_W} />
    </div>
  )
}

function RegionView({
  project,
  region,
  color,
  selected
}: {
  project: Project
  region: Region
  color: string
  selected: boolean
}): React.JSX.Element {
  const { commit, clipsLoaded } = useProject()
  const { pxPerBeat, grid, select } = useUi()
  const [dragBeat, setDragBeat] = useState<number | null>(null)
  const drag = useRef<{ x: number; beat: number } | null>(null)

  const beat = dragBeat ?? region.startBeat
  const w = secondsToBeats(region.lengthSec, project.bpm) * pxPerBeat
  const buffer = engine.buffers.get(region.clipId)
  void clipsLoaded // fuerza re-render cuando se decodifica audio nuevo

  return (
    <div
      className="absolute top-1 bottom-1 cursor-grab overflow-hidden rounded-md active:cursor-grabbing"
      style={{
        left: beat * pxPerBeat,
        width: w,
        background: `${color}55`,
        outline: selected ? '2px solid white' : `1px solid ${color}`
      }}
      title={`${formatPosition(beatsToSeconds(beat, project.bpm), project)}`}
      onContextMenu={(e) => {
        e.preventDefault()
        useUi.getState().openRegionMenu(region.id, e.clientX, e.clientY)
      }}
      onPointerDown={(e) => {
        e.stopPropagation()
        select(region.id)
        if (e.button !== 0) return // clic derecho: menú, no arrastre
        e.currentTarget.setPointerCapture(e.pointerId)
        drag.current = { x: e.clientX, beat: region.startBeat }
      }}
      onPointerMove={(e) => {
        if (!drag.current) return
        const raw = drag.current.beat + (e.clientX - drag.current.x) / pxPerBeat
        setDragBeat(snapBeat(raw, grid, project))
      }}
      onPointerUp={() => {
        drag.current = null
        if (dragBeat !== null && dragBeat !== region.startBeat) {
          const to = dragBeat
          void commit(
            updateRegion(project, region.id, (r) => ({ ...r, startBeat: to })),
            `Región movida a ${formatPosition(beatsToSeconds(to, project.bpm), project)}`
          )
        }
        setDragBeat(null)
      }}
    >
      <Waveform
        buffer={buffer}
        offsetSec={region.offsetSec}
        lengthSec={region.lengthSec}
        width={w}
        height={LANE_H - 8}
      />
    </div>
  )
}

/**
 * Regla de compases: clic o arrastre para mover la línea de reproducción (ajustada a
 * la rejilla; Alt, libre), con un tirador en la línea y una guía donde está el ratón.
 */
function Ruler({
  project,
  width,
  bars
}: {
  project: Project
  width: number
  bars: number
}): React.JSX.Element {
  const pxPerBeat = useUi((s) => s.pxPerBeat)
  const grid = useUi((s) => s.grid)
  const perBar = project.timeSignature[0]
  const [hover, setHover] = useState<number | null>(null) // pulso bajo el ratón
  const handle = useRef<HTMLDivElement>(null)

  // El tirador sigue a la línea en su propio bucle (no re-renderiza la regla).
  useEffect(() => {
    let raf = 0
    const tick = (): void => {
      try {
        const p = useProject.getState().project
        if (handle.current && p) {
          const x = playheadPx(p, useUi.getState().pxPerBeat)
          handle.current.style.transform = `translateX(${x - 7}px)`
          handle.current.setAttribute('aria-valuetext', formatPosition(engine.positionSec, p))
        }
      } finally {
        raf = requestAnimationFrame(tick)
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const beatAt = (e: React.PointerEvent<HTMLElement>, origin: HTMLElement): number => {
    const raw = Math.max(0, (e.clientX - origin.getBoundingClientRect().left) / pxPerBeat)
    return e.altKey ? raw : snapBeat(raw, grid, project)
  }

  return (
    <div
      className="relative cursor-pointer select-none"
      style={{ width }}
      data-testid="ruler"
      title="Clic o arrastra para mover la línea de reproducción (Alt: sin rejilla)"
      onPointerDown={(e) => startScrub(e, e.currentTarget, project)}
      onPointerMove={(e) => setHover(beatAt(e, e.currentTarget))}
      onPointerLeave={() => setHover(null)}
    >
      {Array.from({ length: bars }, (_, bar) => (
        <span
          key={bar}
          className="pointer-events-none absolute top-0 h-full border-l border-line pl-1 text-[10px] text-muted"
          style={{ left: bar * perBar * pxPerBeat }}
        >
          {bar + 1}
        </span>
      ))}
      {hover !== null && (
        <div
          className="pointer-events-none absolute top-0 bottom-0 w-px bg-white/30"
          style={{ left: hover * pxPerBeat }}
        >
          <span className="absolute top-0 left-1 rounded bg-black/70 px-1 text-[10px] text-white">
            {formatPosition(beatsToSeconds(hover, project.bpm), project)}
          </span>
        </div>
      )}
      <div
        ref={handle}
        role="slider"
        aria-label="Línea de reproducción"
        aria-valuemin={0}
        aria-valuenow={0}
        data-testid="playhead-handle"
        className="absolute top-0 left-0 z-10 flex h-full w-[14px] cursor-ew-resize justify-center"
        title="Arrastra para moverte por la canción"
        onPointerDown={(e) => {
          e.stopPropagation()
          startScrub(e, e.currentTarget.parentElement!, project)
        }}
      >
        <div className="h-0 w-0 border-x-[7px] border-t-[9px] border-x-transparent border-t-white" />
      </div>
    </div>
  )
}

function Playhead({ offset }: { offset: number }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let raf = 0
    let lastSec = -1
    const tick = (): void => {
      try {
        const { project } = useProject.getState()
        const { pxPerBeat } = useUi.getState()
        if (ref.current && project) {
          const sec = engine.positionSec
          const x = playheadPx(project, pxPerBeat)
          ref.current.style.transform = `translateX(${offset + x}px)`
          // Parada, un cambio de posición es un salto (atajo, contador, sección).
          const jumped = !engine.isPlaying() && Math.abs(sec - lastSec) > 1e-3
          followPlayhead(x, jumped)
          lastSec = sec
        }
      } finally {
        raf = requestAnimationFrame(tick)
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [offset])

  return (
    <div ref={ref} className="pointer-events-none absolute top-0 bottom-0 z-30 w-px bg-white" />
  )
}

/**
 * Generaciones en curso que caerán en esta pista (variaciones, continuaciones o
 * generaciones en una pista existente): un "fantasma" con el progreso en el sitio
 * donde aparecerá el audio.
 */
function PendingRegions({ track, color }: { track: Track; color: string }): React.JSX.Element {
  const jobs = useGeneration((s) => s.jobs)
  const project = useProject((s) => s.project)
  const pxPerBeat = useUi((s) => s.pxPerBeat)
  if (!project) return <></>
  const perBar = project.timeSignature[0]
  const pending = Object.values(jobs).filter((v) => {
    const active =
      v.job.status === 'queued' ||
      v.job.status === 'running' ||
      (v.job.status === 'done' && !v.added && !v.localError)
    const here =
      v.placement.trackId === track.id ||
      (!!v.placement.replaceRegionId &&
        track.regions.some((r) => r.id === v.placement.replaceRegionId))
    return active && here
  })
  return (
    <>
      {pending.map((v) => {
        const pct = v.job.progress === null ? null : Math.round(v.job.progress * 100)
        return (
          <div
            key={v.job.id}
            data-testid="pending-region"
            className="pointer-events-none absolute top-1 bottom-1 flex flex-col justify-end overflow-hidden rounded-md border border-dashed px-1.5 pb-1 text-[10px] text-white"
            style={{
              left: v.placement.atBeat * pxPerBeat,
              width: v.placement.bars * perBar * pxPerBeat,
              borderColor: color,
              background: `repeating-linear-gradient(45deg, ${color}22 0 6px, transparent 6px 12px)`
            }}
            title={v.job.stage}
          >
            <span className="truncate">{v.job.stage}</span>
            <div className="mt-0.5 h-1 overflow-hidden rounded bg-black/40">
              <div
                className={`h-full ${pct === null ? 'w-1/3 animate-pulse' : ''}`}
                style={{ background: color, ...(pct !== null && { width: `${pct}%` }) }}
              />
            </div>
          </div>
        )
      })}
    </>
  )
}
