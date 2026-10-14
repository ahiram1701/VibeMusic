import { create } from 'zustand'
import { AgentCancelled, AgentInterrupted, runAgent, type AgentEvent } from '@shared/agent'
import { textOf, type LlmMessage, type LlmRetry } from '@shared/llm'
import { newId } from '@shared/project'
import { PRODUCER_SYSTEM_PROMPT } from '@shared/producer-prompt'
import { AGENT_PREFIX, createProducerTools, type ProducerHost } from '@shared/producer-tools'
import { engine } from '../audio/engine'
import { continueRegion, separateRegion, varyRegion } from './clip-actions'
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
  /**
   * El último turno se cortó a medias (p. ej. Ollama dejó de responder) y `history`
   * guarda lo hecho hasta entonces: `resume()` sigue donde iba.
   */
  resumable: boolean
  /** El LLM falló por la red y se reintentará solo (`until`: cuándo, en ms). */
  retry: (LlmRetry & { until: number }) | null
  send(text: string): Promise<void>
  /** Reanuda el turno interrumpido. */
  resume(): Promise<void>
  stop(): void
  reset(): void
}

/** "sigue", "continúa", "reintenta"… tras un corte equivalen a pulsar Reintentar. */
const RESUME_WORDS = /^\s*(sigue|seguir|contin[uú]a|continuar|reintenta|reintentar|otra vez)\W*$/i

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
  separate: (regionId) => separateRegion(regionId, { messagePrefix: AGENT_PREFIX }),
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
  resumable: false,
  retry: null,

  async send(text) {
    const trimmed = text.trim()
    if (!trimmed || get().running) return
    set((s) => ({ items: [...s.items, { id: newId('msg'), kind: 'user', text: trimmed }] }))
    const { resumable, history } = get()
    if (resumable && RESUME_WORDS.test(trimmed)) return run(history)
    const last = history.at(-1)
    if (resumable && last?.role === 'user') {
      // El turno cortado espera respuesta: la indicación nueva se suma a ese mensaje
      // (dos mensajes de usuario seguidos confunden a algunos proveedores).
      return run([
        ...history.slice(0, -1),
        { ...last, content: [...last.content, { type: 'text', text: trimmed }] }
      ])
    }
    return run(history, trimmed)
  },

  async resume() {
    if (get().running || !get().resumable) return
    set((s) => ({
      items: [...s.items, { id: newId('msg'), kind: 'notice', tone: 'info', text: 'Reanudando…' }]
    }))
    return run(get().history)
  },

  stop() {
    controller?.abort()
    if (currentRequest) void window.vibe.llm.cancel(currentRequest)
  },

  reset() {
    get().stop()
    set({ items: [], history: [], resumable: false, retry: null })
  }
}))

/** Ejecuta un turno del productor (o reanuda uno cortado si no hay `userText`). */
async function run(history: LlmMessage[], userText?: string): Promise<void> {
  const set = useChat.setState
  const ctrl = new AbortController()
  controller = ctrl
  set({ running: true, resumable: false, retry: null })
  void window.vibe.app.setBusy(true)
  // Asegura que la lista de motores/ajustes está al día (p. ej. si se acaba de poner una clave).
  await useGeneration.getState().refresh()

  const onEvent = (e: AgentEvent): void => set((s) => ({ items: applyEvent(s.items, e) }))

  try {
    const next = await runAgent({
      system: PRODUCER_SYSTEM_PROMPT,
      tools,
      history,
      userText,
      signal: ctrl.signal,
      onEvent,
      maxTokens: 16000,
      llm: async (req, onText) => {
        const requestId = newId('llm')
        currentRequest = requestId
        let streamed = ''
        const offDelta = window.vibe.llm.onDelta((id, delta) => {
          if (id !== requestId) return
          streamed += delta
          onText(delta)
        })
        const offRetry = window.vibe.llm.onRetry((id, info) => {
          if (id === requestId) set({ retry: { ...info, until: Date.now() + info.waitMs } })
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
          offDelta()
          offRetry()
          set({ retry: null })
          currentRequest = null
        }
      }
    })
    set({ history: next })
  } catch (err) {
    const cancelled = err instanceof AgentCancelled || ctrl.signal.aborted
    const interrupted = !cancelled && err instanceof AgentInterrupted
    const message = cancelled
      ? 'Detenido.'
      : interrupted
        ? `${cleanError(err)} Lo hecho hasta ahora se conserva: pulsa "Reintentar" o dile "sigue".`
        : cleanError(err)
    // Si el turno se cortó esperando al LLM, se guarda la conversación hasta el último
    // paso completo para poder reanudarlo. Si no, vuelve al estado anterior al turno.
    // Los cambios ya hechos en la canción se quedan siempre (y se pueden deshacer).
    set((s) => ({
      ...(interrupted && { history: err.messages, resumable: true }),
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
    set({ running: false, retry: null })
    void window.vibe.app.setBusy(false)
  }
}

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
