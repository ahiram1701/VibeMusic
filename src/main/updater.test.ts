import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpdateStatus } from '@shared/update'

type Listener = (arg?: unknown) => void
const listeners: Record<string, Listener> = {}
const updater = vi.hoisted(() => ({
  autoInstallOnAppQuit: false,
  on: vi.fn(),
  checkForUpdatesAndNotify: vi.fn(() => Promise.resolve(null)),
  checkForUpdates: vi.fn(() => Promise.resolve(null)),
  quitAndInstall: vi.fn()
}))

vi.mock('electron', () => ({ app: { isPackaged: true } }))
vi.mock('electron-updater', () => ({ autoUpdater: updater }))

async function start() {
  const mod = await import('./updater')
  const statuses: UpdateStatus[] = []
  const saveNotes = vi.fn(() => Promise.resolve())
  mod.startAutoUpdates({ onStatus: (s) => statuses.push(s), saveNotes })
  return { ...mod, statuses, saveNotes }
}

describe('actualizaciones automáticas', () => {
  beforeEach(() => {
    vi.resetModules()
    updater.on.mockImplementation((event: string, fn: Listener) => {
      listeners[event] = fn
    })
    updater.quitAndInstall.mockClear()
    updater.checkForUpdates.mockClear()
  })

  it('publica cada paso: buscando, descargando (cada 1 %), lista; y la instala al pedirlo', async () => {
    const { statuses, saveNotes, installUpdate, getUpdateStatus } = await start()
    expect(updater.autoInstallOnAppQuit).toBe(true)
    expect(() => installUpdate()).toThrow(/No hay ninguna actualización/)

    listeners['checking-for-update']()
    listeners['update-available']({ version: '0.1.5' })
    for (const percent of [0.4, 1.2, 1.9, 2.1, 45.7]) listeners['download-progress']({ percent })
    listeners['update-downloaded']({ version: '0.1.5', releaseNotes: '<h2>Novedades</h2>' })

    expect(statuses).toEqual([
      { state: 'checking' },
      { state: 'downloading', version: '0.1.5', percent: 0 },
      { state: 'downloading', version: '0.1.5', percent: 1 },
      { state: 'downloading', version: '0.1.5', percent: 2 },
      { state: 'downloading', version: '0.1.5', percent: 45 },
      { state: 'ready', version: '0.1.5' }
    ])
    expect(saveNotes).toHaveBeenCalledWith('0.1.5', '<h2>Novedades</h2>')

    // Volver a comprobar o un error posterior no ocultan la versión ya descargada.
    listeners['checking-for-update']()
    listeners['update-available']({ version: '0.1.5' })
    listeners['error'](new Error('net::ERR_INTERNET_DISCONNECTED'))
    expect(getUpdateStatus()).toEqual({ state: 'ready', version: '0.1.5' })

    installUpdate()
    await new Promise((r) => setImmediate(r))
    // Instalación silenciosa y la app se vuelve a abrir.
    expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true)
  })

  it('comprobación manual: al día, error y no repite si ya está descargando', async () => {
    const { checkForUpdates, getUpdateStatus } = await start()
    updater.checkForUpdates.mockImplementationOnce(() => {
      listeners['update-not-available']()
      return Promise.resolve(null)
    })
    expect(await checkForUpdates()).toEqual({ state: 'up-to-date' })

    updater.checkForUpdates.mockImplementationOnce(() => {
      listeners['error'](new Error('getaddrinfo ENOTFOUND github.com'))
      return Promise.reject(new Error('getaddrinfo ENOTFOUND github.com'))
    })
    expect(await checkForUpdates()).toMatchObject({ state: 'error' })

    listeners['update-available']({ version: '0.2.0' })
    await checkForUpdates()
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
    expect(getUpdateStatus().state).toBe('downloading')
  })
})
