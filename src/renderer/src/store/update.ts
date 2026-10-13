import { create } from 'zustand'
import type { UpdateStatus } from '@shared/update'
import { useChat } from './chat'
import { useGeneration } from './generation'
import { useUi } from './ui'

// Estado de la actualización automática, compartido por el aviso flotante y Ajustes.

interface UpdateState {
  status: UpdateStatus
  /**
   * Aviso ocultado con "Ocultar"/"Más tarde", como "estado:versión" (vale para la
   * sesión). Ocultar la descarga no oculta después el aviso de "lista".
   */
  dismissed: string | null
  init(): void
  dismiss(): void
  check(): Promise<void>
  /** Reinicia para instalar. Devuelve un mensaje si falla (null si no). */
  restart(): Promise<string | null>
}

let subscribed = false

export const dismissKey = (s: UpdateStatus): string => `${s.state}:${s.version ?? ''}`

export const useUpdate = create<UpdateState>((set, get) => ({
  status: { state: 'idle' },
  dismissed: null,
  init: () => {
    if (subscribed) return
    subscribed = true
    let live = false
    window.vibe.app.onUpdateStatus((status) => {
      live = true
      set({ status })
    })
    // Puede haber cambiado antes de que la ventana se suscribiera; si ya llegó un
    // evento, es más reciente que esta respuesta.
    void window.vibe.app.updateStatus().then((status) => live || set({ status }))
  },
  dismiss: () => set({ dismissed: dismissKey(get().status) }),
  check: async () => {
    set({ status: await window.vibe.app.checkForUpdates() })
  },
  restart: async () => {
    // El proyecto ya está guardado; lo que se perdería es el trabajo en curso.
    const busy =
      Object.keys(useGeneration.getState().jobs).length > 0 ||
      useUi.getState().tasks.length > 0 ||
      useChat.getState().running
    if (
      busy &&
      !window.confirm(
        'Hay trabajo en curso (generando audio, separando pistas o el productor). Si reinicias ahora se cancelará. ¿Reiniciar igualmente?'
      )
    ) {
      return null
    }
    try {
      await window.vibe.app.installUpdate()
      return null
    } catch (err) {
      // El mensaje de IPC llega envuelto ("Error invoking remote method…: Error: …").
      return (err as Error).message.replace(/^.*Error: /, '')
    }
  }
}))
