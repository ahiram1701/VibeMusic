import { useEffect, useRef, useState } from 'react'
import { removeRegion } from '@shared/project'
import { cleanError } from '../store/chat'
import {
  continueRegion,
  duplicateRegionAfter,
  separateRegion,
  varyRegion
} from '../store/clip-actions'
import { useProject } from '../store/project'
import { useUi } from '../store/ui'

const CONTINUE_BARS = [2, 4, 8]

/** Menú contextual (clic derecho) de una región del timeline. */
export function RegionMenu(): React.JSX.Element | null {
  const { regionMenu, closeRegionMenu, notify, select } = useUi()
  const [instructions, setInstructions] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  // Se cierra al hacer clic fuera o con Escape.
  useEffect(() => {
    if (!regionMenu) return
    const onDown = (e: PointerEvent): void => {
      if (!ref.current?.contains(e.target as Node)) closeRegionMenu()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeRegionMenu()
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [regionMenu, closeRegionMenu])

  if (!regionMenu) return null
  const { regionId } = regionMenu

  /**
   * Cierra el menú, avisa de lo que empieza y lanza la acción. El aviso va ANTES:
   * acciones largas (separar pistas) muestran su propio resultado al terminar y no
   * deben quedar tapadas por el aviso de inicio.
   */
  const run = (label: string, fn: () => Promise<unknown>): void => {
    closeRegionMenu()
    setInstructions('')
    notify(label)
    fn().catch((err: unknown) => notify(cleanError(err), 'error'))
  }
  const extra = instructions.trim() || undefined
  const item = 'block w-full rounded px-3 py-1.5 text-left text-sm hover:bg-line'

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Acciones de la región"
      className="fixed z-50 w-64 rounded-md border border-line bg-panel p-1 shadow-xl"
      style={{
        left: Math.min(regionMenu.x, window.innerWidth - 270),
        top: Math.min(regionMenu.y, window.innerHeight - 330)
      }}
    >
      <input
        value={instructions}
        onChange={(e) => setInstructions(e.target.value)}
        placeholder="Indicaciones (opcional): más energía…"
        aria-label="Indicaciones para la IA"
        className="mb-1 w-full rounded border border-line bg-bg px-2 py-1 text-xs text-white"
        autoFocus
      />
      <button
        role="menuitem"
        className={item}
        onClick={() =>
          run('Generando una variación…', () => varyRegion(regionId, { instructions: extra }))
        }
      >
        🎲 Variación
      </button>
      <div className="px-3 pt-1.5 pb-0.5 text-xs text-muted">✨ Continuar con IA</div>
      <div className="flex gap-1 px-2 pb-1">
        {CONTINUE_BARS.map((bars) => (
          <button
            key={bars}
            role="menuitem"
            className="flex-1 rounded border border-line py-1 text-xs hover:bg-line"
            onClick={() =>
              run(`Continuando ${bars} compases…`, () =>
                continueRegion(regionId, bars, { instructions: extra })
              )
            }
          >
            +{bars} compases
          </button>
        ))}
      </div>
      <hr className="my-1 border-line" />
      <button
        role="menuitem"
        className={item}
        title="Voz, batería, bajo y otros instrumentos, con el motor local"
        onClick={() =>
          run('Separando en pistas (puede tardar varios minutos)…', async () => {
            const r = await separateRegion(regionId)
            useUi
              .getState()
              .notify(
                `Separado en ${r.stems.join(', ')}${r.skipped.length ? ` (sin ${r.skipped.join(', ').toLowerCase()})` : ''}`
              )
          })
        }
      >
        🎚 Separar en pistas (voz, batería…)
      </button>
      <button
        role="menuitem"
        className={item}
        onClick={() => run('Región duplicada', () => duplicateRegionAfter(regionId))}
      >
        ⧉ Duplicar a continuación
      </button>
      <button
        role="menuitem"
        className={`${item} text-red-400`}
        onClick={() =>
          run('Región eliminada', async () => {
            const { project, commit } = useProject.getState()
            if (!project) return
            select(null)
            await commit(removeRegion(project, regionId), 'Región eliminada')
          })
        }
      >
        🗑 Eliminar
      </button>
    </div>
  )
}

/** Tareas largas en curso (abajo a la derecha), con progreso y botón de cancelar. */
export function TaskList(): React.JSX.Element | null {
  const tasks = useUi((s) => s.tasks)
  if (tasks.length === 0) return null
  return (
    <div className="fixed right-4 bottom-4 z-40 w-72 space-y-2" aria-label="Tareas en curso">
      {tasks.map((t) => {
        const pct = t.progress === null ? null : Math.round(t.progress * 100)
        return (
          <div
            key={t.id}
            role="status"
            className="rounded-md border border-line bg-panel p-3 text-xs shadow-xl"
          >
            <div className="flex items-center justify-between gap-2">
              <strong className="truncate text-white">{t.label}</strong>
              {t.cancel && (
                <button className="shrink-0 text-muted hover:text-red-400" onClick={t.cancel}>
                  Cancelar
                </button>
              )}
            </div>
            <p className="mt-1 text-muted">
              {t.stage}
              {pct !== null && ` · ${pct} %`}
            </p>
            <div className="mt-1.5 h-1 overflow-hidden rounded bg-line">
              <div
                className={`h-full bg-accent ${pct === null ? 'w-1/3 animate-pulse' : ''}`}
                style={pct === null ? undefined : { width: `${pct}%` }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** Aviso breve en la parte inferior de la pantalla. */
export function Toast(): React.JSX.Element | null {
  const toast = useUi((s) => s.toast)
  if (!toast) return null
  return (
    <div
      role="status"
      className={`fixed bottom-6 left-1/2 z-50 max-w-lg -translate-x-1/2 rounded-md px-4 py-2 text-sm shadow-xl ${
        toast.tone === 'error' ? 'bg-red-600 text-white' : 'bg-panel text-white ring-1 ring-line'
      }`}
    >
      {toast.text}
    </div>
  )
}
