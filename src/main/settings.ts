import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { AppSettings, ProviderId } from '@shared/generation'
import type { LlmProviderId } from '@shared/llm'
import { findProvider, LLM_PROVIDERS } from '@shared/llm-providers'
import { DEFAULT_LOCAL_MODEL, LOCAL_MODELS } from '@shared/local-engine'

// Ajustes de la app en <userData>/settings.json.
// Los secretos (API keys) se guardan cifrados con el cifrado del sistema operativo
// (safeStorage de Electron → DPAPI en Windows) y nunca se envían al renderer.

export interface SecretCipher {
  isAvailable(): boolean
  encrypt(plain: string): Buffer
  decrypt(data: Buffer): string
}

/** 'replicateToken' o `llm:<id del proveedor>`. */
export type SecretName = 'replicateToken' | `llm:${string}`

export const llmSecret = (providerId: string): SecretName => `llm:${providerId}`

interface SettingsFile {
  defaultProvider: ProviderId
  localModel: string
  llmProvider: LlmProviderId
  llmModels: Record<string, string>
  llmUrls: Record<string, string>
  secrets: Record<string, string>
}

/** Formato antiguo (antes de admitir cualquier proveedor), para migrarlo. */
interface LegacyFields {
  ollamaUrl?: string
  secrets?: { anthropicKey?: string; openaiKey?: string }
}

export interface LlmConfig {
  provider: LlmProviderId
  model: string
  /** URL base efectiva (la del usuario o la del catálogo). */
  baseUrl: string
}

export class SettingsStore {
  private cache: SettingsFile | null = null

  constructor(
    private readonly file: string,
    private readonly cipher: SecretCipher
  ) {}

  private defaults(): SettingsFile {
    return {
      defaultProvider: 'demo',
      localModel: DEFAULT_LOCAL_MODEL,
      llmProvider: 'anthropic',
      llmModels: Object.fromEntries(LLM_PROVIDERS.map((p) => [p.id, p.defaultModel])),
      llmUrls: {},
      secrets: {}
    }
  }

  private async load(): Promise<SettingsFile> {
    if (this.cache) return this.cache
    const d = this.defaults()
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8')) as Partial<SettingsFile> &
        LegacyFields
      const secrets: Record<string, string> = { ...raw.secrets } as Record<string, string>
      // Migración: claves y URL guardadas con el formato anterior.
      const legacy = raw.secrets ?? {}
      if (legacy.anthropicKey && !secrets['llm:anthropic'])
        secrets['llm:anthropic'] = legacy.anthropicKey
      if (legacy.openaiKey && !secrets['llm:openai']) secrets['llm:openai'] = legacy.openaiKey
      delete secrets.anthropicKey
      delete secrets.openaiKey
      const urls = { ...raw.llmUrls }
      if (raw.ollamaUrl && !urls.ollama) urls.ollama = `${raw.ollamaUrl.replace(/\/$/, '')}/v1`

      this.cache = {
        defaultProvider: raw.defaultProvider ?? d.defaultProvider,
        localModel: raw.localModel ?? d.localModel,
        llmProvider: raw.llmProvider ?? d.llmProvider,
        // Modelos vacíos se rellenan con los del catálogo.
        llmModels: {
          ...d.llmModels,
          ...Object.fromEntries(Object.entries(raw.llmModels ?? {}).filter(([, m]) => m))
        },
        llmUrls: urls,
        secrets
      }
    } catch {
      this.cache = d
    }
    return this.cache
  }

  private async save(next: SettingsFile): Promise<void> {
    this.cache = next
    await mkdir(dirname(this.file), { recursive: true })
    await writeFile(this.file, JSON.stringify(next, null, 2))
  }

  async publicSettings(): Promise<AppSettings> {
    const s = await this.load()
    return {
      defaultProvider: s.defaultProvider,
      hasReplicateToken: !!s.secrets.replicateToken,
      localModel: s.localModel,
      llm: {
        provider: s.llmProvider,
        models: s.llmModels,
        urls: Object.fromEntries(
          LLM_PROVIDERS.filter((p) => p.urlEditable).map((p) => [
            p.id,
            s.llmUrls[p.id] ?? p.baseUrl
          ])
        ),
        keys: Object.fromEntries(LLM_PROVIDERS.map((p) => [p.id, !!s.secrets[llmSecret(p.id)]]))
      }
    }
  }

  async setDefaultProvider(id: ProviderId): Promise<void> {
    const s = await this.load()
    await this.save({ ...s, defaultProvider: id })
  }

  async setLocalModel(id: string): Promise<void> {
    if (!LOCAL_MODELS.some((m) => m.id === id)) throw new Error(`Modelo local desconocido: ${id}`)
    const s = await this.load()
    await this.save({ ...s, localModel: id })
  }

  async getLocalModel(): Promise<string> {
    return (await this.load()).localModel
  }

  async setLlm(patch: {
    provider?: LlmProviderId
    model?: { provider: LlmProviderId; name: string }
    url?: { provider: LlmProviderId; url: string }
  }): Promise<void> {
    const s = await this.load()
    if (patch.provider && !findProvider(patch.provider)) {
      throw new Error(`Proveedor desconocido: ${patch.provider}`)
    }
    const llmUrls = { ...s.llmUrls }
    if (patch.url) {
      const url = patch.url.url.trim().replace(/\/+$/, '')
      if (url && !/^https?:\/\//i.test(url))
        throw new Error('La URL debe empezar por http:// o https://')
      if (url) llmUrls[patch.url.provider] = url
      else delete llmUrls[patch.url.provider]
    }
    await this.save({
      ...s,
      llmProvider: patch.provider ?? s.llmProvider,
      llmModels: patch.model
        ? { ...s.llmModels, [patch.model.provider]: patch.model.name.trim() }
        : s.llmModels,
      llmUrls
    })
  }

  /** Configuración efectiva de un proveedor (por defecto, el activo). */
  async llmConfig(providerId?: LlmProviderId): Promise<LlmConfig> {
    const s = await this.load()
    const provider = providerId ?? s.llmProvider
    const preset = findProvider(provider)
    return {
      provider,
      model: s.llmModels[provider] ?? preset?.defaultModel ?? '',
      baseUrl: s.llmUrls[provider] ?? preset?.baseUrl ?? ''
    }
  }

  async getSecret(name: SecretName): Promise<string | null> {
    const enc = (await this.load()).secrets[name]
    if (!enc) return null
    try {
      return this.cipher.decrypt(Buffer.from(enc, 'base64'))
    } catch {
      return null // cifrado de otro usuario/equipo: hay que volver a introducirlo
    }
  }

  async setSecret(name: SecretName, value: string | null): Promise<void> {
    const s = await this.load()
    const secrets = { ...s.secrets }
    if (value) {
      if (!this.cipher.isAvailable()) throw new Error('El cifrado del sistema no está disponible')
      secrets[name] = this.cipher.encrypt(value).toString('base64')
    } else {
      delete secrets[name]
    }
    await this.save({ ...s, secrets })
  }

  getReplicateToken(): Promise<string | null> {
    return this.getSecret('replicateToken')
  }

  setReplicateToken(token: string | null): Promise<void> {
    return this.setSecret('replicateToken', token)
  }
}
