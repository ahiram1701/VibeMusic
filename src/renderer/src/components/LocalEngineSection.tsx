import { useEffect, useRef, useState } from 'react'
import { LOCAL_MODELS, type LocalEngineStatus, type TorchVariant } from '@shared/local-engine'
import { useGeneration } from '../store/generation'

const MAX_LOG = 300

/** Ajustes del motor de audio local: instalación, estado, modelo y arranque. */
export function LocalEngineSection(): React.JSX.Element {
  const { settings, refresh } = useGeneration()
  const [status, setStatus] = useState<LocalEngineStatus>({ state: 'checking' })
  const [log, setLog] = useState<string[]>([])
  const [variant, setVariant] = useState<TorchVariant>('cpu')
  const [error, setError] = useState<string | null>(null)
  const logRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    void window.vibe.localEngine.status().then(setStatus)
    const offStatus = window.vibe.localEngine.onStatus((s) => {
      setStatus(s)
      void refresh() // el proveedor "Local" cambia de disponible/no disponible
    })
    const offLog = window.vibe.localEngine.onLog((line) =>
      setLog((l) => [...l, line].slice(-MAX_LOG))
    )
    return () => {
      offStatus()
      offLog()
    }
  }, [refresh])

  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [log])

  const run = async (fn: () => Promise<{ ok: boolean; error?: string } | void>): Promise<void> => {
    setError(null)
    const res = await fn()
    if (res && !res.ok) setError(res.error ?? 'Error desconocido')
  }

  const field = 'rounded border border-line bg-bg px-2 py-1 text-sm text-white'
  const btn = 'rounded px-3 py-1 text-sm disabled:opacity-40'
  const model = LOCAL_MODELS.find((m) => m.id === settings?.localModel) ?? LOCAL_MODELS[0]
  const onCpu = status.state === 'running' ? status.device?.device !== 'cuda' : true

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">Motor de audio: Local (tu equipo)</h3>
      <p className="text-xs text-muted">
        Genera con MusicGen en tu propio ordenador: gratis, privado y sin internet. Con una GPU
        NVIDIA moderna es rápido; solo con CPU funciona, pero tarda varios minutos por clip.
      </p>

      <p className="text-xs" aria-live="polite">
        Estado: <StatusText status={status} />
      </p>

      {status.state === 'not-installed' && (
        <div className="space-y-2 rounded-md border border-line p-2">
          <label className="flex flex-col gap-1 text-xs text-muted">
            Tipo de instalación
            <select
              value={variant}
              onChange={(e) => setVariant(e.target.value as TorchVariant)}
              className={field}
            >
              <option value="cpu">Solo CPU (~1 GB en disco) · funciona en cualquier equipo</option>
              <option value="cuda">GPU NVIDIA (~4 GB en disco) · mucho más rápido</option>
            </select>
          </label>
          <p className="text-xs text-muted">
            Necesita Python 3.10–3.13 instalado (python.org). Se crea un entorno propio sin tocar tu
            Python. El modelo (~2 GB) se descarga la primera vez que generes.
          </p>
          <button
            className={`${btn} bg-accent`}
            onClick={() => run(() => window.vibe.localEngine.install(variant))}
          >
            Instalar motor local
          </button>
        </div>
      )}

      {(status.state === 'stopped' ||
        status.state === 'running' ||
        status.state === 'starting' ||
        status.state === 'error') && (
        <div className="space-y-2">
          <label className="flex flex-col gap-1 text-xs text-muted">
            Modelo
            <select
              value={model.id}
              onChange={async (e) => {
                await window.vibe.settings.setLocalModel(e.target.value)
                await refresh()
              }}
              className={field}
            >
              {LOCAL_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} · ~{m.ramGb} GB de RAM
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs text-muted">{model.note}</p>
          {onCpu && model.ramGb > 3 && (
            <p className="text-xs text-amber-400">
              En CPU este modelo será muy lento y puede quedarse sin memoria. Usa “small”.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {status.state === 'running' ? (
              <button
                className={`${btn} border border-line`}
                onClick={() => run(() => window.vibe.localEngine.stop())}
              >
                Detener
              </button>
            ) : (
              <button
                className={`${btn} bg-accent`}
                disabled={status.state === 'starting'}
                onClick={() => run(() => window.vibe.localEngine.start())}
              >
                {status.state === 'starting' ? 'Arrancando…' : 'Arrancar ahora'}
              </button>
            )}
            <button
              className={`${btn} text-muted underline hover:text-red-400`}
              onClick={() => {
                if (window.confirm('¿Desinstalar el motor local? Se borrará su entorno.')) {
                  void run(() => window.vibe.localEngine.uninstall())
                }
              }}
            >
              Desinstalar
            </button>
          </div>
          <p className="text-xs text-muted">
            No hace falta arrancarlo a mano: se inicia solo al generar con el motor Local.
          </p>
        </div>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}

      {log.length > 0 && (
        <details open={status.state === 'installing'} className="text-xs">
          <summary className="cursor-pointer text-muted">Registro ({log.length} líneas)</summary>
          <pre
            ref={logRef}
            className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-bg p-2 font-mono text-[10px] text-muted"
          >
            {log.join('\n')}
          </pre>
        </details>
      )}
    </section>
  )
}

function StatusText({ status }: { status: LocalEngineStatus }): React.JSX.Element {
  switch (status.state) {
    case 'checking':
      return <span className="text-muted">comprobando…</span>
    case 'not-installed':
      return <span className="text-amber-400">no instalado</span>
    case 'installing':
      return (
        <span className="animate-pulse text-accent">
          instalando · {status.step} (puede tardar varios minutos)
        </span>
      )
    case 'stopped':
      return (
        <span className="text-muted">
          instalado ({status.variant === 'cuda' ? 'GPU' : 'CPU'}), detenido
        </span>
      )
    case 'starting':
      return <span className="animate-pulse text-accent">arrancando…</span>
    case 'running': {
      const d = status.device
      const where =
        d?.device === 'cuda'
          ? `GPU ${d.gpu}`
          : `CPU${d?.threads ? ` (${d.threads} hilos)` : ''}${d?.reason ? ` · ${d.reason}` : ''}`
      return <span className="text-emerald-400">en marcha · {where}</span>
    }
    case 'error':
      return <span className="text-red-400">{status.error}</span>
  }
}
