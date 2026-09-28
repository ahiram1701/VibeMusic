import type { AppSettings, GenerationJob, ProviderId, ProviderInfo } from './generation'
import type { LlmProviderId, LlmRequest, LlmResponse } from './llm'
import type { GenerationSpec, Project, VersionMeta } from './project'

export type KeyCheck = { ok: true; info: string } | { ok: false; error: string }

export interface ImportedFile {
  clipId: string
  /** Ruta relativa a la carpeta del proyecto. */
  file: string
  name: string
}

// Contrato único entre renderer y main. Main registra un handler por clave
// y el preload expone exactamente estas funciones: si cambias una firma,
// TypeScript avisa en ambos lados.
export interface VibeApi {
  project: {
    create(name: string): Promise<{ dir: string; project: Project } | null>
    open(): Promise<{ dir: string; project: Project } | null>
    save(dir: string, project: Project, message: string): Promise<VersionMeta>
    listVersions(dir: string): Promise<VersionMeta[]>
    loadVersion(dir: string, versionId: number): Promise<Project>
  }
  clips: {
    import(dir: string): Promise<ImportedFile[]>
    read(dir: string, file: string): Promise<Uint8Array>
    write(dir: string, file: string, bytes: Uint8Array): Promise<void>
  }
  generation: {
    providers(): Promise<ProviderInfo[]>
    enqueue(dir: string, providerId: ProviderId, spec: GenerationSpec): Promise<GenerationJob>
    cancel(jobId: string): Promise<void>
    list(): Promise<GenerationJob[]>
    /** Se llama cada vez que un trabajo cambia. Devuelve la función para dejar de escuchar. */
    onUpdate(listener: (job: GenerationJob) => void): () => void
  }
  llm: {
    /** Envía una petición al LLM configurado. El texto llega en vivo por `onDelta`. */
    chat(requestId: string, req: LlmRequest): Promise<LlmResponse>
    cancel(requestId: string): Promise<void>
    onDelta(listener: (requestId: string, text: string) => void): () => void
  }
  settings: {
    get(): Promise<AppSettings>
    /** Comprueba el token con Replicate y, si es válido, lo guarda cifrado. */
    setReplicateToken(
      token: string
    ): Promise<{ ok: true; username: string } | { ok: false; error: string }>
    clearReplicateToken(): Promise<void>
    setDefaultProvider(id: ProviderId): Promise<void>
    setLlm(patch: {
      provider?: LlmProviderId
      model?: { provider: 'anthropic' | 'openai' | 'ollama'; name: string }
      ollamaUrl?: string
    }): Promise<void>
    /** Comprueba la clave con el proveedor y, si es válida, la guarda cifrada. */
    setLlmKey(provider: 'anthropic' | 'openai', key: string): Promise<KeyCheck>
    clearLlmKey(provider: 'anthropic' | 'openai'): Promise<void>
    testOllama(): Promise<KeyCheck>
  }
  export: {
    saveWav(bytes: Uint8Array, suggestedName: string): Promise<string | null>
  }
  app: {
    version(): Promise<string>
  }
}

export type IpcChannel =
  | 'project:create'
  | 'project:open'
  | 'project:save'
  | 'project:listVersions'
  | 'project:loadVersion'
  | 'clips:import'
  | 'clips:read'
  | 'clips:write'
  | 'generation:providers'
  | 'generation:enqueue'
  | 'generation:cancel'
  | 'generation:list'
  | 'settings:get'
  | 'settings:setReplicateToken'
  | 'settings:clearReplicateToken'
  | 'settings:setDefaultProvider'
  | 'settings:setLlm'
  | 'settings:setLlmKey'
  | 'settings:clearLlmKey'
  | 'settings:testOllama'
  | 'llm:chat'
  | 'llm:cancel'
  | 'export:saveWav'
  | 'app:version'

/** Eventos main → renderer. */
export const GENERATION_UPDATE_EVENT = 'generation:update'
export const LLM_DELTA_EVENT = 'llm:delta'
