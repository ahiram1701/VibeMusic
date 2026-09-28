import { useEffect, useState } from 'react'
import type { ProviderId } from '@shared/generation'
import { useGeneration } from '../store/generation'

export function SettingsDialog({ onClose }: { onClose(): void }): React.JSX.Element {
  const { settings, providers, refresh } = useGeneration()
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const saveToken = async (): Promise<void> => {
    setBusy(true)
    setMessage(null)
    const res = await window.vibe.settings.setReplicateToken(token)
    setBusy(false)
    if (res.ok) {
      setToken('')
      setMessage({
        ok: true,
        text: `Conectado como ${res.username}. Guardada cifrada en este equipo.`
      })
    } else {
      setMessage({ ok: false, text: res.error })
    }
    await refresh()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const field = 'rounded border border-line bg-bg px-2 py-1 text-sm text-white'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-label="Ajustes"
        className="w-[480px] max-w-[calc(100vw-32px)] rounded-lg border border-line bg-panel p-5 shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Ajustes</h2>
          <button
            className="text-muted hover:text-white"
            onClick={onClose}
            aria-label="Cerrar ajustes"
          >
            ✕
          </button>
        </div>

        <section className="space-y-2">
          <h3 className="text-sm font-medium">Replicate (IA en la nube)</h3>
          <p className="text-xs text-muted">
            Genera música con MusicGen de Meta. Se paga por uso en tu cuenta de Replicate (unos
            céntimos por clip). Consigue tu token en{' '}
            <a
              href="https://replicate.com/account/api-tokens"
              target="_blank"
              rel="noreferrer"
              className="text-accent underline"
            >
              replicate.com/account/api-tokens
            </a>
            .
          </p>
          <p className="text-xs">
            Estado:{' '}
            {settings?.hasReplicateToken ? (
              <span className="text-emerald-400">token guardado ✓</span>
            ) : (
              <span className="text-amber-400">sin token</span>
            )}
          </p>
          <div className="flex gap-2">
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={settings?.hasReplicateToken ? 'Pegar un token nuevo…' : 'r8_…'}
              className={`${field} flex-1`}
              autoComplete="off"
              spellCheck={false}
            />
            <button
              className="rounded bg-accent px-3 text-sm disabled:opacity-40"
              disabled={busy || token.trim().length < 8}
              onClick={saveToken}
            >
              {busy ? 'Comprobando…' : 'Guardar'}
            </button>
          </div>
          {settings?.hasReplicateToken && (
            <button
              className="text-xs text-muted underline hover:text-red-400"
              onClick={async () => {
                await window.vibe.settings.clearReplicateToken()
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

        <section className="mt-5 space-y-2">
          <h3 className="text-sm font-medium">Motor por defecto</h3>
          <select
            value={settings?.defaultProvider ?? 'demo'}
            onChange={async (e) => {
              await window.vibe.settings.setDefaultProvider(e.target.value as ProviderId)
              await refresh()
            }}
            className={`${field} w-full`}
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted">
            {providers.find((p) => p.id === settings?.defaultProvider)?.description}
          </p>
        </section>
      </div>
    </div>
  )
}
