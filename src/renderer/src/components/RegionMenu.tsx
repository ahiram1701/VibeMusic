import { useEffect, useRef, useState } from 'react'
import { removeRegion } from '@shared/project'
import { cleanError } from '../store/chat'
import { continueRegion, duplicateRegionAfter, varyRegion } from '../store/clip-actions'
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

  const run = (label: string, fn: () => Promise<unknown>): void => {
    closeRegionMenu()
    setInstructions('')
    fn().then(
      () => notify(label),
      (err: unknown) => notify(cleanError(err), 'error')
    )
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
