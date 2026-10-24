import { create } from 'zustand'
import type { VoiceEngineStatus, VoiceModel } from '@shared/voice'

// Estado de "Mi voz" (RVC): si el motor está instalado y qué voces hay importadas.

interface VoiceState {
  status: VoiceEngineStatus
  voices: VoiceModel[]
  log: string[]
  init(): Promise<void>
  refresh(): Promise<void>
}

let subscribed = false

export const useVoice = create<VoiceState>((set, get) => ({
  status: { state: 'checking' },
  voices: [],
  log: [],

  async init() {
    if (!subscribed) {
      subscribed = true
      window.vibe.voice.onStatus((status) => {
        set({ status })
        if (status.state === 'ready') void get().refresh()
      })
      window.vibe.voice.onLog((line) => set((s) => ({ log: [...s.log, line].slice(-200) })))
    }
    await get().refresh()
  },

  async refresh() {
    const [status, voices] = await Promise.all([
      window.vibe.voice.status(),
      window.vibe.voice.list()
    ])
    set({ status, voices })
  }
}))
