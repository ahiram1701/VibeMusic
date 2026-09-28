import type { ContentBlock, LlmMessage, LlmRequest, LlmResponse, StopReason } from '@shared/llm'
import { LlmError, type LlmAdapter } from './types'

// Adaptador para APIs compatibles con OpenAI Chat Completions: la de OpenAI y la
// que expone Ollama en /v1 (modelos locales). Sin streaming: el texto llega de una vez.

export const DEFAULT_OPENAI_MODEL = 'gpt-5'
export const DEFAULT_OLLAMA_MODEL = 'qwen3'

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
  tool_call_id?: string
}

export function toChatMessages(system: string, messages: LlmMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [{ role: 'system', content: system }]
  for (const m of messages) {
    const text = m.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { text: string }).text)
      .join('')
    if (m.role === 'assistant') {
      const calls = m.content.filter((b) => b.type === 'tool_use')
      out.push({
        role: 'assistant',
        content: text || null,
        ...(calls.length > 0 && {
          tool_calls: calls.map((c) => ({
            id: c.id,
            type: 'function' as const,
            function: { name: c.name, arguments: JSON.stringify(c.input) }
          }))
        })
      })
    } else {
      // Cada resultado de herramienta es un mensaje "tool" independiente.
      for (const b of m.content) {
        if (b.type === 'tool_result') {
          out.push({
            role: 'tool',
            tool_call_id: b.toolUseId,
            content: b.isError ? `ERROR: ${b.content}` : b.content
          })
        }
      }
      if (text) out.push({ role: 'user', content: text })
    }
  }
  return out
}

const STOP: Record<string, StopReason> = {
  stop: 'end_turn',
  tool_calls: 'tool_use',
  length: 'max_tokens',
  content_filter: 'refusal'
}

export function createOpenAiCompatibleAdapter(opts: {
  baseUrl: string
  apiKey?: string
  model: string
  label: string
  /** OpenAI usa max_completion_tokens; Ollama, max_tokens. */
  tokensParam: 'max_completion_tokens' | 'max_tokens'
  fetchImpl?: typeof fetch
}): LlmAdapter {
  const fetchImpl = opts.fetchImpl ?? fetch
  return {
    async chat(req: LlmRequest, onText, signal): Promise<LlmResponse> {
      let res: Response
      try {
        res = await fetchImpl(`${opts.baseUrl}/chat/completions`, {
          method: 'POST',
          signal,
          headers: {
            'Content-Type': 'application/json',
            ...(opts.apiKey && { Authorization: `Bearer ${opts.apiKey}` })
          },
          body: JSON.stringify({
            model: opts.model,
            messages: toChatMessages(req.system, req.messages),
            tools: req.tools.map((t) => ({
              type: 'function',
              function: { name: t.name, description: t.description, parameters: t.inputSchema }
            })),
            [opts.tokensParam]: req.maxTokens
          })
        })
      } catch (err) {
        if (signal.aborted) throw new LlmError('Cancelado', 'cancelled')
        throw new LlmError(`No se pudo conectar con ${opts.label} (${(err as Error).message}).`)
      }
      if (!res.ok) {
        const detail = await res.text().catch(() => '')
        if (res.status === 401) throw new LlmError(`La API key de ${opts.label} no es válida.`)
        if (res.status === 404)
          throw new LlmError(`El modelo "${opts.model}" no existe en ${opts.label}.`)
        if (res.status === 429) throw new LlmError(`Límite de uso de ${opts.label} alcanzado.`)
        throw new LlmError(`${opts.label} respondió ${res.status}: ${detail.slice(0, 300)}`)
      }

      const body = (await res.json()) as {
        choices: { message: ChatMessage; finish_reason: string }[]
      }
      const choice = body.choices[0]
      const content: ContentBlock[] = []
      if (choice.message.content) {
        content.push({ type: 'text', text: choice.message.content })
        onText(choice.message.content)
      }
      for (const call of choice.message.tool_calls ?? []) {
        let input: Record<string, unknown> = {}
        try {
          input = JSON.parse(call.function.arguments || '{}')
        } catch {
          // JSON inválido: la herramienta recibirá {} y devolverá un error explicativo.
        }
        content.push({ type: 'tool_use', id: call.id, name: call.function.name, input })
      }
      const stopReason =
        (choice.message.tool_calls?.length ?? 0) > 0
          ? 'tool_use'
          : (STOP[choice.finish_reason] ?? 'other')
      return { content, stopReason }
    }
  }
}

export async function verifyOpenAiCompatible(baseUrl: string, apiKey?: string): Promise<string> {
  const res = await fetch(`${baseUrl}/models`, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
  }).catch((err: Error) => {
    throw new LlmError(`No se pudo conectar (${err.message}).`)
  })
  if (res.status === 401) throw new LlmError('La API key no es válida.')
  if (!res.ok) throw new LlmError(`El servidor respondió ${res.status}.`)
  const body = (await res.json()) as { data?: unknown[] }
  return `${body.data?.length ?? 0} modelos disponibles`
}
