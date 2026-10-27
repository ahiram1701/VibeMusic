import { useState } from 'react'
import { useGeneration } from '../store/generation'

// Internet para el productor: puede buscar en la web y leer páginas para documentarse
// sobre géneros y referencias. Gratis: sin clave usa DuckDuckGo; con una clave gratuita
// de Ollama usa su API de búsqueda, que es más estable.

export function WebAccessSection(): React.JSX.Element | null {
  const { settings, refresh } = useGeneration()
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const field = 'rounded border border-line bg-bg px-2 py-1 text-sm text-white'
  const web = settings?.web
  if (!web) return null

  const save = async (): Promise<void> => {
    setBusy(true)
    setMessage(null)
    const res = await window.vibe.settings.setOllamaWebKey(key)
    setBusy(false)
    if (res.ok) {
      setKey('')
      setMessage({ ok: true, text: `${res.info}. Guardada cifrada en este equipo.` })
    } else {
      setMessage({ ok: false, text: res.error })
    }
    await refresh()
  }

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">Internet para el productor</h3>
      <p className="text-xs text-muted">
        El productor puede buscar en la web cómo suena un género, un artista de referencia o una
        tendencia antes de componer (tempo, instrumentos, producción). Solo lo usa cuando hace falta
        y como mucho unas pocas consultas por mensaje.
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={web.enabled}
          onChange={async (e) => {
            await window.vibe.settings.setWebAccess(e.target.checked)
            await refresh()
          }}
        />
        Permitir que el productor busque en internet
      </label>
      {web.enabled && (
        <>
          <p className="text-xs text-muted">
            Busca con DuckDuckGo, sin cuenta. Si a veces falla, crea una clave gratuita en{' '}
            <a
              href="https://ollama.com/settings/keys"
              target="_blank"
              rel="noreferrer"
              className="text-accent underline"
            >
              ollama.com/settings/keys
            </a>{' '}
            y pégala aquí: la búsqueda de Ollama es más estable.
          </p>
          <p className="text-xs">
            Buscador:{' '}
            {web.hasOllamaKey ? (
              <span className="text-emerald-400">Ollama (clave guardada ✓)</span>
            ) : (
              <span className="text-muted">DuckDuckGo</span>
            )}
          </p>
          <div className="flex gap-2">
            <input
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={
                web.hasOllamaKey ? 'Pegar una clave nueva…' : 'Clave de Ollama (opcional)'
              }
              className={`${field} flex-1`}
              autoComplete="off"
              spellCheck={false}
              aria-label="Clave de Ollama para buscar en internet"
            />
            <button
              className="rounded bg-accent px-3 text-sm disabled:opacity-40"
              disabled={busy || key.trim().length < 8}
              onClick={save}
            >
              {busy ? 'Comprobando…' : 'Guardar'}
            </button>
          </div>
          {web.hasOllamaKey && (
            <button
              className="text-xs text-muted underline hover:text-red-400"
              onClick={async () => {
                await window.vibe.settings.clearOllamaWebKey()
                setMessage({ ok: true, text: 'Clave borrada: se vuelve a usar DuckDuckGo.' })
                await refresh()
              }}
            >
              Borrar clave
            </button>
          )}
        </>
      )}
      {message && (
        <p className={`text-xs ${message.ok ? 'text-emerald-400' : 'text-red-400'}`}>
          {message.text}
        </p>
      )}
    </section>
  )
}
