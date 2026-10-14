import { useEffect } from 'react'
import type { VersionMeta } from '@shared/project'
import { duration, fullDate, relative, shortTime } from '@shared/time'
import { useNow } from '../hooks/useNow'
import { useProject } from '../store/project'

/** Texto al pasar el cursor: mensaje, fecha completa, hace cuánto y tiempo desde la anterior. */
function versionTooltip(v: VersionMeta, prev: VersionMeta | undefined, now: number): string {
  const when = `${fullDate(v.createdAt)} · ${relative(v.createdAt, now)}`
  const gap = prev
    ? `${duration(Date.parse(v.createdAt) - Date.parse(prev.createdAt))} después de v${prev.id}`
    : null
  return [v.message, when, gap].filter(Boolean).join('\n')
}

export function History(): React.JSX.Element {
  const { versions, history, undo, redo, checkout } = useProject()
  // Refresca "hace N min" de los tooltips y "ayer" al pasar la medianoche.
  const now = useNow(60_000)

  // Ctrl+Z deshacer · Ctrl+Y o Ctrl+Shift+Z rehacer (fuera de campos de texto).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey)) return
      if ((e.target as HTMLElement).closest('input, textarea, select')) return
      const key = e.key.toLowerCase()
      const { undo, redo } = useProject.getState()
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault()
        void undo()
      } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
        e.preventDefault()
        void redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const canUndo = history.undo.length > 0
  const canRedo = history.redo.length > 0
  const nextUndo = history.undo.at(-1)?.message
  const nextRedo = history.redo.at(-1)?.message
  const btn =
    'rounded border border-line px-2 py-0.5 text-xs hover:bg-line disabled:cursor-not-allowed disabled:opacity-40'

  return (
    <div className="flex h-[38%] min-h-40 shrink-0 flex-col border-t border-line p-3">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-xs uppercase tracking-wide text-muted">Historial</h2>
        <div className="ml-auto flex gap-1">
          <button
            className={btn}
            disabled={!canUndo}
            onClick={undo}
            title={canUndo ? `Deshacer: ${nextUndo} (Ctrl+Z)` : 'Nada que deshacer'}
          >
            ↶ Deshacer
          </button>
          <button
            className={btn}
            disabled={!canRedo}
            onClick={redo}
            title={canRedo ? `Rehacer: ${nextRedo} (Ctrl+Y)` : 'Nada que rehacer'}
          >
            ↷ Rehacer
          </button>
        </div>
      </div>

      <ol className="min-h-0 flex-1 space-y-0.5 overflow-auto text-sm">
        {[...versions].reverse().map((v, i) => {
          const current = i === 0
          const prev = versions[versions.length - 2 - i]
          return (
            <li
              key={v.id}
              className={`group flex items-center justify-between gap-2 rounded px-1 py-0.5 ${current ? 'bg-accent/15' : 'hover:bg-line/60'}`}
              title={versionTooltip(v, prev, now)}
            >
              <span className="truncate">
                <span className="text-muted">v{v.id}</span> {v.message}
              </span>
              <span className="relative flex shrink-0 items-center gap-2">
                {current && <span className="text-[10px] uppercase text-accent">actual</span>}
                {/* Al pasar el cursor, "volver aquí" ocupa el sitio de la hora (por opacidad:
                    así el botón sigue accesible con el teclado). */}
                <span
                  className={`text-[11px] tabular-nums text-muted ${current ? '' : 'group-focus-within:opacity-0 group-hover:opacity-0'}`}
                >
                  {shortTime(v.createdAt, now)}
                </span>
                {!current && (
                  <button
                    className="absolute right-0 whitespace-nowrap text-xs text-accent opacity-0 hover:underline focus:opacity-100 group-hover:opacity-100"
                    onClick={() => checkout(v.id)}
                    title="Deja la canción exactamente como estaba justo después de este cambio"
                  >
                    volver aquí
                  </button>
                )}
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
