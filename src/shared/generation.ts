import type { LlmSettings } from './llm'
import type { GenerationSpec } from './project'

// Tipos compartidos del sistema de generación de audio (main ↔ renderer).

export type ProviderId = 'demo' | 'replicate' | 'local' | 'huggingface'

/**
 * Quién canta: 'cloud' = ACE-Step en Hugging Face (canción completa, pocas al día);
 * 'local' = cantante DiffSinger en este equipo (pista de voz sobre el instrumental, sin
 * límite); 'auto' = el local si está instalado y, si no, la nube.
 */
export type SingingEngine = 'auto' | 'cloud' | 'local'

export interface ProviderCapabilities {
  maxDurationSec: number
  supportsSeed: boolean
  supportsContinue: boolean
  supportsMelody: boolean
  /** Canta letra: genera la canción completa con voz a partir de `lyrics`. */
  supportsLyrics: boolean
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
  /**
   * Segundos a descartar al principio del audio en bruto (algunos modelos devuelven
   * el fragmento de partida seguido de la continuación).
   */
  trimStartSec?: number
  createdAt: number
}

export interface AppSettings {
  defaultProvider: ProviderId
  /** Solo indica si hay token guardado; el token nunca sale del proceso principal. */
  hasReplicateToken: boolean
  /** Hay token de Hugging Face guardado (más cuota gratuita para cantar). */
  hasHfToken: boolean
  /** Quién canta las canciones con letra (ver SingingEngine). */
  singingEngine: SingingEngine
  /** Modelo del motor local (ver LOCAL_MODELS). */
  localModel: string
  /** Internet para el productor: si puede buscar y si hay clave de Ollama (más estable). */
  web: { enabled: boolean; hasOllamaKey: boolean }
  llm: LlmSettings
}
