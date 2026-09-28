import { homedir } from 'node:os'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, safeStorage } from 'electron'
import type { ProviderId } from '@shared/generation'
import {
  GENERATION_UPDATE_EVENT,
  LLM_DELTA_EVENT,
  LOCAL_ENGINE_LOG_EVENT,
  LOCAL_ENGINE_STATUS_EVENT,
  type IpcChannel,
  type KeyCheck
} from '@shared/ipc-contract'
import type { LlmRequest } from '@shared/llm'
import type { TorchVariant } from '@shared/local-engine'
import { createProject, type GenerationSpec, type Project } from '@shared/project'
import { demoProvider } from './audio-providers/demo'
import { createLocalProvider } from './audio-providers/local'
import { createReplicateProvider, verifyReplicateToken } from './audio-providers/replicate'
import type { AudioProvider } from './audio-providers/types'
import { GenerationQueue } from './generation/queue'
import { LlmService } from './llm/service'
import { llmSecret, SettingsStore } from './settings'
import { SidecarManager } from './sidecar/manager'
import {
  initProjectDir,
  listVersions,
  loadProject,
  loadVersion,
  saveProject
} from './project/store'
import { ExportFolders, saveFileDialog, type ExportExt } from './export'
import { importAudio, readClip, writeClip } from './project/clips'

function handle(channel: IpcChannel, fn: (...args: never[]) => unknown): void {
  ipcMain.handle(channel, (_event, ...args) => fn(...(args as never[])))
}

export function registerIpc(): { shutdown(): void } {
  const settings = new SettingsStore(join(app.getPath('userData'), 'settings.json'), {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (plain) => safeStorage.encryptString(plain),
    decrypt: (data) => safeStorage.decryptString(data)
  })
  // VIBE_FAKE_LLM=1 activa un LLM de mentira determinista (solo para pruebas e2e).
  const fakeLlm = process.env['VIBE_FAKE_LLM'] === '1'
  const llm = new LlmService(settings, fakeLlm)
  const check = async (fn: () => Promise<string>): Promise<KeyCheck> => {
    try {
      return { ok: true, info: await fn() }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
  // Motor local (sidecar Python). En la app instalada, sidecar/ va en resources/.
  const sidecar = new SidecarManager({
    sidecarDir: app.isPackaged
      ? join(process.resourcesPath, 'sidecar')
      : join(app.getAppPath(), 'sidecar'),
    // Ruta corta a propósito (ver SidecarPaths.envDir). Las pruebas pueden cambiarla.
    envDir: process.env['VIBE_ENGINE_DIR'] ?? join(homedir(), '.vibemusic', 'engine')
  })
  const broadcast = (channel: string, ...args: unknown[]): void => {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, ...args)
  }
  sidecar.onStatus((status) => broadcast(LOCAL_ENGINE_STATUS_EVENT, status))
  sidecar.onLog((line) => broadcast(LOCAL_ENGINE_LOG_EVENT, line))

  const providers = new Map<ProviderId, AudioProvider>([
    ['demo', demoProvider],
    ['replicate', createReplicateProvider(() => settings.getReplicateToken())],
    ['local', createLocalProvider(sidecar, () => settings.getLocalModel())]
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

  // VIBE_TEST_SAVE_DELAY_MS simula un disco lento en las pruebas e2e.
  const saveDelay = Number(process.env['VIBE_TEST_SAVE_DELAY_MS'] ?? 0)
  handle('project:save', async (dir: string, project: Project, message: string) => {
    if (saveDelay > 0) await new Promise((r) => setTimeout(r, saveDelay))
    return saveProject(dir, project, message)
  })
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

  handle('settings:get', async () => {
    const pub = await settings.publicSettings()
    return fakeLlm ? { ...pub, llm: { ...pub.llm, simulated: true } } : pub
  })
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

  handle('settings:setLocalModel', (id: string) => settings.setLocalModel(id))
  handle('localEngine:status', () => sidecar.status())
  handle('localEngine:install', async (variant: TorchVariant) => {
    try {
      await sidecar.install(variant)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
  handle('localEngine:uninstall', () => sidecar.uninstall())
  handle('localEngine:start', async () => {
    try {
      await sidecar.ensureRunning()
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
  handle('localEngine:stop', () => sidecar.stop())

  handle('settings:setLlm', (patch: Parameters<SettingsStore['setLlm']>[0]) =>
    settings.setLlm(patch)
  )
  handle('settings:setLlmKey', (provider: string, key: string) =>
    check(() => llm.setKey(provider, key))
  )
  handle('settings:clearLlmKey', (provider: string) =>
    settings.setSecret(llmSecret(provider), null)
  )
  handle('settings:testLlm', (provider: string) => check(() => llm.test(provider)))
  handle('llm:listModels', async (provider: string) => {
    try {
      return { ok: true, models: await llm.listModels(provider) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('llm:chat', (event, requestId: string, req: LlmRequest) =>
    llm.chat(requestId, req, (text) => event.sender.send(LLM_DELTA_EVENT, requestId, text))
  )
  handle('llm:cancel', (requestId: string) => llm.cancel(requestId))

  const exportFolders = new ExportFolders()
  handle('export:saveFile', (bytes: Uint8Array, name: string, ext: ExportExt) =>
    saveFileDialog(bytes, name, ext)
  )
  handle('export:chooseFolder', () => exportFolders.choose())
  handle('export:writeInFolder', (token: string, fileName: string, bytes: Uint8Array) =>
    exportFolders.write(token, fileName, bytes)
  )
  handle('app:version', () => app.getVersion())

  return { shutdown: () => sidecar.killNow() }
}
