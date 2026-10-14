import type { LlmRetry } from '@shared/llm'
import { LlmError } from './types'

/**
 * Esperas entre reintentos ante fallos de red (~15 min en total). Pensado para un
 * Ollama en otro equipo: un corte de wifi o un reinicio del servicio no debe tirar
 * un trabajo de horas del productor.
 */
export const RETRY_DELAYS_MS = [15_000, 30_000, 60_000, 120_000, 240_000, 480_000]

/** Ejecuta `fn` y, si falla por la red, lo reintenta con esperas crecientes. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  signal: AbortSignal,
  onRetry: (info: LlmRetry) => void,
  delays: number[] = RETRY_DELAYS_MS
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (!(err instanceof LlmError) || err.code !== 'network' || signal.aborted) throw err
      if (attempt >= delays.length) {
        throw new LlmError(`${err.message} Se reintentó ${attempt} veces sin éxito.`, 'network')
      }
      const waitMs = delays[attempt]
      onRetry({ attempt: attempt + 1, maxAttempts: delays.length, waitMs, reason: err.message })
      await sleep(waitMs, signal)
    }
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new LlmError('Cancelado', 'cancelled'))
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new LlmError('Cancelado', 'cancelled'))
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
