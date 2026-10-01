import type { ContentBlock, LlmRequest, LlmResponse } from '@shared/llm'
import { llmFetch } from './http'
import {
  extractTextToolCalls,
  httpError,
  stripReasoning,
  toChatMessages
} from './openai-compatible'
import { LlmError, type LlmAdapter } from './types'

// Adaptador para la API nativa de Ollama (/api/chat). La compatible con OpenAI (/v1)
// ignora el tamaño de contexto y Ollama usa 4096 tokens por defecto: las instrucciones
// y herramientas del productor ocupan ~3000, así que la conversación se recortaba y el
// modelo "olvidaba" cómo trabajar. La nativa acepta `num_ctx`.

/** Contexto pedido a Ollama: cabe holgado en 16 GB de RAM con modelos de hasta 8B. */
export const OLLAMA_NUM_CTX = 16384

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[]
  tool_name?: string
}

/** La URL guardada termina en /v1 (API compatible con OpenAI); la nativa cuelga de la raíz. */
export function ollamaRoot(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '')
}

/** Convierte la conversación al formato nativo: argumentos como objeto y resultados con el nombre de la herramienta. */
export function toOllamaMessages(req: LlmRequest): OllamaMessage[] {
  const names = new Map<string, string>()
  for (const m of req.messages) {
    for (const b of m.content) if (b.type === 'tool_use') names.set(b.id, b.name)
  }
  return toChatMessages(req.system, req.messages).map((m) => ({
    role: m.role,
    content: m.content ?? '',
    ...(m.tool_calls && {
      tool_calls: m.tool_calls.map((c) => ({
        function: { name: c.function.name, arguments: JSON.parse(c.function.arguments) }
      }))
    }),
    ...(m.tool_call_id && { tool_name: names.get(m.tool_call_id) ?? '' })
  }))
}

export function createOllamaAdapter(opts: {
  baseUrl: string
  model: string
  fetchImpl?: typeof fetch
}): LlmAdapter {
  const fetchImpl = opts.fetchImpl ?? llmFetch
  const root = ollamaRoot(opts.baseUrl)
  return {
    async chat(req: LlmRequest, onText, signal): Promise<LlmResponse> {
      let res: Response
      try {
        res = await fetchImpl(`${root}/api/chat`, {
          method: 'POST',
          signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: opts.model,
            messages: toOllamaMessages(req),
            tools: req.tools.map((t) => ({
              type: 'function',
              function: { name: t.name, description: t.description, parameters: t.inputSchema }
            })),
            stream: false,
            // Sin "think": los modelos que razonan lo devuelven aparte (message.thinking)
            // y no llega al chat. Con think:false, qwen3 razona igual pero dentro del texto.
            options: { num_ctx: OLLAMA_NUM_CTX, num_predict: req.maxTokens }
          })
        })
      } catch (err) {
        if (signal.aborted) throw new LlmError('Cancelado', 'cancelled')
        throw new LlmError(`No se pudo conectar con Ollama (${(err as Error).message}).`)
      }
      if (!res.ok) throw await httpError(res, 'Ollama', opts.model)
      const body = (await res.json()) as { message: OllamaMessage; done_reason?: string }
      const nativeCalls = body.message.tool_calls ?? []
      let text = stripReasoning(body.message.content ?? '')
      const textCalls =
        nativeCalls.length === 0
          ? extractTextToolCalls(text, new Set(req.tools.map((t) => t.name)))
          : { calls: [], text }
      text = textCalls.text

      const content: ContentBlock[] = []
      if (text) {
        content.push({ type: 'text', text })
        onText(text)
      }
      const calls = [
        ...nativeCalls.map(({ function: f }) => ({
          name: f.name,
          input: (typeof f.arguments === 'string' ? safeParse(f.arguments) : f.arguments) ?? {}
        })),
        ...textCalls.calls
      ]
      const stamp = Date.now()
      calls.forEach((c, i) => content.push({ type: 'tool_use', id: `ollama-${stamp}-${i}`, ...c }))
      return {
        content,
        stopReason:
          calls.length > 0 ? 'tool_use' : body.done_reason === 'length' ? 'max_tokens' : 'end_turn'
      }
    }
  }
}

function safeParse(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s)
  } catch {
    return {}
  }
}
