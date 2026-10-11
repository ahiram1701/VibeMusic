import { app } from 'electron'
import { autoUpdater } from 'electron-updater'

/** Versión ya descargada y lista para instalar (null si no hay ninguna). */
let readyVersion: string | null = null

/**
 * Busca versiones nuevas en GitHub Releases al arrancar la app instalada y las
 * descarga en segundo plano. Cuando la descarga termina avisa con una notificación
 * del sistema y con `onReady`, para que la interfaz ofrezca reiniciar. Si el usuario
 * no reinicia, se instala igualmente al cerrar la app.
 *
 * Si no se puede consultar (sin internet, repositorio privado, release aún en borrador…)
 * no pasa nada: la app sigue funcionando igual y solo se anota en el log.
 */
export function startAutoUpdates(onReady: (version: string) => void): void {
  if (!app.isPackaged || process.env['VIBE_NO_UPDATES'] === '1') return
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('error', (err) => console.warn('[updater]', err.message))
  // También se emite al arrancar si la versión ya se había descargado en otra sesión.
  autoUpdater.on('update-downloaded', (info) => {
    readyVersion = info.version
    onReady(info.version)
  })
  autoUpdater
    .checkForUpdatesAndNotify({
      title: 'VibeMusic se actualizará',
      body: 'Hay una versión nueva ({version}). Se instalará al cerrar la app.'
    })
    .catch((err: unknown) =>
      console.warn('[updater]', err instanceof Error ? err.message : String(err))
    )
}

export function pendingUpdate(): string | null {
  return readyVersion
}

/** Cierra la app, instala la versión descargada sin preguntar y la vuelve a abrir. */
export function installUpdate(): void {
  if (!readyVersion) throw new Error('No hay ninguna actualización descargada')
  // En el siguiente ciclo, para que la respuesta IPC llegue antes de cerrar.
  setImmediate(() => autoUpdater.quitAndInstall(true, true))
}
