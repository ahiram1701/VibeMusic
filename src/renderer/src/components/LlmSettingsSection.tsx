import { useState } from 'react'
import { LLM_PROVIDER_LABELS, type LlmProviderId } from '@shared/llm'
import { useGeneration } from '../store/generation'

type RealProvider = keyof typeof LLM_PROVIDER_LABELS

const KEY_LINKS: Record<'anthropic' | 'openai', string> = {
  anthropic: 'https://console.anthropic.com/settings/keys',
  openai: 'https://platform.openai.com/api-keys'
}

/** Ajustes del "cerebro" del productor: proveedor de LLM, modelo y clave. */
export function LlmSettingsSection(): React.JSX.Element | null {
  const { settings, refresh } = useGeneration()
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const llm = settings?.llm
  if (!llm) return null

  const provider = (llm.provider === 'fake' ? 'anthropic' : llm.provider) as RealProvider
  const hasKey = provider === 'anthropic' ? llm.hasAnthropicKey : llm.hasOpenaiKey
  const field = 'rounded border border-line bg-bg px-2 py-1 text-sm text-white'

  const update = async (
    patch: Parameters<typeof window.vibe.settings.setLlm>[0]
  ): Promise<void> => {
    setMessage(null)
    await window.vibe.settings.setLlm(patch)
    await refresh()
  }

  const verify = async (): Promise<void> => {
    setBusy(true)
    setMessage(null)
    const res =
      provider === 'ollama'
        ? await window.vibe.settings.testOllama()
        : await window.vibe.settings.setLlmKey(provider, key)
    setBusy(false)
    if (res.ok) {
      setKey('')
      setMessage({
        ok: true,
        text:
          provider === 'ollama'
            ? `Ollama responde: ${res.info}.`
            : 'Clave válida. Guardada cifrada en este equipo.'
      })
    } else {
      setMessage({ ok: false, text: res.error })
    }
    await refresh()
  }

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">Productor (IA que conversa contigo)</h3>
      <p className="text-xs text-muted">
        Es el “cerebro” del chat: entiende lo que pides y decide qué generar y cómo mezclarlo.
      </p>

      <div className="grid grid-cols-2 gap-2 text-xs text-muted">
        <label className="flex flex-col gap-1">
          Proveedor
          <select
            value={provider}
            onChange={(e) => update({ provider: e.target.value as LlmProviderId })}
            className={field}
          >
            {Object.entries(LLM_PROVIDER_LABELS).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Modelo
          <input
            key={`${provider}-${llm.models[provider]}`}
            defaultValue={llm.models[provider]}
            onBlur={(e) => {
              const name = e.target.value.trim()
              if (name && name !== llm.models[provider]) void update({ model: { provider, name } })
              else e.target.value = llm.models[provider]
            }}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            className={field}
            spellCheck={false}
          />
        </label>
      </div>

      {provider === 'ollama' ? (
        <>
          <p className="text-xs text-muted">
            Modelos locales gratis con Ollama. Usa uno que soporte herramientas (p. ej. qwen3 o
            llama3.1) y descárgalo antes con{' '}
            <code className="text-white">ollama pull {llm.models.ollama}</code>.
          </p>
          <div className="flex gap-2">
            <input
              key={llm.ollamaUrl}
              defaultValue={llm.ollamaUrl}
              onBlur={(e) =>
                e.target.value.trim() !== llm.ollamaUrl &&
                void update({ ollamaUrl: e.target.value })
              }
              className={`${field} flex-1`}
              aria-label="URL de Ollama"
            />
            <button
              className="rounded bg-accent px-3 text-sm disabled:opacity-40"
              disabled={busy}
              onClick={verify}
            >
              {busy ? 'Probando…' : 'Probar'}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="text-xs">
            Estado:{' '}
            {hasKey ? (
              <span className="text-emerald-400">clave guardada ✓</span>
            ) : (
              <span className="text-amber-400">sin clave</span>
            )}{' '}
            ·{' '}
            <a
              href={KEY_LINKS[provider]}
              target="_blank"
              rel="noreferrer"
              className="text-accent underline"
            >
              conseguir una clave
            </a>
          </p>
          <div className="flex gap-2">
            <input
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={
                hasKey ? 'Pegar una clave nueva…' : provider === 'anthropic' ? 'sk-ant-…' : 'sk-…'
              }
              className={`${field} flex-1`}
              autoComplete="off"
              spellCheck={false}
              aria-label={`API key de ${LLM_PROVIDER_LABELS[provider]}`}
            />
            <button
              className="rounded bg-accent px-3 text-sm disabled:opacity-40"
              disabled={busy || key.trim().length < 8}
              onClick={verify}
            >
              {busy ? 'Comprobando…' : 'Guardar'}
            </button>
          </div>
          {hasKey && (
            <button
              className="text-xs text-muted underline hover:text-red-400"
              onClick={async () => {
                await window.vibe.settings.clearLlmKey(provider)
                setMessage({ ok: true, text: 'Clave borrada.' })
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
