import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { AppSettings, ProviderId } from '@shared/generation'

// Ajustes de la app en <userData>/settings.json.
// Los secretos (API keys) se guardan cifrados con el cifrado del sistema operativo
// (safeStorage de Electron → DPAPI en Windows) y nunca se envían al renderer.

export interface SecretCipher {
  isAvailable(): boolean
  encrypt(plain: string): Buffer
  decrypt(data: Buffer): string
}

interface SettingsFile {
  defaultProvider: ProviderId
  secrets: { replicateToken?: string }
}

const DEFAULTS: SettingsFile = { defaultProvider: 'demo', secrets: {} }

export class SettingsStore {
  private cache: SettingsFile | null = null

  constructor(
    private readonly file: string,
    private readonly cipher: SecretCipher
  ) {}

  private async load(): Promise<SettingsFile> {
    if (this.cache) return this.cache
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8')) as Partial<SettingsFile>
      this.cache = { ...DEFAULTS, ...raw, secrets: { ...raw.secrets } }
    } catch {
      this.cache = { ...DEFAULTS, secrets: {} }
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
    return { defaultProvider: s.defaultProvider, hasReplicateToken: !!s.secrets.replicateToken }
  }

  async setDefaultProvider(id: ProviderId): Promise<void> {
    const s = await this.load()
    await this.save({ ...s, defaultProvider: id })
  }

  async getReplicateToken(): Promise<string | null> {
    const enc = (await this.load()).secrets.replicateToken
    if (!enc) return null
    try {
      return this.cipher.decrypt(Buffer.from(enc, 'base64'))
    } catch {
      return null // cifrado de otro usuario/equipo: hay que volver a introducirlo
    }
  }

  async setReplicateToken(token: string | null): Promise<void> {
    const s = await this.load()
    const secrets = { ...s.secrets }
    if (token) {
      if (!this.cipher.isAvailable()) throw new Error('El cifrado del sistema no está disponible')
      secrets.replicateToken = this.cipher.encrypt(token).toString('base64')
    } else {
      delete secrets.replicateToken
    }
    await this.save({ ...s, secrets })
  }
}
