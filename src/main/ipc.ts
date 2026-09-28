import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, safeStorage } from 'electron'
import type { ProviderId } from '@shared/generation'
import { GENERATION_UPDATE_EVENT, type IpcChannel } from '@shared/ipc-contract'
import { createProject, type GenerationSpec, type Project } from '@shared/project'
import { demoProvider } from './audio-providers/demo'
import { createReplicateProvider, verifyReplicateToken } from './audio-providers/replicate'
import type { AudioProvider } from './audio-providers/types'
import { GenerationQueue } from './generation/queue'
import { SettingsStore } from './settings'
import {
  initProjectDir,
  listVersions,
  loadProject,
  loadVersion,
  saveProject
} from './project/store'
import { importAudio, readClip, saveWavDialog, writeClip } from './project/clips'

function handle(channel: IpcChannel, fn: (...args: never[]) => unknown): void {
  ipcMain.handle(channel, (_event, ...args) => fn(...(args as never[])))
}

export function registerIpc(): void {
  const settings = new SettingsStore(join(app.getPath('userData'), 'settings.json'), {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (plain) => safeStorage.encryptString(plain),
    decrypt: (data) => safeStorage.decryptString(data)
  })
  const providers = new Map<ProviderId, AudioProvider>([
    ['demo', demoProvider],
    ['replicate', createReplicateProvider(() => settings.getReplicateToken())]
  ])
  const queue = new GenerationQueue(providers)
  queue.on('update', (job) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(GENERATION_UPDATE_EVENT, job)
    }
  })

  handle('project:create', async (name: string) => {
    const res = await dialog.showOpenDialog({
      title: 'Carpeta para el nuevo proyecto',
      properties: ['openDirectory', 'createDirectory']
    })
    if (res.canceled || !res.filePaths[0]) return null
    const dir = res.filePaths[0]
    const project = createProject(name)
    await initProjectDir(dir, project)
    return { dir, project }
  })

  handle('project:open', async () => {
    const res = await dialog.showOpenDialog({
      title: 'Abrir proyecto VibeMusic',
      properties: ['openDirectory']
    })
    if (res.canceled || !res.filePaths[0]) return null
    const dir = res.filePaths[0]
    return { dir, project: await loadProject(dir) }
  })

  handle('project:save', (dir: string, project: Project, message: string) =>
    saveProject(dir, project, message)
  )
  handle('project:listVersions', (dir: string) => listVersions(dir))
  handle('project:loadVersion', (dir: string, id: number) => loadVersion(dir, id))
  handle('clips:import', (dir: string) => importAudio(dir))
  handle('clips:read', (dir: string, file: string) => readClip(dir, file))
  handle('clips:write', (dir: string, file: string, bytes: Uint8Array) =>
    writeClip(dir, file, bytes)
  )

  handle('generation:providers', () => queue.providerInfo())
  handle('generation:enqueue', (dir: string, providerId: ProviderId, spec: GenerationSpec) =>
    queue.enqueue(dir, providerId, spec)
  )
  handle('generation:cancel', (jobId: string) => queue.cancel(jobId))
  handle('generation:list', () => queue.list())

  handle('settings:get', () => settings.publicSettings())
  handle('settings:setReplicateToken', async (token: string) => {
    try {
      const username = await verifyReplicateToken(token.trim())
      await settings.setReplicateToken(token.trim())
      return { ok: true, username }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
  handle('settings:clearReplicateToken', () => settings.setReplicateToken(null))
  handle('settings:setDefaultProvider', (id: ProviderId) => settings.setDefaultProvider(id))

  handle('export:saveWav', (bytes: Uint8Array, name: string) => saveWavDialog(bytes, name))
  handle('app:version', () => app.getVersion())
}
