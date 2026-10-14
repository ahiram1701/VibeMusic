import { useEffect, useState } from 'react'
import { describeUpdateStatus, releaseUrl } from '@shared/update'
import { useUpdate } from '../store/update'

/** Ajustes → Actualizaciones: versión, estado en vivo y buscar/instalar a mano. */
export function UpdatesSection(): React.JSX.Element {
  const { status, init, check, restart } = useUpdate()
  const [version, setVersion] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    init()
    void window.vibe.app.version().then(setVersion)
  }, [init])

  const canCheck = ['idle', 'up-to-date', 'error'].includes(status.state)
  const button = 'rounded-md border border-line px-3 py-1.5 text-sm hover:bg-bg disabled:opacity-50'

  return (
    <section className="space-y-2" aria-label="Actualizaciones">
      <h3 className="text-sm font-medium">Actualizaciones</h3>
      <p className="text-sm">
        Versión {version}{' '}
        {version && (
          <a
            href={releaseUrl(version)}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-accent underline hover:opacity-80"
          >
            Novedades de esta versión
          </a>
        )}{' '}
        <button
          className="text-xs text-muted underline hover:text-white"
          title="Registro de lo que hace la app (llamadas al LLM, reintentos, generaciones)"
          onClick={() => void window.vibe.app.openLogs()}
        >
          Abrir registro
        </button>
      </p>
      <p className={`text-xs ${status.state === 'error' ? 'text-red-400' : 'text-muted'}`}>
        {describeUpdateStatus(status)}
      </p>
      {status.state === 'downloading' && (
        <div className="h-1.5 overflow-hidden rounded bg-bg">
          <div className="h-full bg-accent" style={{ width: `${status.percent ?? 0}%` }} />
        </div>
      )}
      {error && <p className="text-xs text-red-400">No se pudo instalar: {error}</p>}
      {status.state !== 'disabled' && (
        <div className="flex gap-2">
          {status.state === 'ready' ? (
            <button
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium hover:opacity-90"
              onClick={async () => setError(await restart())}
            >
              Reiniciar e instalar
            </button>
          ) : (
            <button className={button} disabled={!canCheck} onClick={() => void check()}>
              {status.state === 'checking' ? 'Buscando…' : 'Buscar actualizaciones'}
            </button>
          )}
        </div>
      )}
    </section>
  )
}
