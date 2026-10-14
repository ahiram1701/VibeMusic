import type { LlmRequest, LlmResponse } from '@shared/llm'

/** Un proveedor de LLM concreto, ya configurado con su clave y modelo. */
export interface LlmAdapter {
  chat(req: LlmRequest, onText: (delta: string) => void, signal: AbortSignal): Promise<LlmResponse>
}

export class LlmError extends Error {
  constructor(
    message: string,
    /** `network`: fallo pasajero (conexión caída, servidor reiniciando); vale la pena reintentar. */
    readonly code: 'cancelled' | 'config' | 'api' | 'network' = 'api'
  ) {
    super(message)
    this.name = 'LlmError'
  }
}
