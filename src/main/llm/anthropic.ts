import Anthropic from '@anthropic-ai/sdk'
import type { ContentBlock, LlmMessage, LlmRequest, LlmResponse, StopReason } from '@shared/llm'
import { LlmError, type LlmAdapter } from './types'

export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5'

type BetaMessageParam = Anthropic.Beta.Messages.BetaMessageParam
type BetaContentBlockParam = Anthropic.Beta.Messages.BetaContentBlockParam

/** Convierte la conversación neutra al formato de la API de Anthropic. */
export function toAnthropicMessages(messages: LlmMessage[], model: string): BetaMessageParam[] {
  return messages.map((m): BetaMessageParam => {
    // La respuesta original se devuelve tal cual (conserva los bloques de "thinking"
    // y de fallback, que la API exige sin modificar) si viene del mismo modelo.
    if (m.role === 'assistant' && m.raw?.provider === 'anthropic' && m.raw.model === model) {
      return { role: 'assistant', content: m.raw.content as BetaContentBlockParam[] }
    }
    return {
      role: m.role,
      content: m.content.map((b): BetaContentBlockParam => {
        switch (b.type) {
          case 'text':
            return { type: 'text', text: b.text }
          case 'tool_use':
            return { type: 'tool_use', id: b.id, name: b.name, input: b.input }
          case 'tool_result':
            return {
              type: 'tool_result',
              tool_use_id: b.toolUseId,
              content: b.content,
              is_error: b.isError ?? false
            }
        }
      })
    }
  })
}

export function fromAnthropicContent(
  content: Anthropic.Beta.Messages.BetaContentBlock[]
): ContentBlock[] {
  const out: ContentBlock[] = []
  for (const b of content) {
    if (b.type === 'text') out.push({ type: 'text', text: b.text })
    else if (b.type === 'tool_use') {
      out.push({
        type: 'tool_use',
        id: b.id,
        name: b.name,
        input: (b.input ?? {}) as Record<string, unknown>
      })
    }
    // thinking, fallback, etc. solo viajan en `raw`
  }
  return out
}

function mapStop(reason: string | null): StopReason {
  switch (reason) {
    case 'end_turn':
    case 'tool_use':
    case 'max_tokens':
    case 'refusal':
      return reason
    default:
      return 'other'
  }
}

/** Traduce los errores tipados del SDK a mensajes útiles para el usuario. */
function explain(err: unknown, model: string): Error {
  if (err instanceof Anthropic.APIUserAbortError) return new LlmError('Cancelado', 'cancelled')
  if (err instanceof Anthropic.AuthenticationError) {
    return new LlmError('La API key de Anthropic no es válida. Revísala en Ajustes.')
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return new LlmError('Tu API key de Anthropic no tiene permiso para este modelo.')
  }
  if (err instanceof Anthropic.NotFoundError) {
    return new LlmError(`El modelo "${model}" no existe o no está disponible en tu cuenta.`)
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new LlmError('Límite de uso de Anthropic alcanzado. Espera un momento y reinténtalo.')
  }
  if (err instanceof Anthropic.BadRequestError) {
    return new LlmError(`Anthropic rechazó la petición: ${err.message}`)
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new LlmError('No se pudo conectar con Anthropic. ¿Hay conexión a internet?')
  }
  if (err instanceof Anthropic.APIError)
    return new LlmError(`Error de Anthropic (${err.status}): ${err.message}`)
  return err instanceof Error ? err : new Error(String(err))
}

export function createAnthropicAdapter(apiKey: string, model: string): LlmAdapter {
  const client = new Anthropic({ apiKey })

  return {
    async chat(req: LlmRequest, onText, signal): Promise<LlmResponse> {
      let jsonRetries = 0
      for (;;) {
        try {
          const stream = client.beta.messages.stream(
            {
              model,
              max_tokens: req.maxTokens,
              system: req.system,
              messages: toAnthropicMessages(req.messages, model),
              tools: req.tools.map((t): Anthropic.Beta.Messages.BetaTool => ({
                name: t.name,
                description: t.description,
                input_schema: t.inputSchema,
                // Los parámetros llegan según se generan; cada herramienta valida su entrada.
                eager_input_streaming: true
              })),
              thinking: { type: 'adaptive' },
              // Instrucciones y herramientas son idénticas en cada paso: se cachean.
              cache_control: { type: 'ephemeral' },
              // Si el modelo rechaza la petición, Anthropic la reintenta con otro modelo.
              betas: ['server-side-fallback-2026-07-01'],
              fallbacks: 'default'
            },
            { signal }
          )
          stream.on('text', (delta) => onText(delta))
          const message = await stream.finalMessage()
          return {
            content: fromAnthropicContent(message.content),
            stopReason: mapStop(message.stop_reason),
            raw: { provider: 'anthropic', model, content: message.content }
          }
        } catch (err) {
          // Una entrada de herramienta que no se pudo parsear (JSON roto) se reintenta;
          // los errores de la API se traducen y se propagan.
          if (!(err instanceof Anthropic.APIError) && !signal.aborted && jsonRetries++ < 2) continue
          throw explain(err, model)
        }
      }
    }
  }
}

/** Lista los modelos disponibles para la clave (sirve también para comprobarla). */
export async function listAnthropicModels(apiKey: string): Promise<string[]> {
  try {
    const ids: string[] = []
    for await (const model of new Anthropic({ apiKey }).models.list({ limit: 100 }))
      ids.push(model.id)
    return ids
  } catch (err) {
    throw explain(err, '')
  }
}
