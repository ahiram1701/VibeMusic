import { useEffect, useState } from 'react'
import { useChat } from '../store/chat'
import { useGeneration } from '../store/generation'
import { useUi } from '../store/ui'

/** "Más tarde" pospone esa versión durante la sesión, aunque se cambie de pantalla. */
let dismissedVersion: string | null = null

/**
 * Aviso de que hay una versión nueva descargada. "Reiniciar ahora" la instala y abre
 * la app de nuevo; "Más tarde" lo oculta (se instalará igualmente al cerrar).
 */
export function UpdateBanner(): React.JSX.Element | null {
  const [version, setVersion] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(dismissedVersion)
  const [restarting, setRestarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Puede haberse descargado antes de que la ventana estuviera lista.
    void window.vibe.app.pendingUpdate().then((v) => v && setVersion(v))
    return window.vibe.app.onUpdateReady(setVersion)
  }, [])

  if (!version || dismissed === version) return null

  const restart = async (): Promise<void> => {
    // Los cambios del proyecto ya están guardados; lo que se perdería es el trabajo en curso.
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
      return
    }
    setRestarting(true)
    setError(null)
    try {
      await window.vibe.app.installUpdate()
    } catch (err) {
      setRestarting(false)
      // El mensaje de IPC llega envuelto ("Error invoking remote method…: Error: …").
      setError((err as Error).message.replace(/^.*Error: /, ''))
    }
  }

  return (
    <div
      role="status"
      className="fixed top-14 right-4 z-50 flex w-80 flex-col gap-3 rounded-md bg-panel p-4 text-sm shadow-xl ring-1 ring-line"
    >
      <p>
        <strong>VibeMusic {version}</strong> está lista para instalarse. Tus proyectos se conservan.
      </p>
      {error && <p className="text-red-400">No se pudo instalar: {error}</p>}
      <div className="flex justify-end gap-2">
        <button
          className="rounded-md px-3 py-1.5 text-muted hover:text-white"
          onClick={() => {
            dismissedVersion = version
            setDismissed(version)
          }}
          disabled={restarting}
        >
          Más tarde
        </button>
        <button
          className="rounded-md bg-accent px-3 py-1.5 font-medium hover:opacity-90 disabled:opacity-50"
          onClick={() => void restart()}
          disabled={restarting}
        >
          {restarting ? 'Reiniciando…' : 'Reiniciar ahora'}
        </button>
      </div>
    </div>
  )
}
