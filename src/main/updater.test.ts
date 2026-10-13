import { beforeEach, describe, expect, it, vi } from 'vitest'

const listeners: Record<string, (arg: { version: string }) => void> = {}
const updater = vi.hoisted(() => ({
  autoInstallOnAppQuit: false,
  on: vi.fn(),
  checkForUpdatesAndNotify: vi.fn(() => Promise.resolve(null)),
  quitAndInstall: vi.fn()
}))

vi.mock('electron', () => ({ app: { isPackaged: true } }))
vi.mock('electron-updater', () => ({ autoUpdater: updater }))

describe('actualizaciones automáticas', () => {
  beforeEach(() => {
    vi.resetModules()
    updater.on.mockImplementation((event: string, fn: (arg: { version: string }) => void) => {
      listeners[event] = fn
    })
    updater.quitAndInstall.mockClear()
  })

  it('avisa cuando la versión nueva está descargada y la instala al pedirlo', async () => {
    const { installUpdate, pendingUpdate, startAutoUpdates } = await import('./updater')
    const onReady = vi.fn()
    startAutoUpdates(onReady)
    expect(updater.autoInstallOnAppQuit).toBe(true)
    expect(pendingUpdate()).toBeNull()
    expect(() => installUpdate()).toThrow(/No hay ninguna actualización/)

    listeners['update-downloaded']({ version: '0.1.3' })
    expect(onReady).toHaveBeenCalledWith('0.1.3')
    expect(pendingUpdate()).toBe('0.1.3')

    installUpdate()
    await new Promise((r) => setImmediate(r))
    // Instalación silenciosa y la app se vuelve a abrir.
    expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true)
  })
})
