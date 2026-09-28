import type { ProviderCapabilities, ProviderId } from '@shared/generation'
import type { GenerationSpec } from '@shared/project'

export interface GenerateContext {
  signal: AbortSignal
  /** progress 0..1 o null si no se sabe; stage es un texto corto para la UI. */
  onProgress(progress: number | null, stage: string): void
  /** Ruta absoluta sin extensión donde escribir el audio. El proveedor añade la extensión. */
  outBase: string
  /** Ruta absoluta del WAV de partida cuando se continúa un clip (spec.conditioning). */
  conditioningPath?: string
}

export interface GenerateResult {
  /** Ruta absoluta del archivo de audio escrito. */
  path: string
  /** Segundos del principio que no son audio nuevo (el fragmento de partida). */
  trimStartSec?: number
}

/**
 * Un motor de generación de audio. Todos (demo, nube, local) cumplen esta interfaz,
 * así la cola, la UI y el agente no necesitan saber cuál se está usando.
 */
export interface AudioProvider {
  id: ProviderId
  label: string
  description: string
  capabilities: ProviderCapabilities
  status(): Promise<{ ready: boolean; reason?: string }>
  /** Genera el audio y lo escribe en disco. */
  generate(spec: GenerationSpec, ctx: GenerateContext): Promise<GenerateResult>
}

export class CancelledError extends Error {
  constructor() {
    super('Cancelado')
    this.name = 'CancelledError'
  }
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new CancelledError()
}

/** Espera `ms` o se interrumpe si se cancela. */
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new CancelledError())
    const t = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        reject(new CancelledError())
      },
      { once: true }
    )
  })
}
