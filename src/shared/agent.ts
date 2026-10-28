import type { ContentBlock, LlmMessage, LlmRequest, LlmResponse, ToolDef } from './llm'

// Bucle del agente productor (independiente del proveedor de LLM y de la UI):
//   1. enviar la conversación + herramientas al LLM
//   2. si pide herramientas, ejecutarlas (en paralelo) y devolverle los resultados
//   3. repetir hasta que responda sin pedir herramientas (o se alcance el límite)

export interface AgentTool {
  def: ToolDef
  /**
   * Devuelve un resultado serializable. Si lanza, el error se le devuelve al LLM.
   * `progress` muestra al usuario en qué va una herramienta larga ("Parte 3 de 10…").
   */
  run(
    input: Record<string, unknown>,
    signal: AbortSignal,
    progress?: (text: string) => void
  ): Promise<unknown>
}

export type AgentEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_start'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_progress'; id: string; text: string }
  | { type: 'tool_end'; id: string; result: string; isError: boolean }
  | { type: 'limit' }
  | { type: 'review'; text: string }
  | { type: 'stopped'; reason: 'max_tokens' | 'refusal' }

export interface RunAgentOptions {
  /** Llama al LLM. `onText` recibe fragmentos de texto según llegan (streaming). */
  llm(request: LlmRequest, onText: (delta: string) => void): Promise<LlmResponse>
  system: string
  tools: AgentTool[]
  /** Conversación previa (se amplía y se devuelve). */
  history: LlmMessage[]
  /**
   * Mensaje nuevo del usuario. Sin él se reanuda un turno interrumpido: `history`
   * termina en un mensaje del usuario (su petición o resultados de herramientas).
   */
  userText?: string
  signal: AbortSignal
  onEvent(event: AgentEvent): void
  maxSteps?: number
  maxTokens?: number
  /**
   * Revisión antes de terminar: si en este turno se ejecutó alguna herramienta y el
   * modelo da su respuesta final, se llama una vez; si devuelve un aviso, se le pasa
   * al modelo para que lo corrija antes de dar el trabajo por hecho.
   */
  review?: () => string | null
}

export class AgentCancelled extends Error {
  constructor() {
    super('Cancelado')
    this.name = 'AgentCancelled'
  }
}

/**
 * El turno falló a medias (p. ej. el LLM dejó de responder). `messages` es la
 * conversación hasta el último paso completo: se puede reanudar con `runAgent`
 * sin `userText` y el productor sigue donde iba, sin repetir lo ya hecho.
 */
export class AgentInterrupted extends Error {
  constructor(
    readonly messages: LlmMessage[],
    readonly cause: unknown
  ) {
    super(cause instanceof Error ? cause.message : String(cause))
    this.name = 'AgentInterrupted'
  }
}

/** Ejecuta un turno completo del agente y devuelve la conversación actualizada. */
export async function runAgent(opts: RunAgentOptions): Promise<LlmMessage[]> {
  const { tools, signal, onEvent, maxSteps = 16, maxTokens = 4096 } = opts
  const byName = new Map(tools.map((t) => [t.def.name, t]))
  const messages: LlmMessage[] = [...opts.history]
  if (opts.userText !== undefined) {
    messages.push({ role: 'user', content: [{ type: 'text', text: opts.userText }] })
  } else if (messages.at(-1)?.role !== 'user') {
    throw new Error('No hay nada que reanudar')
  }

  let actedThisTurn = false
  let reviewed = false
  for (let step = 0; step < maxSteps; step++) {
    if (signal.aborted) throw new AgentCancelled()
    let response: LlmResponse
    try {
      response = await opts.llm(
        { system: opts.system, messages, tools: tools.map((t) => t.def), maxTokens },
        (delta) => onEvent({ type: 'text', text: delta })
      )
    } catch (err) {
      if (err instanceof AgentCancelled || signal.aborted) throw new AgentCancelled()
      throw new AgentInterrupted([...messages], err)
    }
    // Si la respuesta se cortó (límite de tokens) o el modelo la rechazó, una
    // llamada a herramienta podría venir incompleta: no se ejecuta nada y se guarda
    // solo el texto (una llamada sin su resultado haría fallar el turno siguiente).
    if (response.stopReason === 'max_tokens' || response.stopReason === 'refusal') {
      const text = response.content.filter((b) => b.type === 'text')
      if (text.length > 0) messages.push({ role: 'assistant', content: text })
      onEvent({ type: 'stopped', reason: response.stopReason })
      return messages
    }
    messages.push({ role: 'assistant', content: response.content, raw: response.raw })

    const calls = response.content.filter(
      (b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use'
    )
    if (calls.length === 0) {
      const note = actedThisTurn && !reviewed ? opts.review?.() : null
      reviewed = true
      if (!note) return messages
      onEvent({ type: 'review', text: note })
      messages.push({ role: 'user', content: [{ type: 'text', text: note }] })
      continue
    }

    // Varias herramientas en el mismo paso se ejecutan a la vez
    // (p. ej. generar batería, bajo y acordes en paralelo).
    const results = await Promise.all(
      calls.map(async (call): Promise<ContentBlock> => {
        onEvent({ type: 'tool_start', id: call.id, name: call.name, input: call.input })
        let content: string
        let isError = false
        try {
          if (signal.aborted) throw new AgentCancelled()
          const tool = byName.get(call.name)
          if (!tool) throw new Error(`Herramienta desconocida: ${call.name}`)
          const result = await tool.run(call.input ?? {}, signal, (text) =>
            onEvent({ type: 'tool_progress', id: call.id, text })
          )
          content = typeof result === 'string' ? result : JSON.stringify(result)
        } catch (err) {
          if (err instanceof AgentCancelled || signal.aborted) throw new AgentCancelled()
          isError = true
          content = err instanceof Error ? err.message : String(err)
        }
        onEvent({ type: 'tool_end', id: call.id, result: content, isError })
        return { type: 'tool_result', toolUseId: call.id, content, isError }
      })
    )
    if (results.some((r) => r.type === 'tool_result' && !r.isError)) actedThisTurn = true
    messages.push({ role: 'user', content: results })
  }

  onEvent({ type: 'limit' })
  return messages
}
