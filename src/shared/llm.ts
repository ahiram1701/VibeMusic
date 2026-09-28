// Formato neutro de conversación con un LLM. Cada adaptador (Anthropic, OpenAI,
// Ollama…) traduce desde/hacia este formato, así el agente no depende del proveedor.

export type LlmProviderId = 'anthropic' | 'openai' | 'ollama' | 'fake'

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean }

export interface LlmMessage {
  role: 'user' | 'assistant'
  content: ContentBlock[]
  /**
   * Respuesta original del proveedor. Algunos (Anthropic) exigen devolver ciertos
   * bloques sin tocar en los turnos siguientes (p. ej. el "thinking" del modelo).
   * El adaptador la reutiliza si el proveedor y el modelo coinciden.
   */
  raw?: { provider: LlmProviderId; model: string; content: unknown }
}

/** JSON Schema de los parámetros de una herramienta (alias de tipo: así es compatible con los SDKs). */
export type JsonSchema = {
  type: 'object'
  properties: Record<string, unknown>
  required?: string[]
  additionalProperties?: boolean
}

export interface ToolDef {
  name: string
  description: string
  inputSchema: JsonSchema
}

export interface LlmRequest {
  system: string
  messages: LlmMessage[]
  tools: ToolDef[]
  maxTokens: number
}

export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' | 'other'

export interface LlmResponse {
  content: ContentBlock[]
  stopReason: StopReason
  raw?: LlmMessage['raw']
}

export interface LlmSettings {
  provider: LlmProviderId
  /** Modelo por proveedor (se recuerda al cambiar de uno a otro). */
  models: Record<Exclude<LlmProviderId, 'fake'>, string>
  ollamaUrl: string
  hasAnthropicKey: boolean
  hasOpenaiKey: boolean
}

export const LLM_PROVIDER_LABELS: Record<Exclude<LlmProviderId, 'fake'>, string> = {
  anthropic: 'Anthropic · Claude',
  openai: 'OpenAI',
  ollama: 'Ollama (local)'
}

export const textOf = (blocks: ContentBlock[]): string =>
  blocks
    .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('')
