import { create } from 'zustand'
import { AgentCancelled, runAgent, type AgentEvent } from '@shared/agent'
import { textOf, type LlmMessage } from '@shared/llm'
import { newId } from '@shared/project'
import { PRODUCER_SYSTEM_PROMPT } from '@shared/producer-prompt'
import { AGENT_PREFIX, createProducerTools, type ProducerHost } from '@shared/producer-tools'
import { engine } from '../audio/engine'
import { continueRegion, varyRegion } from './clip-actions'
import { useGeneration, waitForJob } from './generation'
import { useProject } from './project'

export type ChatItem =
  | { id: string; kind: 'user'; text: string }
  | { id: string; kind: 'assistant'; text: string }
  | {
      id: string
      kind: 'tool'
      name: string
      input: Record<string, unknown>
      status: 'running' | 'ok' | 'error'
      result?: string
    }
  | { id: string; kind: 'notice'; text: string; tone: 'error' | 'info' }

interface ChatState {
  items: ChatItem[]
  /** Conversación en el formato del LLM (se envía entera en cada paso). */
  history: LlmMessage[]
  running: boolean
  send(text: string): Promise<void>
  stop(): void
  reset(): void
}

let controller: AbortController | null = null
let currentRequest: string | null = null

/** Conecta las herramientas del agente con la app real. */
const host: ProducerHost = {
  getProject: () => {
    const p = useProject.getState().project
    if (!p) throw new Error('No hay ningún proyecto abierto')
    return p
  },
  commit: (next, message) => useProject.getState().commit(next, message),
  setTempo: (bpm, key, messagePrefix) =>
    useProject.getState().setTempo(bpm, { key, messagePrefix }),
  audioProvider: () => {
    const { providers, settings } = useGeneration.getState()
    return providers.find((p) => p.id === settings?.defaultProvider) ?? providers[0]
  },
  generate: async (input) => {
    const gen = useGeneration.getState()
    const provider = host.audioProvider()
    if (!provider) throw new Error('No hay motor de audio')
    const jobId = await gen.generate({
      ...input,
      providerId: provider.id,
      messagePrefix: AGENT_PREFIX
    })
    // Si el usuario pulsa "Parar", también se cancela la generación en curso.
    const onAbort = (): void => void gen.cancel(jobId)
    controller?.signal.addEventListener('abort', onAbort, { once: true })
    try {
      return await waitForJob(jobId)
    } finally {
      controller?.signal.removeEventListener('abort', onAbort)
    }
  },
  vary: (regionId, instructions) =>
    agentJob(varyRegion(regionId, { instructions, messagePrefix: AGENT_PREFIX })),
  extend: (regionId, bars, instructions) =>
    agentJob(continueRegion(regionId, bars, { instructions, messagePrefix: AGENT_PREFIX })),
  playheadSec: () => engine.positionSec,
  play: (sec) => void engine.play(host.getProject(), sec)
}

/** Espera a que termine una generación lanzada por el agente; "Parar" la cancela. */
async function agentJob(started: Promise<string>): Promise<{ trackId: string; regionId: string }> {
  const jobId = await started
  const onAbort = (): void => void useGeneration.getState().cancel(jobId)
  controller?.signal.addEventListener('abort', onAbort, { once: true })
  try {
    return await waitForJob(jobId)
  } finally {
    controller?.signal.removeEventListener('abort', onAbort)
  }
}

const tools = createProducerTools(host)

export const useChat = create<ChatState>((set, get) => ({
  items: [],
  history: [],
  running: false,

  async send(text) {
    const trimmed = text.trim()
    if (!trimmed || get().running) return
    controller = new AbortController()
    set((s) => ({
      running: true,
      items: [...s.items, { id: newId('msg'), kind: 'user', text: trimmed }]
    }))
    // Asegura que la lista de motores/ajustes está al día (p. ej. si se acaba de poner una clave).
    await useGeneration.getState().refresh()

    const onEvent = (e: AgentEvent): void => set((s) => ({ items: applyEvent(s.items, e) }))

    try {
      const history = await runAgent({
        system: PRODUCER_SYSTEM_PROMPT,
        tools,
        history: get().history,
        userText: trimmed,
        signal: controller.signal,
        onEvent,
        maxTokens: 16000,
        llm: async (req, onText) => {
          const requestId = newId('llm')
          currentRequest = requestId
          let streamed = ''
          const off = window.vibe.llm.onDelta((id, delta) => {
            if (id !== requestId) return
            streamed += delta
            onText(delta)
          })
          try {
            const response = await window.vibe.llm.chat(requestId, req)
            // El texto en vivo y la respuesta final viajan por canales distintos: la
            // respuesta puede llegar antes que los últimos fragmentos. Se completa aquí
            // con lo que falte para no perder el final del mensaje.
            const full = textOf(response.content)
            if (full.startsWith(streamed) && full.length > streamed.length) {
              onText(full.slice(streamed.length))
            }
            return response
          } finally {
            off()
            currentRequest = null
          }
        }
      })
      set({ history })
    } catch (err) {
      const cancelled = err instanceof AgentCancelled || controller.signal.aborted
      const message = cancelled ? 'Detenido.' : cleanError(err)
      // La conversación vuelve al estado anterior a este turno (el turno falló a medias),
      // pero los cambios ya hechos en la canción se quedan (y se pueden deshacer).
      set((s) => ({
        items: [
          ...s.items.map((i) =>
            i.kind === 'tool' && i.status === 'running'
              ? { ...i, status: 'error' as const, result: 'Interrumpido' }
              : i
          ),
          { id: newId('msg'), kind: 'notice', text: message, tone: cancelled ? 'info' : 'error' }
        ]
      }))
    } finally {
      controller = null
      set({ running: false })
    }
  },

  stop() {
    controller?.abort()
    if (currentRequest) void window.vibe.llm.cancel(currentRequest)
  },

  reset() {
    get().stop()
    set({ items: [], history: [] })
  }
}))

function applyEvent(items: ChatItem[], e: AgentEvent): ChatItem[] {
  switch (e.type) {
    case 'text': {
      const last = items.at(-1)
      if (last?.kind === 'assistant') {
        return [...items.slice(0, -1), { ...last, text: last.text + e.text }]
      }
      return [...items, { id: newId('msg'), kind: 'assistant', text: e.text }]
    }
    case 'tool_start':
      return [...items, { id: e.id, kind: 'tool', name: e.name, input: e.input, status: 'running' }]
    case 'tool_end':
      return items.map((i) =>
        i.kind === 'tool' && i.id === e.id
          ? { ...i, status: e.isError ? 'error' : 'ok', result: e.result }
          : i
      )
    case 'limit':
      return [
        ...items,
        {
          id: newId('msg'),
          kind: 'notice',
          tone: 'info',
          text: 'El productor ha hecho muchos pasos seguidos y se ha detenido. Dile "sigue" si quieres que continúe.'
        }
      ]
    case 'stopped':
      return [
        ...items,
        {
          id: newId('msg'),
          kind: 'notice',
          tone: 'error',
          text:
            e.reason === 'refusal'
              ? 'El modelo no ha querido responder a esa petición.'
              : 'La respuesta era demasiado larga y se cortó. Prueba a pedirlo en partes.'
        }
      ]
  }
}

/** Quita el envoltorio técnico que añade Electron a los errores de IPC. */
export function cleanError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  return raw.replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '')
}

// Cambiar de proyecto empieza una conversación nueva.
useProject.subscribe((s, prev) => {
  if (s.dir !== prev.dir) useChat.getState().reset()
})
