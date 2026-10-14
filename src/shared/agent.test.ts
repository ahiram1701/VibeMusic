import { describe, expect, it } from 'vitest'
import {
  AgentCancelled,
  AgentInterrupted,
  runAgent,
  type AgentEvent,
  type AgentTool
} from './agent'
import type { LlmRequest, LlmResponse } from './llm'

/** LLM falso que devuelve respuestas predefinidas y guarda lo que recibe. */
function scripted(responses: LlmResponse[]) {
  const requests: LlmRequest[] = []
  return {
    requests,
    llm: async (req: LlmRequest, onText: (d: string) => void): Promise<LlmResponse> => {
      requests.push(structuredClone(req))
      const res = responses.shift()
      if (!res) throw new Error('sin más respuestas')
      for (const b of res.content) if (b.type === 'text') onText(b.text)
      return res
    }
  }
}

const tool = (name: string, run: AgentTool['run']): AgentTool => ({
  def: { name, description: name, inputSchema: { type: 'object', properties: {} } },
  run
})

const base = { system: 'sys', history: [], signal: new AbortController().signal }

describe('runAgent', () => {
  it('ejecuta herramientas y devuelve sus resultados al LLM hasta terminar', async () => {
    const { llm, requests } = scripted([
      {
        stopReason: 'tool_use',
        content: [
          { type: 'text', text: 'Pongo el tempo.' },
          { type: 'tool_use', id: 't1', name: 'set_tempo', input: { bpm: 80 } }
        ]
      },
      { stopReason: 'end_turn', content: [{ type: 'text', text: 'Listo a 80 BPM.' }] }
    ])
    const events: AgentEvent[] = []
    const calls: unknown[] = []
    const messages = await runAgent({
      ...base,
      llm,
      userText: 'ponlo a 80',
      tools: [tool('set_tempo', async (input) => (calls.push(input), { ok: true }))],
      onEvent: (e) => events.push(e)
    })

    expect(calls).toEqual([{ bpm: 80 }])
    expect(requests[1].messages.at(-1)).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', toolUseId: 't1', content: '{"ok":true}', isError: false }]
    })
    expect(messages).toHaveLength(4) // user, assistant(tool_use), user(tool_result), assistant
    expect(events.map((e) => e.type)).toEqual(['text', 'tool_start', 'tool_end', 'text'])
  })

  it('devuelve los errores de herramientas al LLM en lugar de romperse', async () => {
    const { llm, requests } = scripted([
      {
        stopReason: 'tool_use',
        content: [{ type: 'tool_use', id: 'a', name: 'boom', input: {} }]
      },
      { stopReason: 'end_turn', content: [{ type: 'text', text: 'Vaya, falló.' }] }
    ])
    await runAgent({
      ...base,
      llm,
      userText: 'x',
      tools: [
        tool('boom', async () => {
          throw new Error('región no encontrada')
        })
      ],
      onEvent: () => undefined
    })
    expect(requests[1].messages.at(-1)?.content[0]).toMatchObject({
      type: 'tool_result',
      isError: true,
      content: 'región no encontrada'
    })
  })

  it('ejecuta en paralelo varias herramientas del mismo paso', async () => {
    const { llm } = scripted([
      {
        stopReason: 'tool_use',
        content: [
          { type: 'tool_use', id: '1', name: 'slow', input: { n: 1 } },
          { type: 'tool_use', id: '2', name: 'slow', input: { n: 2 } }
        ]
      },
      { stopReason: 'end_turn', content: [{ type: 'text', text: 'ok' }] }
    ])
    let running = 0
    let maxRunning = 0
    await runAgent({
      ...base,
      llm,
      userText: 'x',
      tools: [
        tool('slow', async () => {
          maxRunning = Math.max(maxRunning, ++running)
          await new Promise((r) => setTimeout(r, 20))
          running--
          return 'hecho'
        })
      ],
      onEvent: () => undefined
    })
    expect(maxRunning).toBe(2)
  })

  it('se detiene al cancelar', async () => {
    const controller = new AbortController()
    const { llm } = scripted([
      { stopReason: 'tool_use', content: [{ type: 'tool_use', id: '1', name: 't', input: {} }] }
    ])
    const run = runAgent({
      ...base,
      signal: controller.signal,
      llm,
      userText: 'x',
      tools: [tool('t', async () => (controller.abort(), 'ok'))],
      onEvent: () => undefined
    })
    await expect(run).rejects.toBeInstanceOf(AgentCancelled)
  })

  it('para tras el máximo de pasos', async () => {
    const loop = {
      stopReason: 'tool_use' as const,
      content: [{ type: 'tool_use' as const, id: 'x', name: 't', input: {} }]
    }
    const { llm } = scripted([loop, loop, loop])
    const events: AgentEvent[] = []
    await runAgent({
      ...base,
      llm,
      userText: 'x',
      maxSteps: 2,
      tools: [tool('t', async () => 'ok')],
      onEvent: (e) => events.push(e)
    })
    expect(events.at(-1)).toEqual({ type: 'limit' })
  })
})

describe('runAgent · respuestas cortadas', () => {
  it('no ejecuta herramientas si la respuesta se cortó por max_tokens o refusal', async () => {
    for (const stopReason of ['max_tokens', 'refusal'] as const) {
      const { llm } = scripted([
        { stopReason, content: [{ type: 'tool_use', id: '1', name: 't', input: { bpm: 1 } }] }
      ])
      let ran = false
      const events: AgentEvent[] = []
      await runAgent({
        ...base,
        llm,
        userText: 'x',
        tools: [tool('t', async () => ((ran = true), 'ok'))],
        onEvent: (e) => events.push(e)
      })
      expect(ran).toBe(false)
      expect(events.at(-1)).toEqual({ type: 'stopped', reason: stopReason })
    }
  })
})

describe('runAgent · reanudar tras un fallo', () => {
  it('conserva los pasos completos y continúa sin repetirlos', async () => {
    let calls = 0
    const tempo = tool('set_tempo', async () => {
      calls++
      return 'ok'
    })
    const step1: LlmResponse = {
      stopReason: 'tool_use',
      content: [{ type: 'tool_use', id: 't1', name: 'set_tempo', input: {} }]
    }
    let fail = true
    const llm = async (req: LlmRequest): Promise<LlmResponse> => {
      if (req.messages.length === 1) return step1
      if (fail) throw new Error('No se pudo conectar con Ollama (la conexión se cortó)')
      return { stopReason: 'end_turn', content: [{ type: 'text', text: 'Listo.' }] }
    }

    const err = await runAgent({
      ...base,
      tools: [tempo],
      userText: 'hazla',
      llm,
      onEvent: () => undefined
    })
      .then(() => null)
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AgentInterrupted)
    const partial = (err as AgentInterrupted).messages
    // petición, llamada a herramienta y su resultado
    expect(partial.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
    expect((err as AgentInterrupted).message).toMatch(/Ollama/)

    fail = false
    const done = await runAgent({
      ...base,
      history: partial,
      tools: [tempo],
      llm,
      onEvent: () => undefined
    })
    expect(done.at(-1)).toEqual({
      role: 'assistant',
      content: [{ type: 'text', text: 'Listo.' }],
      raw: undefined
    })
    expect(calls).toBe(1)
  })

  it('no reanuda si la conversación no espera respuesta', async () => {
    await expect(
      runAgent({
        ...base,
        history: [{ role: 'assistant', content: [{ type: 'text', text: 'hola' }] }],
        tools: [],
        llm: async () => ({ stopReason: 'end_turn', content: [] }),
        onEvent: () => undefined
      })
    ).rejects.toThrow(/reanudar/)
  })

  it('cancelar durante la llamada al LLM sigue siendo AgentCancelled', async () => {
    const controller = new AbortController()
    const llm = async (): Promise<LlmResponse> => {
      controller.abort()
      throw new Error('aborted')
    }
    await expect(
      runAgent({
        ...base,
        signal: controller.signal,
        tools: [],
        userText: 'x',
        llm,
        onEvent: () => undefined
      })
    ).rejects.toBeInstanceOf(AgentCancelled)
  })
})
