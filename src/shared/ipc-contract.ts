import type { AppSettings, GenerationJob, ProviderId, ProviderInfo } from './generation'
import type { LlmProviderId, LlmRequest, LlmResponse } from './llm'
import type { LocalEngineStatus, TorchVariant } from './local-engine'
import type { StemResult } from './stems'
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
    /** Modelos que ofrece un proveedor (con su clave/URL guardadas). */
    listModels(
      provider: LlmProviderId
    ): Promise<{ ok: true; models: string[] } | { ok: false; error: string }>
    onDelta(listener: (requestId: string, text: string) => void): () => void
  }
  localEngine: {
    status(): Promise<LocalEngineStatus>
    /** Instala el motor local (Python + PyTorch + MusicGen). Tarda varios minutos. */
    install(variant: TorchVariant): Promise<{ ok: true } | { ok: false; error: string }>
    uninstall(): Promise<void>
    /** Añade la separación de pistas (Demucs) a una instalación existente. */
    installStems(): Promise<{ ok: true } | { ok: false; error: string }>
    start(): Promise<{ ok: true } | { ok: false; error: string }>
    stop(): Promise<void>
    onStatus(listener: (status: LocalEngineStatus) => void): () => void
    onLog(listener: (line: string) => void): () => void
  }
  stems: {
    /** Separa un clip del proyecto en pistas. El progreso llega por `onProgress`. */
    separate(requestId: string, dir: string, clipFile: string): Promise<StemResult[]>
    cancel(requestId: string): Promise<void>
    onProgress(
      listener: (requestId: string, progress: number | null, stage: string) => void
    ): () => void
  }
  settings: {
    get(): Promise<AppSettings>
    /** Comprueba el token con Replicate y, si es válido, lo guarda cifrado. */
    setReplicateToken(
      token: string
    ): Promise<{ ok: true; username: string } | { ok: false; error: string }>
    clearReplicateToken(): Promise<void>
    setDefaultProvider(id: ProviderId): Promise<void>
    setLocalModel(id: string): Promise<void>
    setLlm(patch: {
      provider?: LlmProviderId
      model?: { provider: LlmProviderId; name: string }
      url?: { provider: LlmProviderId; url: string }
    }): Promise<void>
    /** Comprueba la clave con el proveedor y, si es válida, la guarda cifrada. */
    setLlmKey(provider: LlmProviderId, key: string): Promise<KeyCheck>
    clearLlmKey(provider: LlmProviderId): Promise<void>
    /** Prueba la conexión con la configuración guardada del proveedor. */
    testLlm(provider: LlmProviderId): Promise<KeyCheck>
  }
  export: {
    /** Guarda un archivo donde elija el usuario. Devuelve la ruta o null si cancela. */
    saveFile(bytes: Uint8Array, suggestedName: string, ext: 'wav' | 'mp3'): Promise<string | null>
    /** Pide una carpeta (para varias pistas). Devuelve un token para escribir en ella. */
    chooseFolder(): Promise<{ token: string; path: string } | null>
    writeInFolder(token: string, fileName: string, bytes: Uint8Array): Promise<string>
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
  | 'settings:setLocalModel'
  | 'localEngine:status'
  | 'localEngine:install'
  | 'localEngine:uninstall'
  | 'localEngine:installStems'
  | 'stems:separate'
  | 'stems:cancel'
  | 'localEngine:start'
  | 'localEngine:stop'
  | 'settings:setLlm'
  | 'settings:setLlmKey'
  | 'settings:clearLlmKey'
  | 'settings:testLlm'
  | 'llm:listModels'
  | 'llm:chat'
  | 'llm:cancel'
  | 'export:saveFile'
  | 'export:chooseFolder'
  | 'export:writeInFolder'
  | 'app:version'

/** Eventos main → renderer. */
export const GENERATION_UPDATE_EVENT = 'generation:update'
export const LLM_DELTA_EVENT = 'llm:delta'
export const LOCAL_ENGINE_STATUS_EVENT = 'localEngine:status'
export const LOCAL_ENGINE_LOG_EVENT = 'localEngine:log'
export const STEMS_PROGRESS_EVENT = 'stems:progress'
