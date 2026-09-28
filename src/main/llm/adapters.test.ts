import { describe, expect, it } from 'vitest'
import type { LlmMessage } from '@shared/llm'
import { toAnthropicMessages } from './anthropic'
import {
  createOpenAiCompatibleAdapter,
  listOpenAiCompatibleModels,
  stripReasoning,
  toChatMessages
} from './openai-compatible'

const conversation: LlmMessage[] = [
  { role: 'user', content: [{ type: 'text', text: 'pon 90 bpm' }] },
  {
    role: 'assistant',
    content: [
      { type: 'text', text: 'Hecho.' },
      { type: 'tool_use', id: 'c1', name: 'set_tempo_key', input: { bpm: 90 } }
    ],
    raw: {
      provider: 'anthropic',
      model: 'claude-opus-5',
      content: [
        { type: 'thinking', thinking: '', signature: 'sig' },
        { type: 'text', text: 'Hecho.' }
      ]
    }
  },
  {
    role: 'user',
    content: [{ type: 'tool_result', toolUseId: 'c1', content: '{"ok":true}', isError: false }]
  }
]

describe('Anthropic: conversión de mensajes', () => {
  it('devuelve la respuesta original (con thinking) si el modelo coincide', () => {
    const out = toAnthropicMessages(conversation, 'claude-opus-5')
    expect(out[1].content).toEqual(conversation[1].raw!.content)
    expect(out[2]).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'c1', content: '{"ok":true}', is_error: false }]
    })
  })

  it('usa el formato neutro si el modelo cambió', () => {
    const out = toAnthropicMessages(conversation, 'claude-sonnet-5')
    expect(out[1].content).toEqual([
      { type: 'text', text: 'Hecho.' },
      { type: 'tool_use', id: 'c1', name: 'set_tempo_key', input: { bpm: 90 } }
    ])
  })
})

describe('OpenAI/Ollama: conversión y respuesta', () => {
  it('convierte llamadas y resultados de herramientas al formato Chat Completions', () => {
    expect(toChatMessages('sys', conversation)).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'pon 90 bpm' },
      {
        role: 'assistant',
        content: 'Hecho.',
        tool_calls: [
          {
            id: 'c1',
            type: 'function',
            function: { name: 'set_tempo_key', arguments: '{"bpm":90}' }
          }
        ]
      },
      { role: 'tool', tool_call_id: 'c1', content: '{"ok":true}' }
    ])
  })

  it('interpreta tool_calls de la respuesta y tolera JSON roto', async () => {
    let body: Record<string, unknown> = {}
    const adapter = createOpenAiCompatibleAdapter({
      baseUrl: 'http://x/v1',
      model: 'qwen3',
      label: 'Ollama',
      tokensParam: 'max_tokens',
      fetchImpl: (async (_url: string, init: RequestInit) => {
        body = JSON.parse(init.body as string)
        return Response.json({
          choices: [
            {
              finish_reason: 'tool_calls',
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  { id: 'a', type: 'function', function: { name: 'x', arguments: '{"bpm":80}' } },
                  { id: 'b', type: 'function', function: { name: 'y', arguments: '{roto' } }
                ]
              }
            }
          ]
        })
      }) as typeof fetch
    })
    const res = await adapter.chat(
      { system: 's', messages: [], tools: [], maxTokens: 100 },
      () => undefined,
      new AbortController().signal
    )
    expect(body).toMatchObject({ model: 'qwen3', max_tokens: 100 })
    expect(res.stopReason).toBe('tool_use')
    expect(res.content).toEqual([
      { type: 'tool_use', id: 'a', name: 'x', input: { bpm: 80 } },
      { type: 'tool_use', id: 'b', name: 'y', input: {} }
    ])
  })
})

describe('proveedores compatibles con OpenAI', () => {
  it('quita el razonamiento <think> del texto visible', () => {
    expect(stripReasoning('<think>hmm, 90 bpm…</think>Listo, a 90 BPM.')).toBe('Listo, a 90 BPM.')
    expect(stripReasoning('<think>sin cerrar')).toBe('')
  })

  it('lista modelos (formato OpenAI) y explica errores de clave', async () => {
    const ok = (async () =>
      Response.json({
        data: [{ id: 'llama-3.3-70b-versatile' }, { id: 'openai/gpt-oss-120b' }]
      })) as unknown as typeof fetch
    expect(
      await listOpenAiCompatibleModels('https://api.groq.com/openai/v1', 'k', 'Groq', ok)
    ).toEqual(['llama-3.3-70b-versatile', 'openai/gpt-oss-120b'])
    const denied = (async () =>
      Response.json(
        { error: { message: 'Invalid API Key' } },
        { status: 401 }
      )) as unknown as typeof fetch
    await expect(
      listOpenAiCompatibleModels('https://x/v1', 'mala', 'Groq', denied)
    ).rejects.toThrow(/API key de Groq no es válida/)
  })

  it('explica cuando un modelo no soporta herramientas', async () => {
    const adapter = createOpenAiCompatibleAdapter({
      baseUrl: 'http://x/v1',
      model: 'tiny-model',
      label: 'Groq',
      tokensParam: 'max_completion_tokens',
      fetchImpl: (async () =>
        Response.json(
          { error: { message: 'tools are not supported for this model' } },
          { status: 400 }
        )) as unknown as typeof fetch
    })
    await expect(
      adapter.chat(
        { system: 's', messages: [], tools: [], maxTokens: 10 },
        () => undefined,
        new AbortController().signal
      )
    ).rejects.toThrow(/no soporta "tool calling"/)
  })
})
