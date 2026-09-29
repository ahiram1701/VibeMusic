import { app } from 'electron'
import { autoUpdater } from 'electron-updater'

/**
 * Busca versiones nuevas en GitHub Releases al arrancar la app instalada, las descarga
 * en segundo plano y avisa con una notificación del sistema; se instalan al cerrar.
 *
 * Si no se puede consultar (sin internet, repositorio privado, release aún en borrador…)
 * no pasa nada: la app sigue funcionando igual y solo se anota en el log.
 */
export function startAutoUpdates(): void {
  if (!app.isPackaged || process.env['VIBE_NO_UPDATES'] === '1') return
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('error', (err) => console.warn('[updater]', err.message))
  autoUpdater
    .checkForUpdatesAndNotify({
      title: 'VibeMusic se actualizará',
      body: 'Hay una versión nueva ({version}). Se instalará al cerrar la app.'
    })
    .catch((err: unknown) =>
      console.warn('[updater]', err instanceof Error ? err.message : String(err))
    )
}
