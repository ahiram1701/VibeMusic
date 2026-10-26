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
import {
  CircleHelp,
  Crosshair,
  Download,
  PanelBottom,
  PanelLeft,
  Play,
  Settings,
  SkipBack,
  Square,
  Upload,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import { shortcutHint } from '@shared/shortcuts'
import { engine } from '../audio/engine'
import { useLayout } from '../store/layout'
import { useProject } from '../store/project'
import { useUi } from '../store/ui'
import { ExportDialog } from './ExportDialog'
import { zoomAt } from './timeline-view'
import { Button, Divider, fieldClass, IconButton } from './ui'

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
  const {
    showAside,
    showMixer,
    toggleAside,
    toggleMixer,
    openSettings,
    openShortcuts,
    exportOpen,
    openExport
  } = useLayout()
  // El motor avisa cuando cambia play/stop; React se re-renderiza solo entonces.
  const playing = useSyncExternalStore(engine.subscribe, engine.isPlaying)

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

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      {/* Proyecto */}
      <div className="mr-1 flex min-w-0 shrink items-baseline gap-2">
        <strong className="truncate text-sm" title={project.name}>
          {project.name}
        </strong>
        <span className="shrink-0 text-xs text-muted max-lg:hidden">
          {project.key} · {project.timeSignature.join('/')}
        </span>
      </div>
      <Divider />

      {/* Transporte */}
      <button
        type="button"
        data-testid="play"
        aria-label={playing ? 'Parar' : 'Reproducir'}
        title={`${playing ? 'Parar' : 'Reproducir'} (${shortcutHint('play')})`}
        onClick={() => engine.toggle(project)}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-white transition hover:brightness-110"
      >
        {playing ? (
          <Square size={14} fill="currentColor" />
        ) : (
          <Play size={15} fill="currentColor" />
        )}
      </button>
      <IconButton
        icon={SkipBack}
        label="Al inicio"
        hint={shortcutHint('start')}
        onClick={() => engine.seek(project, 0)}
      />
      <PositionDisplay />
      <Divider />

      {/* Tempo y rejilla */}
      <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted" title="Tempo">
        BPM
        <input
          key={project.bpm}
          type="number"
          min={40}
          max={240}
          defaultValue={project.bpm}
          className={`${fieldClass} w-16 py-0.5`}
          onBlur={(e) => {
            const bpm = Math.round(Number(e.target.value))
            if (bpm >= 40 && bpm <= 240 && bpm !== project.bpm) {
              void setTempo(bpm)
            } else e.target.value = String(project.bpm)
          }}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
      </label>
      <label
        className="ml-1 flex shrink-0 items-center gap-1.5 text-xs text-muted"
        title="A qué se ajustan las regiones y la línea al arrastrar"
      >
        Rejilla
        <select
          value={grid}
          onChange={(e) => setGrid(e.target.value as GridResolution)}
          className={`${fieldClass} py-0.5`}
        >
          {GRIDS.map((g) => (
            <option key={g.value} value={g.value}>
              {g.label}
            </option>
          ))}
        </select>
      </label>
      <Divider />

      {/* Vista */}
      <IconButton
        icon={ZoomOut}
        label="Alejar"
        hint={shortcutHint('zoom')}
        onClick={() => zoomAt(0.8, project)}
      />
      <IconButton
        icon={ZoomIn}
        label="Acercar"
        hint={shortcutHint('zoom')}
        onClick={() => zoomAt(1.25, project)}
      />
      <IconButton
        icon={Crosshair}
        label="Seguir la reproducción"
        active={follow}
        onClick={() => setFollow(!follow)}
      />
      <IconButton
        icon={PanelLeft}
        label={showAside ? 'Ocultar el panel del productor' : 'Mostrar el panel del productor'}
        active={showAside}
        onClick={toggleAside}
      />
      <IconButton
        icon={PanelBottom}
        label={showMixer ? 'Ocultar el mezclador' : 'Mostrar el mezclador'}
        active={showMixer}
        onClick={toggleMixer}
      />

      {/* Archivo y ayuda */}
      <div className="ml-auto flex shrink-0 items-center gap-1 pl-2">
        <Button
          icon={Upload}
          size="sm"
          onClick={importAudio}
          title="Importar audio…"
          aria-label="Importar audio…"
        >
          <span className="max-xl:hidden">Importar</span>
        </Button>
        <Button
          icon={Download}
          size="sm"
          disabled={project.tracks.length === 0}
          onClick={() => openExport(true)}
          title="Exportar…"
          aria-label="Exportar…"
        >
          <span className="max-xl:hidden">Exportar</span>
        </Button>
        <IconButton icon={Settings} label="Ajustes" onClick={() => openSettings()} />
        <IconButton
          icon={CircleHelp}
          label="Atajos y gestos"
          hint={shortcutHint('help')}
          onClick={() => openShortcuts(true)}
        />
      </div>
      {exportOpen && <ExportDialog onClose={() => openExport(false)} />}
    </div>
  )
}

const SHORTCUTS =
  'Clic para escribir adónde ir: un compás (9), compás.tiempo (9.3) o minutos:segundos (1:23).\n' +
  'Todos los atajos: F1'

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
