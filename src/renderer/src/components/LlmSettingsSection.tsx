import { useEffect, useState } from 'react'
import { findProvider, LLM_PROVIDERS, type LlmProviderPreset } from '@shared/llm-providers'
import { useGeneration } from '../store/generation'

type Status = { ok: boolean; text: string } | null

const GROUPS: LlmProviderPreset['group'][] = ['Nube', 'En tu equipo', 'Otro']

/** Ajustes del "cerebro" del productor: cualquier proveedor de LLM, su URL, clave y modelo. */
export function LlmSettingsSection(): React.JSX.Element | null {
  const { settings, refresh } = useGeneration()
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)
  const [fetched, setFetched] = useState<{ provider: string; list: string[] }>({
    provider: '',
    list: []
  })
  const llm = settings?.llm
  const preset = llm ? (findProvider(llm.provider) ?? LLM_PROVIDERS[0]) : null
  const hasKey = !!(preset && llm?.keys[preset.id])
  const canConnect = !!preset && (preset.needsKey !== true || hasKey)

  // Descarga la lista de modelos del proveedor cuando hay con qué conectarse.
  const providerId = preset?.id
  // Se incrementa para forzar una nueva descarga (p. ej. tras guardar una clave).
  const [reload, setReload] = useState(0)

  useEffect(() => {
    if (!providerId || !canConnect) return
    let current = true
    void window.vibe.llm.listModels(providerId).then((res) => {
      if (current) setFetched({ provider: providerId, list: res.ok ? res.models : [] })
    })
    return () => {
      current = false
    }
  }, [providerId, canConnect, reload])

  // Solo se muestran si son de este proveedor (al cambiar, la lista vieja no vale).
  const models = fetched.provider === providerId && canConnect ? fetched.list : []

  if (!llm || !preset) return null

  const field = 'rounded border border-line bg-bg px-2 py-1 text-sm text-white'
  const model = llm.models[preset.id] ?? ''

  const update = async (
    patch: Parameters<typeof window.vibe.settings.setLlm>[0]
  ): Promise<void> => {
    setStatus(null)
    try {
      await window.vibe.settings.setLlm(patch)
    } catch (err) {
      setStatus({ ok: false, text: (err as Error).message.replace(/^.*?Error: /, '') })
    }
    await refresh()
  }

  const saveKeyOrTest = async (): Promise<void> => {
    setBusy(true)
    setStatus(null)
    const res = key.trim()
      ? await window.vibe.settings.setLlmKey(preset.id, key)
      : await window.vibe.settings.testLlm(preset.id)
    setBusy(false)
    if (res.ok) {
      setKey('')
      setStatus({
        ok: true,
        text: `Conexión correcta: ${res.info}.${key.trim() ? ' Clave guardada cifrada.' : ''}`
      })
    } else {
      setStatus({ ok: false, text: res.error })
    }
    await refresh()
    setReload((n) => n + 1)
  }

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">Productor (IA que conversa contigo)</h3>
      <p className="text-xs text-muted">
        Es el “cerebro” del chat: entiende lo que pides y decide qué generar y cómo mezclarlo.
        Funciona con cualquier proveedor compatible.
      </p>

      <label className="flex flex-col gap-1 text-xs text-muted">
        Proveedor
        <select
          value={preset.id}
          onChange={(e) => {
            setKey('')
            void update({ provider: e.target.value })
          }}
          className={field}
          aria-label="Proveedor del productor"
        >
          {GROUPS.map((group) => (
            <optgroup key={group} label={group}>
              {LLM_PROVIDERS.filter((p) => p.group === group).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                  {llm.keys[p.id] ? ' ✓' : ''}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      {preset.hint && <p className="text-xs text-muted">{preset.hint}</p>}

      {preset.urlEditable && (
        <label className="flex flex-col gap-1 text-xs text-muted">
          URL base de la API
          <input
            key={`${preset.id}-${llm.urls[preset.id]}`}
            defaultValue={llm.urls[preset.id] ?? ''}
            placeholder="https://…/v1"
            onBlur={(e) => {
              if (e.target.value.trim() !== (llm.urls[preset.id] ?? '')) {
                void update({ url: { provider: preset.id, url: e.target.value } })
              }
            }}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            className={field}
            spellCheck={false}
            aria-label="URL base de la API"
          />
        </label>
      )}

      {preset.needsKey !== false && (
        <div className="space-y-1">
          <p className="text-xs text-muted">
            API key{preset.needsKey === 'optional' ? ' (opcional)' : ''}:{' '}
            {hasKey ? (
              <span className="text-emerald-400">guardada ✓</span>
            ) : (
              <span className={preset.needsKey === true ? 'text-amber-400' : ''}>sin clave</span>
            )}
            {preset.keyUrl && (
              <>
                {' · '}
                <a
                  href={preset.keyUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent underline"
                >
                  conseguir una clave
                </a>
              </>
            )}
          </p>
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={hasKey ? 'Pegar una clave nueva…' : 'Pega aquí tu API key'}
            className={`${field} w-full`}
            autoComplete="off"
            spellCheck={false}
            aria-label={`API key de ${preset.label}`}
          />
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          className="rounded bg-accent px-3 py-1 text-sm disabled:opacity-40"
          disabled={busy || (!key.trim() && !canConnect)}
          onClick={saveKeyOrTest}
        >
          {busy ? 'Comprobando…' : key.trim() ? 'Guardar y comprobar' : 'Probar conexión'}
        </button>
        {hasKey && (
          <button
            className="text-xs text-muted underline hover:text-red-400"
            onClick={async () => {
              await window.vibe.settings.clearLlmKey(preset.id)
              setStatus({ ok: true, text: 'Clave borrada.' })
              await refresh()
            }}
          >
            Borrar clave
          </button>
        )}
      </div>

      <label className="flex flex-col gap-1 text-xs text-muted">
        Modelo{' '}
        {models.length > 0 && <span>({models.length} disponibles: escribe para filtrar)</span>}
        <input
          key={`${preset.id}-${model}`}
          defaultValue={model}
          list="llm-models"
          placeholder={
            canConnect ? 'Elige o escribe un modelo' : 'Guarda antes la clave para ver los modelos'
          }
          onBlur={(e) => {
            const name = e.target.value.trim()
            if (name !== model) void update({ model: { provider: preset.id, name } })
          }}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          className={field}
          spellCheck={false}
          aria-label="Modelo del productor"
        />
        <datalist id="llm-models">
          {models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </label>
      {!model && (
        <p className="text-xs text-amber-400">Elige un modelo para poder usar el productor.</p>
      )}

      {status && (
        <p className={`text-xs ${status.ok ? 'text-emerald-400' : 'text-red-400'}`}>
          {status.text}
        </p>
      )}
    </section>
  )
}
