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
    const onAbort = (): void => {
      clearTimeout(t)
      reject(new CancelledError())
    }
    // Se quita el listener al terminar: se sondea cada segundo durante horas.
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Tiempo máximo sin ningún avance de un trabajo del motor local. Generando, el progreso
 * cambia a cada paso; una descarga lenta del modelo es lo único que puede tardar tanto.
 */
export const STALL_LIMIT_MS = 45 * 60_000

/**
 * Vigila que un trabajo del motor local avance. Si se queda con la misma etapa y el
 * mismo progreso demasiado tiempo (el proceso de Python se colgó), `check` lanza un
 * error en vez de esperar para siempre. En cola no cuenta: espera a otro trabajo.
 */
export class StallWatch {
  private key = ''
  private since = 0

  constructor(
    private readonly limitMs = STALL_LIMIT_MS,
    private readonly now: () => number = Date.now
  ) {}

  check(status: string, progress: number | null, stage: string): void {
    const key = `${status}|${progress}|${stage}`
    if (status !== 'running' || key !== this.key) {
      this.key = key
      this.since = this.now()
      return
    }
    if (this.now() - this.since > this.limitMs) {
      throw new Error(
        `El motor local no avanza desde hace ${Math.round(this.limitMs / 60_000)} min (${stage}). Se canceló el trabajo; prueba a reiniciar el motor en Ajustes.`
      )
    }
  }
}
