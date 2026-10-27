import { useState } from 'react'
import { AudioLines, Bot, Mic, RefreshCw, type LucideIcon } from 'lucide-react'
import type { ProviderId } from '@shared/generation'
import { useGeneration } from '../store/generation'
import { useLayout, type SettingsTab } from '../store/layout'
import { LlmSettingsSection } from './LlmSettingsSection'
import { WebAccessSection } from './WebAccessSection'
import { LocalEngineSection } from './LocalEngineSection'
import { MyVoiceSection } from './MyVoiceSection'
import { SingerSection } from './SingerSection'
import { UpdatesSection } from './UpdatesSection'
import { VocalsSection } from './VocalsSection'
import { Button, fieldClass, Modal } from './ui'

// Ajustes en pestañas: cada una agrupa lo que se configura junto. Las secciones son
// las mismas de siempre; aquí solo se reparten.

const TABS: { id: SettingsTab; label: string; icon: LucideIcon; hint: string }[] = [
  { id: 'llm', label: 'Productor (IA)', icon: Bot, hint: 'El modelo que compone y conversa' },
  { id: 'audio', label: 'Motores de audio', icon: AudioLines, hint: 'Con qué se genera la música' },
  { id: 'voices', label: 'Voces', icon: Mic, hint: 'Quién canta y tu propia voz' },
  { id: 'updates', label: 'Actualizaciones', icon: RefreshCw, hint: 'Versión y novedades' }
]

export function SettingsDialog({
  tab: initial,
  onClose
}: {
  tab: SettingsTab
  onClose(): void
}): React.JSX.Element {
  const [tab, setTab] = useState(initial)
  const choose = (t: SettingsTab): void => {
    setTab(t)
    useLayout.getState().rememberSettingsTab(t)
  }

  return (
    <Modal title="Ajustes" onClose={onClose} width={820}>
      <div className="flex min-h-[480px]">
        <nav
          className="w-48 shrink-0 space-y-0.5 border-r border-line p-2"
          role="tablist"
          aria-orientation="vertical"
          aria-label="Secciones de ajustes"
        >
          {TABS.map(({ id, label, icon: Icon, hint }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              title={hint}
              onClick={() => choose(id)}
              className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors ${
                tab === id ? 'bg-accent/15 text-text' : 'text-muted hover:bg-line hover:text-text'
              }`}
            >
              <Icon size={16} aria-hidden className={tab === id ? 'text-accent' : ''} />
              {label}
            </button>
          ))}
        </nav>
        <div className="min-w-0 flex-1 space-y-8 p-5" role="tabpanel">
          {tab === 'llm' && (
            <>
              <LlmSettingsSection />
              <WebAccessSection />
            </>
          )}
          {tab === 'audio' && (
            <>
              <DefaultEngineSection />
              <ReplicateSection />
              <LocalEngineSection />
            </>
          )}
          {tab === 'voices' && (
            <>
              <SingerSection />
              <VocalsSection />
              <MyVoiceSection />
            </>
          )}
          {tab === 'updates' && <UpdatesSection />}
        </div>
      </div>
    </Modal>
  )
}

/** Con qué motor se generan los clips y las capas (el productor y "Generar manual"). */
function DefaultEngineSection(): React.JSX.Element {
  const { settings, providers, refresh } = useGeneration()
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">Motor de audio por defecto</h3>
      <select
        value={settings?.defaultProvider ?? 'demo'}
        aria-label="Motor de audio por defecto"
        onChange={async (e) => {
          await window.vibe.settings.setDefaultProvider(e.target.value as ProviderId)
          await refresh()
        }}
        className={`${fieldClass} w-full`}
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
  )
}

/** MusicGen en Replicate: token de pago por uso. */
function ReplicateSection(): React.JSX.Element {
  const { settings, refresh } = useGeneration()
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

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">Motor de audio: Replicate (IA en la nube)</h3>
      <p className="text-xs text-muted">
        Genera música con MusicGen de Meta. Se paga por uso en tu cuenta de Replicate (unos céntimos
        por clip). Consigue tu token en{' '}
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
          <span className="text-ok">token guardado ✓</span>
        ) : (
          <span className="text-warn">sin token</span>
        )}
      </p>
      <div className="flex gap-2">
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={settings?.hasReplicateToken ? 'Pegar un token nuevo…' : 'r8_…'}
          aria-label="Token de Replicate"
          className={`${fieldClass} flex-1`}
          autoComplete="off"
          spellCheck={false}
        />
        <Button variant="primary" disabled={busy || token.trim().length < 8} onClick={saveToken}>
          {busy ? 'Comprobando…' : 'Guardar'}
        </Button>
      </div>
      {settings?.hasReplicateToken && (
        <button
          type="button"
          className="text-xs text-muted underline hover:text-danger"
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
        <p className={`text-xs ${message.ok ? 'text-ok' : 'text-danger'}`}>{message.text}</p>
      )}
    </section>
  )
}
