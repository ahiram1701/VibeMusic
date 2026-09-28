import type { LlmRequest, LlmResponse } from '@shared/llm'

/** Un proveedor de LLM concreto, ya configurado con su clave y modelo. */
export interface LlmAdapter {
  chat(req: LlmRequest, onText: (delta: string) => void, signal: AbortSignal): Promise<LlmResponse>
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly code: 'cancelled' | 'config' | 'api' = 'api'
  ) {
    super(message)
    this.name = 'LlmError'
  }
}
