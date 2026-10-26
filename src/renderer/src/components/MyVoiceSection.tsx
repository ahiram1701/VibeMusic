import { useEffect, useRef, useState } from 'react'
import type { VoiceEngineStatus } from '@shared/voice'
import { useVoice } from '../store/voice'

// Ajustes de "Mi voz": instalar el motor (Applio/RVC), importar la voz entrenada y la
// guía para entrenarla gratis en Colab o Kaggle.

const NOTEBOOK = 'ahiram1701/VibeMusic/blob/main/notebooks/entrenar-mi-voz.ipynb'
const COLAB_URL = `https://colab.research.google.com/github/${NOTEBOOK}`
const GITHUB_URL = `https://github.com/${NOTEBOOK}`

export function MyVoiceSection(): React.JSX.Element {
  const { status, voices, log, init, refresh } = useVoice()
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const logRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    void init()
  }, [init])
  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [log])

  const btn = 'rounded px-3 py-1 text-sm disabled:opacity-40'
  const link = 'text-accent underline'

  const install = async (): Promise<void> => {
    setMessage(null)
    const res = await window.vibe.voice.install()
    if (!res.ok) setMessage({ ok: false, text: res.error })
    await refresh()
  }

  const importVoice = async (): Promise<void> => {
    setMessage(null)
    const res = await window.vibe.voice.importVoice()
    if (!res) return
    setMessage(
      res.ok
        ? { ok: true, text: `Voz "${res.voice.name}" importada.` }
        : { ok: false, text: res.error }
    )
    await refresh()
  }

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">Mi voz (que las canciones suenen como tú)</h3>
      <p className="text-xs text-muted">
        Convierte la voz que canta una canción a <strong>tu timbre</strong>, sin que tengas que
        cantarla. Es gratis y funciona en tu equipo: en CPU tarda unas 2–3 veces lo que dura la voz.
        Úsalo solo con tu propia voz o con permiso de la persona.
      </p>

      <p className="text-xs" aria-live="polite">
        Estado: <StatusText status={status} />
      </p>

      {status.state === 'not-installed' && (
        <div className="space-y-2 rounded-md border border-line p-2">
          <p className="text-xs text-muted">
            Instala Applio (RVC), PyTorch para CPU y sus modelos base: ~2 GB en disco. Necesita
            Python 3.10–3.13 (python.org). Se crea un entorno propio sin tocar tu Python.
          </p>
          <button className={`${btn} bg-accent`} onClick={install}>
            Instalar &quot;Mi voz&quot;
          </button>
        </div>
      )}

      {(status.state === 'ready' || status.state === 'error') && (
        <div className="space-y-2">
          <div className="rounded-md border border-line p-2 text-xs">
            <div className="mb-1 text-muted">Tus voces</div>
            {voices.length === 0 ? (
              <p className="text-amber-400">Aún no hay ninguna. Entrena la tuya (abajo).</p>
            ) : (
              <ul className="space-y-1">
                {voices.map((v) => (
                  <li key={v.id} className="flex items-center gap-2">
                    <span className="flex-1">
                      {v.name}
                      {!v.hasIndex && <span className="text-muted"> (sin .index)</span>}
                    </span>
                    <button
                      className="text-muted underline hover:text-red-400"
                      onClick={async () => {
                        if (window.confirm(`¿Borrar la voz "${v.name}"?`)) {
                          await window.vibe.voice.remove(v.id)
                          await refresh()
                        }
                      }}
                    >
                      Borrar
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button className={`${btn} mt-2 bg-accent`} onClick={importVoice}>
              Importar voz (.zip o .pth + .index)
            </button>
          </div>
          {status.state === 'error' && (
            <button className={`${btn} border border-line`} onClick={install}>
              Reintentar la instalación
            </button>
          )}
        </div>
      )}

      <details className="rounded-md border border-line p-2 text-xs">
        <summary className="cursor-pointer">Cómo entrenar tu voz gratis (una sola vez)</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-4 text-muted">
          <li>
            Graba de <strong>10 a 30 minutos</strong> de tu voz, mejor cantando (aunque sea mal):
            sin música de fondo, sin eco y en un sitio silencioso. Varios archivos WAV o MP3 en un
            .zip.
          </li>
          <li>
            Abre el cuaderno en{' '}
            <a href={COLAB_URL} target="_blank" rel="noreferrer" className={link}>
              Google Colab
            </a>{' '}
            (o impórtalo en Kaggle desde{' '}
            <a href={GITHUB_URL} target="_blank" rel="noreferrer" className={link}>
              GitHub
            </a>
            ). Activa la GPU gratuita (Colab: Entorno de ejecución → Cambiar tipo → T4).
          </li>
          <li>
            Ejecuta las celdas en orden y sube tu .zip cuando lo pida. Entrenar tarda entre 30 y 90
            minutos.
          </li>
          <li>Descarga el .zip que genera al final e impórtalo aquí con el botón de arriba.</li>
        </ol>
      </details>

      {message && (
        <p className={`text-xs ${message.ok ? 'text-emerald-400' : 'text-red-400'}`}>
          {message.text}
        </p>
      )}

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

function StatusText({ status }: { status: VoiceEngineStatus }): React.JSX.Element {
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
    case 'ready':
      return <span className="text-emerald-400">instalado ✓</span>
    case 'error':
      return <span className="text-red-400">{status.error}</span>
  }
}
