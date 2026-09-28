import type { Project, VersionMeta } from './project'

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
  | 'export:saveWav'
  | 'app:version'
