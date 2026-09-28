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
import { useProject } from '../store/project'
import { useUi } from '../store/ui'
import { Waveform } from './Waveform'

const HEADER_W = 160
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

  // Borrar la región seleccionada con Supr / Retroceso.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      if ((e.target as HTMLElement).closest('input, textarea')) return
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
  const totalBeats = Math.max(
    perBar * 32,
    Math.ceil(secondsToBeats(projectEndSec(project), project.bpm) / perBar + 8) * perBar
  )
  const width = totalBeats * pxPerBeat

  if (project.tracks.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted">
        Importa audio o (próximamente) pídeselo al productor en el chat.
      </div>
    )
  }

  const seekFromEvent = (e: React.MouseEvent<HTMLDivElement>): void => {
    const x = e.clientX - e.currentTarget.getBoundingClientRect().left
    engine.seek(project, beatsToSeconds(Math.max(0, x / pxPerBeat), project.bpm))
  }

  return (
    <div className="relative min-h-full" style={{ width: width + HEADER_W }}>
      {/* Regla de compases */}
      <div
        className="sticky top-0 z-20 flex border-b border-line bg-panel"
        style={{ height: RULER_H }}
      >
        <div className="sticky left-0 z-10 shrink-0 bg-panel" style={{ width: HEADER_W }} />
        <div className="relative cursor-pointer" style={{ width }} onClick={seekFromEvent}>
          {Array.from({ length: totalBeats / perBar }, (_, bar) => (
            <span
              key={bar}
              className="absolute top-0 h-full border-l border-line pl-1 text-[10px] text-muted"
              style={{ left: bar * perBar * pxPerBeat }}
            >
              {bar + 1}
            </span>
          ))}
        </div>
      </div>

      {project.tracks.map((track) => (
        <div key={track.id} className="flex border-b border-line" style={{ height: LANE_H }}>
          <div
            className="sticky left-0 z-10 flex shrink-0 flex-col justify-center gap-0.5 border-r border-line bg-panel px-3"
            style={{ width: HEADER_W, borderLeft: `3px solid ${ROLE_COLORS[track.role]}` }}
          >
            <span className="truncate text-sm">{track.name}</span>
            <span className="text-[10px] uppercase text-muted">{track.role}</span>
          </div>
          <div
            className="relative"
            style={{
              width,
              backgroundImage: `repeating-linear-gradient(to right, var(--color-line) 0 1px, transparent 1px ${perBar * pxPerBeat}px)`
            }}
            onPointerDown={() => select(null)}
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
      onPointerDown={(e) => {
        e.stopPropagation()
        select(region.id)
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

function Playhead({ offset }: { offset: number }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let raf = 0
    const tick = (): void => {
      const { project } = useProject.getState()
      const { pxPerBeat } = useUi.getState()
      if (ref.current && project) {
        const x = secondsToBeats(engine.positionSec, project.bpm) * pxPerBeat
        ref.current.style.transform = `translateX(${offset + x}px)`
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [offset])

  return (
    <div ref={ref} className="pointer-events-none absolute top-0 bottom-0 z-30 w-px bg-white" />
  )
}
