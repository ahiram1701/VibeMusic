import { homedir } from 'node:os'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron'
import type { ProviderId } from '@shared/generation'
import {
  GENERATION_UPDATE_EVENT,
  LLM_DELTA_EVENT,
  LLM_RETRY_EVENT,
  LOCAL_ENGINE_LOG_EVENT,
  LOCAL_ENGINE_STATUS_EVENT,
  STEMS_PROGRESS_EVENT,
  UPDATE_STATUS_EVENT,
  SINGER_LOG_EVENT,
  SINGER_PROGRESS_EVENT,
  SINGER_STATUS_EVENT,
  VOICE_LOG_EVENT,
  VOICE_PROGRESS_EVENT,
  VOICE_STATUS_EVENT,
  type IpcChannel,
  type KeyCheck
} from '@shared/ipc-contract'
import type { LlmRequest } from '@shared/llm'
import type { TorchVariant } from '@shared/local-engine'
import { createProject, newId, type GenerationSpec, type Project } from '@shared/project'
import { demoProvider } from './audio-providers/demo'
import { createHuggingFaceProvider, verifyHfToken } from './audio-providers/huggingface'
import { createLocalProvider } from './audio-providers/local'
import { createReplicateProvider, verifyReplicateToken } from './audio-providers/replicate'
import type { AudioProvider } from './audio-providers/types'
import { GenerationQueue } from './generation/queue'
import { LlmService } from './llm/service'
import { log, logDir } from './log'
import { KeepAwake } from './power'
import { llmSecret, SettingsStore } from './settings'
import { createWebSearch } from './web/search'
import { SidecarManager } from './sidecar/manager'
import { StemsService } from './stems'
import { VoiceEngine } from './voice/engine'
import { SingerEngine } from './singer/engine'
import type { SingingEngine } from '@shared/generation'
import type { VoiceConvertOptions } from '@shared/voice'
import { checkForUpdates, getUpdateStatus, installUpdate, startAutoUpdates } from './updater'
import { computeWhatsNew } from './whats-new'
import {
  initProjectDir,
  isProjectDir,
  listVersions,
  loadVersion,
  newProjectDir,
  openProjectDir,
  saveProject
} from './project/store'
import { ExportFolders, saveFileDialog, type ExportExt } from './export'
import { importAudio, projectPath, readClip, writeClip } from './project/clips'

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
    ['local', createLocalProvider(sidecar, () => settings.getLocalModel())],
    ['huggingface', createHuggingFaceProvider(() => settings.getHfToken())]
  ])
  const queue = new GenerationQueue(providers)
  const keepAwake = new KeepAwake()
  const lastStatus = new Map<string, string>()
  queue.on('update', (job) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(GENERATION_UPDATE_EVENT, job)
    }
    // Al registro solo van los cambios de estado, no cada tic de progreso.
    if (lastStatus.get(job.id) !== job.status) {
      lastStatus.set(job.id, job.status)
      log('audio', `${job.id} ${job.status}${job.error ? `: ${job.error}` : ''}`)
    }
    keepAwake.set(
      'audio',
      queue.list().some((j) => j.status === 'queued' || j.status === 'running')
    )
  })

  // Los proyectos van, por defecto, cada uno en su carpeta dentro de Documentos/VibeMusic.
  // VIBE_PROJECTS_DIR la cambia (pruebas e2e).
  const projectsDir = (): string =>
    process.env['VIBE_PROJECTS_DIR'] ?? join(app.getPath('documents'), 'VibeMusic')
  const opened = async (
    dir: string,
    project: Project
  ): Promise<{ dir: string; project: Project }> => {
    await settings.addRecentProject(dir, project.name)
    return { dir, project }
  }

  handle('project:defaultParent', () => projectsDir())
  handle('project:chooseParent', async (current: string) => {
    const res = await dialog.showOpenDialog({
      title: 'Dónde guardar el proyecto',
      defaultPath: current,
      properties: ['openDirectory', 'createDirectory']
    })
    return res.canceled || !res.filePaths[0] ? null : res.filePaths[0]
  })
  handle('project:create', async (name: string, parent: string) => {
    const dir = newProjectDir(parent, name)
    const project = createProject(name.trim() || 'Nueva canción')
    await initProjectDir(dir, project)
    return opened(dir, project)
  })
  handle('project:open', async () => {
    const res = await dialog.showOpenDialog({
      title: 'Abrir un proyecto de VibeMusic (su carpeta)',
      defaultPath: projectsDir(),
      properties: ['openDirectory']
    })
    if (res.canceled || !res.filePaths[0]) return null
    const dir = res.filePaths[0]
    return opened(dir, await openProjectDir(dir))
  })
  handle('project:openPath', async (dir: string) => opened(dir, await openProjectDir(dir)))
  handle('project:recent', async () =>
    (await settings.getRecentProjects()).filter((r) => isProjectDir(r.dir))
  )
  handle('project:forgetRecent', (dir: string) => settings.removeRecentProject(dir))

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
  handle('settings:setHfToken', (token: string) =>
    check(async () => {
      const name = await verifyHfToken(token.trim())
      await settings.setHfToken(token.trim())
      return name
    })
  )
  handle('settings:clearHfToken', () => settings.setHfToken(null))
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
  handle('localEngine:installStems', async () => {
    try {
      await sidecar.installStems()
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // "Mi voz": conversión de voz con RVC (Applio) en su propio entorno de Python.
  const voice = new VoiceEngine(
    process.env['VIBE_VOICE_DIR'] ?? join(homedir(), '.vibemusic', 'voice')
  )
  voice.onStatus((s) => broadcast(VOICE_STATUS_EVENT, s))
  voice.onLog((line) => broadcast(VOICE_LOG_EVENT, line))
  const result = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
  handle('voice:status', () => voice.status())
  handle('voice:install', () => result(() => voice.install()))
  handle('voice:uninstall', () => voice.uninstall())
  handle('voice:list', () => voice.listVoices())
  handle('voice:import', async () => {
    const res = await dialog.showOpenDialog({
      title: 'Importar tu voz (.zip, o el .pth con su .index)',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Voz RVC', extensions: ['zip', 'pth', 'index'] }]
    })
    if (res.canceled || res.filePaths.length === 0) return null
    try {
      return { ok: true, voice: await voice.importVoice(res.filePaths) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
  handle('voice:remove', (id: string) => voice.removeVoice(id))
  ipcMain.handle(
    'voice:convert',
    async (
      event,
      requestId: string,
      dir: string,
      clipFile: string,
      voiceId: string,
      opts: VoiceConvertOptions
    ) => {
      const file = `clips/voice/${newId('vox')}.wav`
      const output = projectPath(dir, file)
      await mkdir(dirname(output), { recursive: true })
      await voice.convert(requestId, projectPath(dir, clipFile), output, voiceId, opts, (stage) =>
        event.sender.send(VOICE_PROGRESS_EVENT, requestId, stage)
      )
      return { file }
    }
  )
  handle('voice:cancel', (requestId: string) => voice.cancel(requestId))

  // Cantante local: DiffSinger en OpenUtau sin interfaz, en su propia carpeta.
  const singer = new SingerEngine(
    process.env['VIBE_SINGER_DIR'] ?? join(homedir(), '.vibemusic', 'singer')
  )
  singer.onStatus((s) => broadcast(SINGER_STATUS_EVENT, s))
  singer.onLog((line) => broadcast(SINGER_LOG_EVENT, line))
  handle('singer:status', () => singer.status())
  handle('singer:install', () => result(() => singer.install()))
  handle('singer:uninstall', () => singer.uninstall())
  ipcMain.handle('singer:render', async (event, requestId: string, dir: string, ustx: string) => {
    const id = newId('sng')
    const project = projectPath(dir, `clips/voice/${id}.ustx`)
    const file = `clips/voice/${id}.wav`
    await mkdir(dirname(project), { recursive: true })
    await writeFile(project, ustx)
    await singer.render(requestId, project, projectPath(dir, file), (stage) =>
      event.sender.send(SINGER_PROGRESS_EVENT, requestId, stage)
    )
    return { file }
  })
  handle('singer:cancel', (requestId: string) => singer.cancel(requestId))
  handle('settings:setSingingEngine', (engine: SingingEngine) => settings.setSingingEngine(engine))

  // Internet para el productor (sus herramientas web_search y read_page).
  const web = createWebSearch({ getOllamaKey: () => settings.getSecret('ollamaWebKey') })
  const webAllowed = async (): Promise<void> => {
    if (!(await settings.webAccess())) {
      throw new Error('El acceso a internet del productor está desactivado en Ajustes.')
    }
  }
  handle('web:search', async (query: string) => {
    await webAllowed()
    return web.search(query)
  })
  handle('web:read', async (url: string) => {
    await webAllowed()
    return web.read(url)
  })
  handle('settings:setWebAccess', (enabled: boolean) => settings.setWebAccess(enabled))
  handle('settings:setOllamaWebKey', (key: string) =>
    check(async () => {
      const trimmed = key.trim()
      // Se prueba con una búsqueda de verdad antes de guardarla.
      const probe = createWebSearch({ getOllamaKey: async () => trimmed })
      await probe.search('music')
      await settings.setSecret('ollamaWebKey', trimmed)
      return 'Clave de Ollama guardada'
    })
  )
  handle('settings:clearOllamaWebKey', () => settings.setSecret('ollamaWebKey', null))

  const stems = new StemsService(sidecar)
  ipcMain.handle('stems:separate', (event, requestId: string, dir: string, clipFile: string) =>
    stems.separate(requestId, dir, clipFile, (progress, stage) =>
      event.sender.send(STEMS_PROGRESS_EVENT, requestId, progress, stage)
    )
  )
  handle('stems:cancel', (requestId: string) => stems.cancel(requestId))
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
    llm.chat(
      requestId,
      req,
      (text) => event.sender.send(LLM_DELTA_EVENT, requestId, text),
      (info) => event.sender.send(LLM_RETRY_EVENT, requestId, info)
    )
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

  // Actualizaciones: las builds publicadas en GitHub Releases se auto-actualizan y la
  // interfaz muestra la descarga, el aviso de reiniciar y las novedades.
  startAutoUpdates({
    onStatus: (status) => broadcast(UPDATE_STATUS_EVENT, status),
    saveNotes: (version, notes) => settings.setPendingReleaseNotes(version, notes)
  })
  handle('app:updateStatus', () => getUpdateStatus())
  handle('app:checkForUpdates', () => checkForUpdates())
  handle('app:installUpdate', () => installUpdate())
  // Se calcula una sola vez al arrancar y se recuerda esta versión como vista.
  const whatsNew = settings
    .getUpdateMemory()
    .then(async (memory) => {
      const current = app.getVersion()
      const result = computeWhatsNew({
        current,
        lastRun: memory.lastRunVersion,
        pending: memory.pendingReleaseNotes
      })
      await settings.setLastRunVersion(current)
      return result
    })
    .catch(() => null)
  handle('app:whatsNew', () => whatsNew)
  handle('app:setBusy', (busy: boolean) => keepAwake.set('productor', busy))
  handle('app:openLogs', async () => {
    log('app', 'carpeta de registro abierta')
    await shell.openPath(logDir())
  })

  return {
    shutdown: () => {
      sidecar.killNow()
      voice.killAll()
      singer.killAll()
    }
  }
}
