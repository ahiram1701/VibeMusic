import { app } from 'electron'
import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater'
import type { UpdateStatus } from '@shared/update'
import { notesToHtml } from './whats-new'

let status: UpdateStatus = { state: 'disabled' }
let emit: (s: UpdateStatus) => void = () => undefined

function set(next: UpdateStatus): void {
  status = next
  emit(status)
}

/**
 * Busca versiones nuevas en GitHub Releases al arrancar la app instalada y las
 * descarga en segundo plano. Cada paso (buscando, descargando con su progreso,
 * lista, al día, error) se publica con `onStatus` para que la interfaz lo muestre.
 * La versión descargada se instala al reiniciar desde la app o al cerrarla.
 *
 * Si no se puede consultar (sin internet, release aún en borrador…) la app sigue
 * funcionando igual: solo cambia el estado a "error".
 */
export function startAutoUpdates(opts: {
  onStatus(s: UpdateStatus): void
  /** Guarda las notas de la versión descargada para enseñarlas tras instalarla. */
  saveNotes(version: string, notes: string): Promise<void>
}): void {
  emit = opts.onStatus
  if (!app.isPackaged || process.env['VIBE_NO_UPDATES'] === '1') return
  status = { state: 'idle' }
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    // Si ya hay una descargada, se mantiene "lista" aunque se vuelva a comprobar.
    if (status.state !== 'ready') set({ state: 'checking' })
  })
  autoUpdater.on('update-available', (info: UpdateInfo) => {
    if (status.state === 'ready' && status.version === info.version) return
    set({ state: 'downloading', version: info.version, percent: 0 })
  })
  autoUpdater.on('download-progress', (p: ProgressInfo) => {
    // Solo cambios de al menos un 1 %: el evento llega muchas veces por segundo.
    if (status.state !== 'downloading' || Math.floor(p.percent) <= (status.percent ?? 0)) return
    set({ ...status, percent: Math.floor(p.percent) })
  })
  autoUpdater.on('update-not-available', () => set({ state: 'up-to-date' }))
  // También se emite al arrancar si la versión ya se había descargado en otra sesión.
  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    set({ state: 'ready', version: info.version })
    const notes = notesToHtml(info.releaseNotes)
    if (notes) {
      opts.saveNotes(info.version, notes).catch((err: unknown) => console.warn('[updater]', err))
    }
  })
  autoUpdater.on('error', (err) => {
    console.warn('[updater]', err.message)
    // Un fallo al volver a comprobar no debe ocultar una versión ya descargada.
    if (status.state !== 'ready') set({ state: 'error', error: err.message })
  })

  autoUpdater
    .checkForUpdatesAndNotify({
      title: 'VibeMusic se actualizará',
      body: 'Hay una versión nueva ({version}). Se instalará al cerrar la app.'
    })
    .catch(() => undefined) // ya llega por el evento "error"
}

export function getUpdateStatus(): UpdateStatus {
  return status
}

/** Comprobación manual (desde Ajustes), sin notificación del sistema. */
export async function checkForUpdates(): Promise<UpdateStatus> {
  // Ya hay algo en marcha o descargado: no tiene sentido volver a buscar.
  if (['disabled', 'checking', 'downloading', 'ready'].includes(status.state)) return status
  await autoUpdater.checkForUpdates().catch(() => undefined) // el error llega por el evento
  return status
}

/** Cierra la app, instala la versión descargada sin preguntar y la vuelve a abrir. */
export function installUpdate(): void {
  if (status.state !== 'ready') throw new Error('No hay ninguna actualización descargada')
  // En el siguiente ciclo, para que la respuesta IPC llegue antes de cerrar.
  setImmediate(() => autoUpdater.quitAndInstall(true, true))
}
