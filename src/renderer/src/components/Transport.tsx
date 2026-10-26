import { useEffect, useState, useSyncExternalStore } from 'react'
import {
  formatClock,
  formatPosition,
  jumpTarget,
  parsePosition,
  projectEndSec,
  type GridResolution,
  type Jump
} from '@shared/timeline'
import { engine } from '../audio/engine'
import { useProject } from '../store/project'
import { useUi } from '../store/ui'
import { ExportDialog } from './ExportDialog'
import { zoomAt } from './timeline-view'

const GRIDS: { value: GridResolution; label: string }[] = [
  { value: 'bar', label: 'Compás' },
  { value: 'beat', label: '1/4' },
  { value: 'half', label: '1/8' },
  { value: 'quarter', label: '1/16' },
  { value: 'off', label: 'Libre' }
]

export function Transport(): React.JSX.Element | null {
  const { project, setTempo, importAudio } = useProject()
  const { grid, setGrid, follow, setFollow } = useUi()
  // El motor avisa cuando cambia play/stop; React se re-renderiza solo entonces.
  const playing = useSyncExternalStore(engine.subscribe, engine.isPlaying)
  const [exportOpen, setExportOpen] = useState(false)

  useEffect(() => {
    // Espacio = play/stop en toda la app. Se captura antes que nadie y se cancela
    // también el keyup: si no, un botón con foco recibe el Espacio como un clic
    // y play/stop se alterna dos veces (parece que "no hace nada").
    const isTyping = (e: KeyboardEvent): boolean =>
      !!(e.target as HTMLElement).closest('input, textarea, select')
    const onKeyDown = (e: KeyboardEvent): void => {
      if (isTyping(e)) return
      const p = useProject.getState().project
      if (!p) return
      if (e.code === 'Space') {
        e.preventDefault()
        if (!e.repeat) engine.toggle(p)
        return
      }
      // Moverse por la canción: Inicio/Fin, ←/→ por compases, Mayús+←/→ por secciones.
      const jump: Jump | null =
        e.key === 'Home'
          ? 'start'
          : e.key === 'End'
            ? 'end'
            : e.key === 'ArrowLeft'
              ? e.shiftKey
                ? 'prevSection'
                : 'prevBar'
              : e.key === 'ArrowRight'
                ? e.shiftKey
                  ? 'nextSection'
                  : 'nextBar'
                : null
      if (!jump || e.ctrlKey || e.altKey || e.metaKey) return
      e.preventDefault()
      engine.seek(p, jumpTarget(jump, engine.positionSec, p))
    }
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.code === 'Space' && !isTyping(e)) e.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
    }
  }, [])

  if (!project) return null

  const btn = 'rounded px-3 py-1 text-sm hover:bg-line'

  return (
    <div className="flex items-center gap-2">
      <button
        className={`${btn} w-20 bg-accent/80 font-medium hover:bg-accent`}
        onClick={() => engine.toggle(project)}
        title="Espacio"
      >
        {playing ? '■ Stop' : '▶ Play'}
      </button>
      <button className={btn} onClick={() => engine.seek(project, 0)} title="Al inicio (Inicio)">
        ⏮
      </button>
      <PositionDisplay />

      <label className="ml-4 flex items-center gap-1 text-sm text-muted">
        BPM
        <input
          key={project.bpm}
          type="number"
          min={40}
          max={240}
          defaultValue={project.bpm}
          className="w-16 rounded border border-line bg-bg px-2 py-0.5 text-white"
          onBlur={(e) => {
            const bpm = Math.round(Number(e.target.value))
            if (bpm >= 40 && bpm <= 240 && bpm !== project.bpm) {
              void setTempo(bpm)
            } else e.target.value = String(project.bpm)
          }}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
      </label>

      <label className="ml-2 flex items-center gap-1 text-sm text-muted">
        Rejilla
        <select
          value={grid}
          onChange={(e) => setGrid(e.target.value as GridResolution)}
          className="rounded border border-line bg-bg px-1 py-0.5 text-white"
        >
          {GRIDS.map((g) => (
            <option key={g.value} value={g.value}>
              {g.label}
            </option>
          ))}
        </select>
      </label>

      <button className={btn} onClick={() => zoomAt(0.8, project)} title="Alejar (Ctrl + rueda)">
        −
      </button>
      <button className={btn} onClick={() => zoomAt(1.25, project)} title="Acercar (Ctrl + rueda)">
        +
      </button>
      <button
        className={`${btn} ${follow ? 'text-white' : 'text-muted'}`}
        aria-pressed={follow}
        onClick={() => setFollow(!follow)}
        title="La vista sigue a la línea de reproducción mientras suena"
      >
        ⇥ Seguir
      </button>

      <div className="ml-auto flex gap-2">
        <button className={`${btn} border border-line`} onClick={importAudio}>
          Importar audio…
        </button>
        <button
          className={`${btn} border border-line disabled:opacity-50`}
          disabled={project.tracks.length === 0}
          onClick={() => setExportOpen(true)}
        >
          Exportar…
        </button>
      </div>
      {exportOpen && <ExportDialog onClose={() => setExportOpen(false)} />}
    </div>
  )
}

const SHORTCUTS =
  'Clic para escribir adónde ir: un compás (9), compás.tiempo (9.3) o minutos:segundos (1:23).\n' +
  'Atajos: Espacio play/stop · Inicio/Fin · ←/→ compás · Mayús+←/→ sección'

/**
 * Contador: compás.tiempo, minutos:segundos y duración total. Se actualiza en su
 * propio bucle para no re-renderizar toda la barra. Con un clic se escribe adónde ir.
 */
function PositionDisplay(): React.JSX.Element {
  const [pos, setPos] = useState('1.1')
  const [clock, setClock] = useState('0:00 / 0:00')
  const [editing, setEditing] = useState(false)
  const [invalid, setInvalid] = useState(false)

  useEffect(() => {
    let raf = 0
    const tick = (): void => {
      try {
        const { project } = useProject.getState()
        if (project) {
          setPos(formatPosition(engine.positionSec, project))
          setClock(`${formatClock(engine.positionSec)} / ${formatClock(projectEndSec(project))}`)
        }
      } finally {
        // Pase lo que pase, el bucle sigue vivo (antes un error lo mataba para siempre).
        raf = requestAnimationFrame(tick)
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  if (editing) {
    return (
      <input
        autoFocus
        aria-label="Ir a la posición"
        defaultValue={pos}
        onFocus={(e) => e.target.select()}
        className={`w-24 rounded border bg-bg px-1 py-0.5 font-mono text-sm text-white ${invalid ? 'border-red-500' : 'border-line'}`}
        onBlur={() => {
          setEditing(false)
          setInvalid(false)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') e.currentTarget.blur()
          if (e.key !== 'Enter') return
          const p = useProject.getState().project
          const sec = p ? parsePosition(e.currentTarget.value, p) : null
          if (sec === null || !p) {
            setInvalid(true)
            return
          }
          engine.seek(p, sec)
          e.currentTarget.blur()
        }}
      />
    )
  }
  return (
    <button
      className="flex items-baseline gap-2 rounded px-1 font-mono text-sm tabular-nums hover:bg-line"
      title={SHORTCUTS}
      aria-label="Posición (clic para ir a otra)"
      onClick={() => setEditing(true)}
    >
      <span className="w-12 text-left">{pos}</span>
      <span className="text-xs text-muted">{clock}</span>
    </button>
  )
}
