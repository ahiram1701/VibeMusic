import { useState } from 'react'
import { useGeneration } from '../store/generation'

// Ajustes del motor que canta (ACE-Step en Hugging Face). Funciona sin token, pero la
// cuota gratuita de GPU es diaria y por usuario: con un token gratuito dura más.

export function VocalsSection(): React.JSX.Element {
  const { settings, refresh } = useGeneration()
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const field = 'rounded border border-line bg-bg px-2 py-1 text-sm text-white'

  const save = async (): Promise<void> => {
    setBusy(true)
    setMessage(null)
    const res = await window.vibe.settings.setHfToken(token)
    setBusy(false)
    if (res.ok) {
      setToken('')
      setMessage({ ok: true, text: `Conectado como ${res.info}. Guardado cifrado en este equipo.` })
    } else {
      setMessage({ ok: false, text: res.error })
    }
    await refresh()
  }

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">Voces: ACE-Step en Hugging Face (gratis)</h3>
      <p className="text-xs text-muted">
        Canta la letra que escribe el productor (o la tuya, en la pestaña Letra). Usa la GPU
        gratuita de Hugging Face, que tiene una cuota de pocos minutos al día: cada canción gasta
        unos 3 min, así que salen una o dos al día. Con tu token gratuito de{' '}
        <a
          href="https://huggingface.co/settings/tokens"
          target="_blank"
          rel="noreferrer"
          className="text-accent underline"
        >
          huggingface.co/settings/tokens
        </a>{' '}
        (tipo &quot;Read&quot;) la cuota es mayor que sin él.
      </p>
      <p className="text-xs">
        Estado:{' '}
        {settings?.hasHfToken ? (
          <span className="text-emerald-400">token guardado ✓</span>
        ) : (
          <span className="text-amber-400">no guardado (cuota mínima)</span>
        )}
      </p>
      <div className="flex gap-2">
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={settings?.hasHfToken ? 'Pegar un token nuevo…' : 'hf_…'}
          className={`${field} flex-1`}
          autoComplete="off"
          spellCheck={false}
          aria-label="Token de Hugging Face"
        />
        <button
          className="rounded bg-accent px-3 text-sm disabled:opacity-40"
          disabled={busy || token.trim().length < 8}
          onClick={save}
        >
          {busy ? 'Comprobando…' : 'Guardar'}
        </button>
      </div>
      {settings?.hasHfToken && (
        <button
          className="text-xs text-muted underline hover:text-red-400"
          onClick={async () => {
            await window.vibe.settings.clearHfToken()
            setMessage({ ok: true, text: 'Token borrado.' })
            await refresh()
          }}
        >
          Borrar token
        </button>
      )}
      {message && (
        <p className={`text-xs ${message.ok ? 'text-emerald-400' : 'text-red-400'}`}>
          {message.text}
        </p>
      )}
    </section>
  )
}
