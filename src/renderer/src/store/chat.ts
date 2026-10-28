import { create } from 'zustand'
import { AgentCancelled, AgentInterrupted, runAgent, type AgentEvent } from '@shared/agent'
import { textOf, type LlmMessage, type LlmRetry } from '@shared/llm'
import { newId } from '@shared/project'
import { CHAT_FILE, parseSavedChat, serializeChat } from '@shared/chat-log'
import { PRODUCER_SYSTEM_PROMPT } from '@shared/producer-prompt'
import { CONTEXT_SEC, reviewProject } from '@shared/arrange'
import { findCollapse, soundSummary, tailBrightness, toMono } from '@shared/drone'
import { createWebTools } from '@shared/web-tools'
import {
  AGENT_PREFIX,
  createProducerTools,
  singLocally,
  whoSings,
  type ProducerHost
} from '@shared/producer-tools'
import { engine } from '../audio/engine'
import { continueRegion, convertVoiceRegion, separateRegion, varyRegion } from './clip-actions'
import { useGeneration, vocalProvider, waitForJob } from './generation'
import { useProject } from './project'
import { keepAcrossHmr } from './hot'
import { useVoice } from './voice'
import { renderSungVocal, useSinger } from './singer'

/** `at`: cuándo apareció (ms). En herramientas, `endedAt`: cuándo terminaron. */
export type ChatItem = { at: number } & (
  | { id: string; kind: 'user'; text: string }
  | { id: string; kind: 'assistant'; text: string }
  | {
      id: string
      kind: 'tool'
      name: string
      input: Record<string, unknown>
      status: 'running' | 'ok' | 'error'
      result?: string
      endedAt?: number
      /** En qué va una herramienta larga ("Parte 3 de 10 · Coro…"). */
      progress?: string
    }
  | { id: string; kind: 'notice'; text: string; tone: 'error' | 'info' }
)

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
  /** Desde cuándo espera la respuesta del LLM en el paso actual (para el cronómetro). */
  thinkingSince: number | null
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
  userMessages: () =>
    useChat
      .getState()
      .items.flatMap((i) => (i.kind === 'user' ? [i.text] : []))
      .reverse(),
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
  vocalProvider: () => vocalProvider(),
  localSingerReady: () => useSinger.getState().status.state === 'ready',
  singingPreference: () => useGeneration.getState().settings?.singingEngine ?? 'auto',
  singMelody: (ustx, message) =>
    renderSungVocal(ustx, { message, signal: controller?.signal ?? undefined }),
  generate: async (input) => {
    const gen = useGeneration.getState()
    const provider = input.lyrics ? host.vocalProvider() : host.audioProvider()
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
  extend: (regionId, bars, opts) =>
    agentJob(continueRegion(regionId, bars, { ...opts, messagePrefix: AGENT_PREFIX })),
  inspectRegion: async (regionId, opts) => {
    const { project, dir } = useProject.getState()
    const region = project?.tracks.flatMap((t) => t.regions).find((r) => r.id === regionId)
    const clip = region && project?.clips[region.clipId]
    if (!region || !clip || !dir) throw new Error(`No existe la región ${regionId}`)
    const buffer = engine.buffers.get(clip.id) ?? (await engine.loadClip(dir, clip))
    const sr = buffer.sampleRate
    const from = Math.floor(region.offsetSec * sr)
    const to = Math.min(buffer.length, Math.ceil((region.offsetSec + region.lengthSec) * sr))
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) =>
      buffer.getChannelData(i).subarray(from, to)
    )
    const mono = toMono(channels)
    return {
      collapseAtSec: findCollapse(mono, sr, opts),
      tailBrightDb: tailBrightness(mono, sr, CONTEXT_SEC),
      sound: soundSummary(mono, sr)
    }
  },
  separate: (regionId) => separateRegion(regionId, { messagePrefix: AGENT_PREFIX }),
  myVoices: () => {
    const { status, voices } = useVoice.getState()
    return { ready: status.state === 'ready', voices }
  },
  convertVoice: (regionId, opts) =>
    convertVoiceRegion(regionId, { ...opts, messagePrefix: AGENT_PREFIX }),
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

/** Quién canta ahora las canciones con letra ('local', 'cloud' o nadie). */
export function currentSinger(): 'local' | 'cloud' | null {
  return whoSings(host)
}

/**
 * "Cantar de nuevo" desde el editor de letra: la misma herramienta que usa el
 * productor (sing_song), sin pasar por el LLM. La letra ya está guardada en el proyecto.
 */
export async function singFromEditor(): Promise<void> {
  // Con el cantante local se adapta la melodía guardada a la letra editada.
  if (whoSings(host) === 'local') {
    await singLocally(host, { strict: false, message: 'letra cantada de nuevo' })
    return
  }
  const sing = tools.find((t) => t.def.name === 'sing_song')
  if (!sing) throw new Error('sing_song no existe')
  await sing.run({}, new AbortController().signal)
}

export const useChat = keepAcrossHmr('useChat', () =>
  create<ChatState>((set, get) => ({
    items: [],
    history: [],
    running: false,
    resumable: false,
    thinkingSince: null,
    retry: null,

    async send(text) {
      const trimmed = text.trim()
      if (!trimmed || get().running) return
      set((s) => ({
        items: [...s.items, { id: newId('msg'), at: Date.now(), kind: 'user', text: trimmed }]
      }))
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
        items: [
          ...s.items,
          { id: newId('msg'), at: Date.now(), kind: 'notice', tone: 'info', text: 'Reanudando…' }
        ]
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
)

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
    // Las herramientas de internet se crean en cada turno (llevan su límite de consultas)
    // y solo si el usuario lo permite en Ajustes.
    const webOn = useGeneration.getState().settings?.web.enabled ?? false
    const next = await runAgent({
      system: PRODUCER_SYSTEM_PROMPT,
      tools: webOn ? [...tools, ...createWebTools(window.vibe.web)] : tools,
      history,
      userText,
      signal: ctrl.signal,
      onEvent,
      maxTokens: 16000,
      review: () => {
        const p = useProject.getState().project
        return p ? reviewProject(p) : null
      },
      llm: async (req, onText) => {
        const requestId = newId('llm')
        currentRequest = requestId
        set({ thinkingSince: Date.now() })
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
          set({ retry: null, thinkingSince: null })
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
            ? { ...i, status: 'error' as const, result: 'Interrumpido', endedAt: Date.now() }
            : i
        ),
        {
          id: newId('msg'),
          at: Date.now(),
          kind: 'notice',
          text: message,
          tone: cancelled ? 'info' : 'error'
        }
      ]
    }))
  } finally {
    controller = null
    set({ running: false, retry: null, thinkingSince: null })
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
      return [...items, { id: newId('msg'), at: Date.now(), kind: 'assistant', text: e.text }]
    }
    case 'tool_start':
      return [
        ...items,
        { id: e.id, at: Date.now(), kind: 'tool', name: e.name, input: e.input, status: 'running' }
      ]
    case 'tool_progress':
      return items.map((i) => (i.kind === 'tool' && i.id === e.id ? { ...i, progress: e.text } : i))
    case 'tool_end':
      return items.map((i) =>
        i.kind === 'tool' && i.id === e.id
          ? { ...i, status: e.isError ? 'error' : 'ok', result: e.result, endedAt: Date.now() }
          : i
      )
    case 'limit':
      return [
        ...items,
        {
          id: newId('msg'),
          at: Date.now(),
          kind: 'notice',
          tone: 'info',
          text: 'El productor ha hecho muchos pasos seguidos y se ha detenido. Dile "sigue" si quieres que continúe.'
        }
      ]
    case 'review':
      return [
        ...items,
        {
          id: newId('msg'),
          at: Date.now(),
          kind: 'notice',
          tone: 'info',
          text: 'Revisión automática: hay secciones vacías o con una sola capa. El productor las está corrigiendo…'
        }
      ]
    case 'stopped':
      return [
        ...items,
        {
          id: newId('msg'),
          at: Date.now(),
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

// La conversación se guarda en el proyecto (chat.json) y se recupera al abrirlo: se
// sigue viendo aunque la ventana se recargue a mitad de una canción.
let chatDir: string | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null

function saveChat(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = null
  const { items, history } = useChat.getState()
  // Vacía solo justo tras cambiar de proyecto: no se pisa el chat guardado.
  if (!chatDir || (items.length === 0 && history.length === 0)) return
  const bytes = new TextEncoder().encode(serializeChat(items, history))
  window.vibe.clips.write(chatDir, CHAT_FILE, bytes).catch((err) => {
    console.error('No se pudo guardar la conversación', err)
  })
}

async function loadChat(dir: string): Promise<void> {
  let text: string
  try {
    text = new TextDecoder().decode(await window.vibe.clips.read(dir, CHAT_FILE))
  } catch {
    return // proyecto sin conversación guardada
  }
  const saved = parseSavedChat<ChatItem>(text)
  if (saved && chatDir === dir && !useChat.getState().running) useChat.setState(saved)
}

function openChat(dir: string | null): void {
  saveChat() // la del proyecto anterior, si quedaba algo por guardar
  useChat.getState().reset()
  chatDir = dir
  if (dir) void loadChat(dir)
}

// Una sola vez (también con HMR): cambiar de proyecto cambia de conversación, y cada
// cambio en el chat se guarda al cabo de un segundo.
keepAcrossHmr('chat:persist', () => {
  useProject.subscribe((s, prev) => {
    if (s.dir !== prev.dir) openChat(s.dir)
  })
  useChat.subscribe((s, prev) => {
    if (s.items === prev.items && s.history === prev.history) return
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(saveChat, 1000)
  })
  openChat(useProject.getState().dir)
  return true
})
