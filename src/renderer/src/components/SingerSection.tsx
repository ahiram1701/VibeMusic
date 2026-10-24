import { useEffect, useRef, useState } from 'react'
import type { SingingEngine } from '@shared/generation'
import { SINGER_VOICE, type SingerEngineStatus } from '@shared/singer'
import { useGeneration } from '../store/generation'
import { useSinger } from '../store/singer'

// Ajustes del cantante local (DiffSinger en OpenUtau) y de quién canta las canciones
// con letra: el cantante local o ACE-Step en la nube.

const ENGINES: [SingingEngine, string][] = [
  ['auto', 'Automático: el cantante local si está instalado; si no, la nube'],
  ['local', 'Cantante local (en tu equipo, sin límite)'],
  ['cloud', 'Nube: ACE-Step en Hugging Face (canción completa, 1–2 al día)']
]

export function SingerSection(): React.JSX.Element {
  const { settings, refresh } = useGeneration()
  const { status, log, init } = useSinger()
  const [error, setError] = useState<string | null>(null)
  const logRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    void init()
  }, [init])
  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [log])

  const field = 'w-full rounded border border-line bg-bg px-2 py-1 text-sm text-white'
  const btn = 'rounded px-3 py-1 text-sm disabled:opacity-40'
  const install = async (): Promise<void> => {
    setError(null)
    const res = await window.vibe.singer.install()
    if (!res.ok) setError(res.error)
  }

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">Cantante local (DiffSinger, gratis y sin límite)</h3>
      <p className="text-xs text-muted">
        Una voz sintética canta en tu equipo la melodía que compone el productor, encima del
        instrumental y justo a su tempo y tonalidad. Suena a cantante virtual (estilo Vocaloid), no
        a persona. En CPU tarda unas 2 veces lo que dura la voz.
      </p>

      <label className="block space-y-1 text-xs">
        <span className="text-muted">Quién canta las canciones con letra</span>
        <select
          value={settings?.singingEngine ?? 'auto'}
          className={field}
          onChange={async (e) => {
            await window.vibe.settings.setSingingEngine(e.target.value as SingingEngine)
            await refresh()
          }}
        >
          {ENGINES.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>

      <p className="text-xs" aria-live="polite">
        Estado: <StatusText status={status} />
      </p>

      {(status.state === 'not-installed' || status.state === 'error') && (
        <div className="space-y-2 rounded-md border border-line p-2">
          <p className="text-xs text-muted">
            Descarga el motor (OpenUtau, ~80 MB) y la voz {SINGER_VOICE.name} (~550 MB, de su enlace
            original). No necesita Python ni GPU.
          </p>
          <button className={`${btn} bg-accent`} onClick={install}>
            {status.state === 'error' ? 'Reintentar la instalación' : 'Instalar el cantante local'}
          </button>
        </div>
      )}

      <p className="text-xs text-muted">
        Voz: {SINGER_VOICE.credit}. Se puede usar en obras comerciales y no comerciales dando
        crédito a Lotte V;{' '}
        <a
          href={SINGER_VOICE.termsUrl}
          target="_blank"
          rel="noreferrer"
          className="text-accent underline"
        >
          condiciones de uso
        </a>
        . Sus condiciones no permiten convertir su voz en otra, así que &quot;Mi voz&quot; no se
        aplica a ella.
      </p>

      {status.state === 'ready' && (
        <button
          className={`${btn} text-muted underline hover:text-red-400`}
          onClick={() => {
            if (window.confirm('¿Desinstalar el cantante local? Se borrarán el motor y la voz.')) {
              void window.vibe.singer.uninstall()
            }
          }}
        >
          Desinstalar
        </button>
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

function StatusText({ status }: { status: SingerEngineStatus }): React.JSX.Element {
  switch (status.state) {
    case 'checking':
      return <span className="text-muted">comprobando…</span>
    case 'not-installed':
      return <span className="text-amber-400">no instalado</span>
    case 'installing':
      return <span className="animate-pulse text-accent">instalando · {status.step}</span>
    case 'ready':
      return <span className="text-emerald-400">instalado ✓ ({SINGER_VOICE.name})</span>
    case 'error':
      return <span className="text-red-400">{status.error}</span>
  }
}
