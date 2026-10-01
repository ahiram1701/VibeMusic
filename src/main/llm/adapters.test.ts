import { describe, expect, it } from 'vitest'
import type { LlmMessage } from '@shared/llm'
import { toAnthropicMessages } from './anthropic'
import { OLLAMA_NUM_CTX, createOllamaAdapter } from './ollama'
import {
  createOpenAiCompatibleAdapter,
  extractTextToolCalls,
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

describe('llamadas escritas como texto (Llama y similares)', () => {
  const tools = new Set(['generate_clip', 'set_sections'])

  it('rescata el formato {"name", "parameters"} y <function=…> y limpia el texto', () => {
    const text =
      'Vamos a generar la melodía.\n\n{"name": "generate_clip", "parameters": {"bars": "8", "prompt": "rap {old school}"}}\n\n' +
      '<function=set_sections>{"sections": []}</function>\nListo.'
    const out = extractTextToolCalls(text, tools)
    expect(out.calls).toEqual([
      { name: 'generate_clip', input: { bars: '8', prompt: 'rap {old school}' } },
      { name: 'set_sections', input: { sections: [] } }
    ])
    expect(out.text).toBe('Vamos a generar la melodía.\n\nListo.')
  })

  it('ignora herramientas desconocidas y JSON que no son llamadas', () => {
    const text = 'Ejemplo {"name": "New track", "parameters": {}} y {"bpm": 90}'
    expect(extractTextToolCalls(text, tools)).toEqual({ calls: [], text })
  })

  it('el adaptador las convierte en tool_use solo si no hay tool_calls nativos', async () => {
    const reply = (message: Record<string, unknown>) =>
      createOpenAiCompatibleAdapter({
        baseUrl: 'http://x/v1',
        model: 'llama',
        label: 'Groq',
        tokensParam: 'max_tokens',
        fetchImpl: (async () =>
          Response.json({ choices: [{ finish_reason: 'stop', message }] })) as typeof fetch
      }).chat(
        {
          system: 's',
          messages: [],
          tools: [
            {
              name: 'generate_clip',
              description: '',
              inputSchema: { type: 'object', properties: {} }
            }
          ],
          maxTokens: 10
        },
        () => undefined,
        new AbortController().signal
      )
    const call = '{"name": "generate_clip", "parameters": {"bars": 4}}'

    const fromText = await reply({ role: 'assistant', content: `Voy.\n${call}` })
    expect(fromText.stopReason).toBe('tool_use')
    expect(fromText.content[0]).toEqual({ type: 'text', text: 'Voy.' })
    expect(fromText.content[1]).toMatchObject({
      type: 'tool_use',
      name: 'generate_clip',
      input: { bars: 4 }
    })

    const native = await reply({
      role: 'assistant',
      content: call,
      tool_calls: [
        { id: 'n', type: 'function', function: { name: 'generate_clip', arguments: '{}' } }
      ]
    })
    expect(native.content).toEqual([
      { type: 'text', text: call },
      { type: 'tool_use', id: 'n', name: 'generate_clip', input: {} }
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

describe('Ollama nativo', () => {
  it('usa /api/chat con más contexto, sin razonamiento y con argumentos como objeto', async () => {
    let url = ''
    let body: Record<string, unknown> = {}
    const adapter = createOllamaAdapter({
      baseUrl: 'http://10.0.0.184:11434/v1/',
      model: 'qwen3:4b',
      fetchImpl: (async (u: string, init: RequestInit) => {
        url = u
        body = JSON.parse(init.body as string)
        return Response.json({
          done_reason: 'stop',
          message: {
            role: 'assistant',
            content: '<think>…</think>Voy.',
            tool_calls: [{ function: { name: 'set_tempo_key', arguments: { bpm: 90 } } }]
          }
        })
      }) as typeof fetch
    })
    const res = await adapter.chat(
      { system: 's', messages: conversation, tools: [], maxTokens: 50 },
      () => undefined,
      new AbortController().signal
    )
    expect(url).toBe('http://10.0.0.184:11434/api/chat')
    expect(body).toMatchObject({
      model: 'qwen3:4b',
      stream: false,
      think: false,
      options: { num_ctx: OLLAMA_NUM_CTX, num_predict: 50 }
    })
    expect(body.messages).toEqual([
      { role: 'system', content: 's' },
      { role: 'user', content: 'pon 90 bpm' },
      {
        role: 'assistant',
        content: 'Hecho.',
        tool_calls: [{ function: { name: 'set_tempo_key', arguments: { bpm: 90 } } }]
      },
      { role: 'tool', content: '{"ok":true}', tool_name: 'set_tempo_key' }
    ])
    expect(res.stopReason).toBe('tool_use')
    expect(res.content[0]).toEqual({ type: 'text', text: 'Voy.' })
    expect(res.content[1]).toMatchObject({ name: 'set_tempo_key', input: { bpm: 90 } })
  })

  it('rescata llamadas escritas como texto y detecta respuestas cortadas', async () => {
    const reply = (message: Record<string, unknown>, done_reason = 'stop') =>
      createOllamaAdapter({
        baseUrl: 'http://x:11434/v1',
        model: 'llama3.2',
        fetchImpl: (async () => Response.json({ done_reason, message })) as typeof fetch
      }).chat(
        {
          system: 's',
          messages: [],
          tools: [
            { name: 'play', description: '', inputSchema: { type: 'object', properties: {} } }
          ],
          maxTokens: 10
        },
        () => undefined,
        new AbortController().signal
      )
    const fromText = await reply({ role: 'assistant', content: '{"name":"play","parameters":{}}' })
    expect(fromText.content).toMatchObject([{ type: 'tool_use', name: 'play', input: {} }])
    expect((await reply({ role: 'assistant', content: 'Hola, est' }, 'length')).stopReason).toBe(
      'max_tokens'
    )
  })
})
