import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { AppSettings, ProviderId } from '@shared/generation'
import type { LlmProviderId, LlmSettings } from '@shared/llm'

// Ajustes de la app en <userData>/settings.json.
// Los secretos (API keys) se guardan cifrados con el cifrado del sistema operativo
// (safeStorage de Electron → DPAPI en Windows) y nunca se envían al renderer.

export interface SecretCipher {
  isAvailable(): boolean
  encrypt(plain: string): Buffer
  decrypt(data: Buffer): string
}

export type SecretName = 'replicateToken' | 'anthropicKey' | 'openaiKey'
type LlmModels = LlmSettings['models']

interface SettingsFile {
  defaultProvider: ProviderId
  llmProvider: LlmProviderId
  llmModels: LlmModels
  ollamaUrl: string
  secrets: Partial<Record<SecretName, string>>
}

export interface LlmDefaults {
  models: LlmModels
  ollamaUrl: string
}

export class SettingsStore {
  private cache: SettingsFile | null = null
  private readonly defaults: SettingsFile

  constructor(
    private readonly file: string,
    private readonly cipher: SecretCipher,
    llmDefaults: LlmDefaults = {
      models: { anthropic: '', openai: '', ollama: '' },
      ollamaUrl: 'http://localhost:11434'
    }
  ) {
    this.defaults = {
      defaultProvider: 'demo',
      llmProvider: 'anthropic',
      llmModels: llmDefaults.models,
      ollamaUrl: llmDefaults.ollamaUrl,
      secrets: {}
    }
  }

  private async load(): Promise<SettingsFile> {
    if (this.cache) return this.cache
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8')) as Partial<SettingsFile>
      this.cache = {
        ...this.defaults,
        ...raw,
        llmModels: { ...this.defaults.llmModels, ...raw.llmModels },
        secrets: { ...raw.secrets }
      }
    } catch {
      this.cache = { ...this.defaults, secrets: {} }
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
      llm: {
        provider: s.llmProvider,
        models: s.llmModels,
        ollamaUrl: s.ollamaUrl,
        hasAnthropicKey: !!s.secrets.anthropicKey,
        hasOpenaiKey: !!s.secrets.openaiKey
      }
    }
  }

  async setDefaultProvider(id: ProviderId): Promise<void> {
    const s = await this.load()
    await this.save({ ...s, defaultProvider: id })
  }

  async setLlm(patch: {
    provider?: LlmProviderId
    model?: { provider: keyof LlmModels; name: string }
    ollamaUrl?: string
  }): Promise<void> {
    const s = await this.load()
    await this.save({
      ...s,
      llmProvider: patch.provider ?? s.llmProvider,
      llmModels: patch.model
        ? { ...s.llmModels, [patch.model.provider]: patch.model.name.trim() }
        : s.llmModels,
      ollamaUrl: patch.ollamaUrl?.trim() || s.ollamaUrl
    })
  }

  async llmConfig(): Promise<{ provider: LlmProviderId; models: LlmModels; ollamaUrl: string }> {
    const s = await this.load()
    return { provider: s.llmProvider, models: s.llmModels, ollamaUrl: s.ollamaUrl }
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
