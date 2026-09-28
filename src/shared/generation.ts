import type { LlmSettings } from './llm'
import type { GenerationSpec } from './project'

// Tipos compartidos del sistema de generación de audio (main ↔ renderer).

export type ProviderId = 'demo' | 'replicate'

export interface ProviderCapabilities {
  maxDurationSec: number
  supportsSeed: boolean
  supportsContinue: boolean
  supportsMelody: boolean
}

export interface ProviderInfo {
  id: ProviderId
  label: string
  description: string
  capabilities: ProviderCapabilities
  /** false si falta configuración (p. ej. la API key). */
  ready: boolean
  /** Motivo por el que no está listo, para mostrarlo en la UI. */
  notReadyReason?: string
}

export type JobStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled'

export interface GenerationJob {
  id: string
  providerId: ProviderId
  spec: GenerationSpec
  /** Carpeta del proyecto donde se guarda el resultado. */
  dir: string
  status: JobStatus
  /** 0..1, o null si el proveedor no informa progreso. */
  progress: number | null
  /** Texto corto de estado: "En cola", "Arrancando el modelo…", etc. */
  stage: string
  error?: string
  /** Ruta relativa (en el proyecto) del audio en bruto devuelto por el proveedor. */
  rawFile?: string
  createdAt: number
}

export interface AppSettings {
  defaultProvider: ProviderId
  /** Solo indica si hay token guardado; el token nunca sale del proceso principal. */
  hasReplicateToken: boolean
  llm: LlmSettings
}
