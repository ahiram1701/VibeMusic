import type { Project, VersionMeta } from './project'

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
  | 'app:version'
