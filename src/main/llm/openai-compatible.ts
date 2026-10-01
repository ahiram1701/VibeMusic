import type { ContentBlock, LlmMessage, LlmRequest, LlmResponse, StopReason } from '@shared/llm'
import { llmFetch } from './http'
import { LlmError, type LlmAdapter } from './types'

// Adaptador para cualquier API compatible con OpenAI Chat Completions: OpenAI, Groq,
// OpenRouter, Gemini, Mistral, DeepSeek, xAI, Ollama, LM Studio… Sin streaming: el
// texto llega de una vez al final de cada paso.

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
  const fetchImpl = opts.fetchImpl ?? llmFetch
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
      if (!res.ok) throw await httpError(res, opts.label, opts.model)
      const body = (await res.json()) as {
        choices: { message: ChatMessage; finish_reason: string }[]
      }
      const choice = body.choices[0]
      const content: ContentBlock[] = []
      const nativeCalls = choice.message.tool_calls ?? []
      let text = stripReasoning(choice.message.content ?? '')
      // Sin llamadas nativas, algunos modelos escriben las llamadas en el texto.
      const textCalls =
        nativeCalls.length === 0
          ? extractTextToolCalls(text, new Set(req.tools.map((t) => t.name)))
          : { calls: [], text }
      text = textCalls.text
      if (text) {
        content.push({ type: 'text', text })
        onText(text)
      }
      for (const call of nativeCalls) {
        let input: Record<string, unknown> = {}
        try {
          input = JSON.parse(call.function.arguments || '{}')
        } catch {
          // JSON inválido: la herramienta recibirá {} y devolverá un error explicativo.
        }
        content.push({ type: 'tool_use', id: call.id, name: call.function.name, input })
      }
      textCalls.calls.forEach((c, i) =>
        content.push({ type: 'tool_use', id: `text-call-${Date.now()}-${i}`, ...c })
      )
      const stopReason =
        nativeCalls.length + textCalls.calls.length > 0
          ? 'tool_use'
          : (STOP[choice.finish_reason] ?? 'other')
      return { content, stopReason }
    }
  }
}

/**
 * Algunos modelos de razonamiento (Qwen, DeepSeek R1…) devuelven su razonamiento
 * entre <think>…</think> dentro del texto: no es para el usuario.
 */
export function stripReasoning(text: string): string {
  return text.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').trim()
}

type TextCall = { name: string; input: Record<string, unknown> }

/**
 * Llama 3.x y otros modelos a veces escriben las llamadas a herramientas en el texto
 * en vez de usar `tool_calls`: `{"name": "x", "parameters": {...}}` o
 * `<function=x>{...}</function>`. Las rescata (solo herramientas conocidas) y las
 * quita del texto visible.
 */
export function extractTextToolCalls(
  text: string,
  toolNames: Set<string>
): { calls: TextCall[]; text: string } {
  const found: (TextCall & { at: number })[] = []
  const cut: [number, number][] = []
  const toInput = (v: unknown): Record<string, unknown> => {
    if (typeof v === 'string') {
      try {
        v = JSON.parse(v)
      } catch {
        return {}
      }
    }
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  }

  // <function=nombre>{...}</function>
  for (const m of text.matchAll(/<function=([\w-]+)>([\s\S]*?)<\/function>/g)) {
    if (!toolNames.has(m[1])) continue
    found.push({ at: m.index!, name: m[1], input: toInput(m[2].trim() || '{}') })
    cut.push([m.index!, m.index! + m[0].length])
  }

  // Objetos JSON de primer nivel con llaves balanceadas.
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{' || cut.some(([a, b]) => i >= a && i < b)) continue
    const end = matchingBrace(text, i)
    if (end < 0) continue
    let obj: unknown
    try {
      obj = JSON.parse(text.slice(i, end + 1))
    } catch {
      continue
    }
    const o = obj as { name?: unknown; parameters?: unknown; arguments?: unknown }
    if (typeof o?.name === 'string' && toolNames.has(o.name)) {
      found.push({ at: i, name: o.name, input: toInput(o.parameters ?? o.arguments ?? {}) })
      cut.push([i, end + 1])
    }
    i = end
  }

  if (found.length === 0) return { calls: [], text }
  const calls = found.sort((a, b) => a.at - b.at).map(({ name, input }) => ({ name, input }))
  let clean = ''
  let pos = 0
  for (const [a, b] of cut.sort((x, y) => x[0] - y[0])) {
    clean += text.slice(pos, a)
    pos = b
  }
  clean += text.slice(pos)
  clean = clean
    .replace(/```(?:json)?\s*```/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { calls, text: clean }
}

/** Índice de la llave que cierra la abierta en `start` (respeta strings), o -1. */
function matchingBrace(text: string, start: number): number {
  let depth = 0
  let inString = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (inString) {
      if (c === '\\') i++
      else if (c === '"') inString = false
    } else if (c === '"') inString = true
    else if (c === '{') depth++
    else if (c === '}' && --depth === 0) return i
  }
  return -1
}

/** Convierte una respuesta HTTP de error en un mensaje útil. */
export async function httpError(res: Response, label: string, model?: string): Promise<LlmError> {
  const raw = await res.text().catch(() => '')
  let detail = raw
  try {
    const body = JSON.parse(raw) as { error?: { message?: string } | string; message?: string }
    detail =
      (typeof body.error === 'string' ? body.error : body.error?.message) ?? body.message ?? raw
  } catch {
    // no era JSON
  }
  detail = detail.slice(0, 300)
  if (res.status === 401 || res.status === 403) {
    return new LlmError(`La API key de ${label} no es válida o no tiene permisos.`)
  }
  if (res.status === 404 && model) {
    return new LlmError(`El modelo "${model}" no existe en ${label}. Elige otro en Ajustes.`)
  }
  if (res.status === 429)
    return new LlmError(`Límite de uso de ${label} alcanzado. Espera un momento.`)
  if (res.status === 400 && /tool|function/i.test(detail)) {
    return new LlmError(
      `${label} rechazó las herramientas: el modelo "${model}" probablemente no soporta "tool calling". Prueba con otro modelo. (${detail})`
    )
  }
  return new LlmError(`${label} respondió ${res.status}: ${detail}`)
}

/** Lista los modelos del servidor (sirve también para comprobar la clave y la URL). */
export async function listOpenAiCompatibleModels(
  baseUrl: string,
  apiKey: string | undefined,
  label: string,
  fetchImpl: typeof fetch = fetch
): Promise<string[]> {
  let res: Response
  try {
    res = await fetchImpl(`${baseUrl}/models`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
    })
  } catch (err) {
    throw new LlmError(
      `No se pudo conectar con ${label} en ${baseUrl} (${(err as Error).message}).`
    )
  }
  if (!res.ok) throw await httpError(res, label)
  const body = (await res.json()) as {
    data?: { id: string }[]
    models?: { id?: string; name?: string }[]
  }
  const ids = (body.data ?? body.models ?? [])
    .map((m) => ('id' in m && m.id) || ('name' in m && m.name) || '')
    .filter(Boolean) as string[]
  return [...new Set(ids)].sort()
}
