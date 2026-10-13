import { useEffect, useState } from 'react'
import { dismissKey, useUpdate } from '../store/update'

/**
 * Aviso flotante de la actualización: mientras se descarga muestra el progreso;
 * cuando está lista ofrece "Reiniciar ahora" (instala y vuelve a abrir la app) o
 * "Más tarde" (se instalará igualmente al cerrar).
 */
export function UpdateBanner(): React.JSX.Element | null {
  const { status, dismissed, init, dismiss, restart } = useUpdate()
  const [restarting, setRestarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => init(), [init])

  const visible = status.state === 'downloading' || status.state === 'ready'
  if (!visible || dismissed === dismissKey(status)) return null

  const card =
    'fixed top-14 right-4 z-50 flex w-80 flex-col gap-3 rounded-md bg-panel p-4 text-sm shadow-xl ring-1 ring-line'

  if (status.state === 'downloading') {
    const percent = Math.floor(status.percent ?? 0)
    return (
      <div role="status" className={card}>
        <div className="flex items-baseline justify-between gap-2">
          <p>
            Descargando <strong>VibeMusic {status.version}</strong>…
          </p>
          <span className="text-xs text-muted tabular-nums">{percent} %</span>
        </div>
        <div
          className="h-1.5 overflow-hidden rounded bg-bg"
          role="progressbar"
          aria-label="Progreso de la descarga"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="h-full bg-accent transition-[width]" style={{ width: `${percent}%` }} />
        </div>
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted">Puedes seguir trabajando mientras tanto.</p>
          <button className="text-xs text-muted hover:text-white" onClick={dismiss}>
            Ocultar
          </button>
        </div>
      </div>
    )
  }

  const onRestart = async (): Promise<void> => {
    setRestarting(true)
    setError(null)
    const message = await restart()
    if (message) setError(message)
    // Si se reinicia, la ventana se cierra; si se canceló o falló, se puede reintentar.
    setRestarting(false)
  }

  return (
    <div role="status" className={card}>
      <p>
        <strong>VibeMusic {status.version}</strong> está lista para instalarse. Tus proyectos se
        conservan.
      </p>
      {error && <p className="text-red-400">No se pudo instalar: {error}</p>}
      <div className="flex justify-end gap-2">
        <button
          className="rounded-md px-3 py-1.5 text-muted hover:text-white"
          onClick={dismiss}
          disabled={restarting}
        >
          Más tarde
        </button>
        <button
          className="rounded-md bg-accent px-3 py-1.5 font-medium hover:opacity-90 disabled:opacity-50"
          onClick={() => void onRestart()}
          disabled={restarting}
        >
          {restarting ? 'Reiniciando…' : 'Reiniciar ahora'}
        </button>
      </div>
    </div>
  )
}
