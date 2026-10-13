import { useEffect, useState } from 'react'
import type { WhatsNew } from '@shared/update'
import { ReleaseNotes } from './ReleaseNotes'

/** Se pide una vez por sesión: el proceso principal solo lo devuelve tras actualizar. */
let request: Promise<WhatsNew | null> | null = null
let closed = false

/** Tras instalar una versión nueva, muestra una vez qué cambió. */
export function WhatsNewDialog(): React.JSX.Element | null {
  const [info, setInfo] = useState<WhatsNew | null>(null)

  useEffect(() => {
    request ??= window.vibe.app.whatsNew()
    void request.then((r) => !closed && setInfo(r))
  }, [])

  useEffect(() => {
    if (!info) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!info) return null

  function close(): void {
    closed = true
    setInfo(null)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div
        role="dialog"
        aria-label={`Novedades de VibeMusic ${info.version}`}
        className="flex max-h-[80vh] w-[min(560px,92vw)] flex-col gap-4 rounded-lg bg-panel p-6 shadow-2xl ring-1 ring-line"
      >
        <div>
          <h2 className="text-lg font-semibold">Novedades de VibeMusic {info.version}</h2>
          <p className="text-sm text-muted">La actualización se instaló correctamente.</p>
        </div>
        <div className="min-h-0 overflow-y-auto pr-1">
          {info.notes ? (
            <ReleaseNotes html={info.notes} />
          ) : (
            <p className="text-sm">Puedes ver todos los cambios de esta versión en GitHub.</p>
          )}
        </div>
        <div className="flex items-center justify-between gap-2">
          <a
            href={info.url}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-accent underline hover:opacity-80"
          >
            Ver en GitHub
          </a>
          <button
            className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium hover:opacity-90"
            onClick={close}
          >
            Entendido
          </button>
        </div>
      </div>
    </div>
  )
}
