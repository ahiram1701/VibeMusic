import { contextBridge, ipcRenderer } from 'electron'
import type { GenerationJob } from '@shared/generation'
import type { LlmRetry } from '@shared/llm'
import type { LocalEngineStatus } from '@shared/local-engine'
import type { UpdateStatus } from '@shared/update'
import type { VoiceEngineStatus } from '@shared/voice'
import type { SingerEngineStatus } from '@shared/singer'
import {
  GENERATION_UPDATE_EVENT,
  LLM_DELTA_EVENT,
  LLM_RETRY_EVENT,
  LOCAL_ENGINE_LOG_EVENT,
  LOCAL_ENGINE_STATUS_EVENT,
  STEMS_PROGRESS_EVENT,
  SINGER_LOG_EVENT,
  SINGER_PROGRESS_EVENT,
  SINGER_STATUS_EVENT,
  MENU_COMMAND_EVENT,
  UPDATE_STATUS_EVENT,
  VOICE_LOG_EVENT,
  VOICE_PROGRESS_EVENT,
  VOICE_STATUS_EVENT,
  type IpcChannel,
  type MenuCommand,
  type VibeApi
} from '@shared/ipc-contract'

const invoke = (channel: IpcChannel, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args)

const api: VibeApi = {
  project: {
    defaultParent: () => invoke('project:defaultParent'),
    chooseParent: (current) => invoke('project:chooseParent', current),
    create: (name, parent) => invoke('project:create', name, parent),
    open: () => invoke('project:open'),
    openPath: (dir) => invoke('project:openPath', dir),
    recent: () => invoke('project:recent'),
    forgetRecent: (dir) => invoke('project:forgetRecent', dir),
    save: (dir, project, message) => invoke('project:save', dir, project, message),
    listVersions: (dir) => invoke('project:listVersions', dir),
    loadVersion: (dir, id) => invoke('project:loadVersion', dir, id)
  },
  clips: {
    import: (dir) => invoke('clips:import', dir),
    read: (dir, file) => invoke('clips:read', dir, file),
    write: (dir, file, bytes) => invoke('clips:write', dir, file, bytes)
  },
  generation: {
    providers: () => invoke('generation:providers'),
    enqueue: (dir, providerId, spec) => invoke('generation:enqueue', dir, providerId, spec),
    cancel: (jobId) => invoke('generation:cancel', jobId),
    list: () => invoke('generation:list'),
    onUpdate: (listener) => {
      const handler = (_e: Electron.IpcRendererEvent, job: GenerationJob): void => listener(job)
      ipcRenderer.on(GENERATION_UPDATE_EVENT, handler)
      return () => ipcRenderer.removeListener(GENERATION_UPDATE_EVENT, handler)
    }
  },
  llm: {
    chat: (requestId, req) => invoke('llm:chat', requestId, req),
    cancel: (requestId) => invoke('llm:cancel', requestId),
    listModels: (provider) => invoke('llm:listModels', provider),
    onDelta: (listener) => {
      const handler = (_e: Electron.IpcRendererEvent, requestId: string, text: string): void =>
        listener(requestId, text)
      ipcRenderer.on(LLM_DELTA_EVENT, handler)
      return () => ipcRenderer.removeListener(LLM_DELTA_EVENT, handler)
    },
    onRetry: (listener) => {
      const handler = (_e: Electron.IpcRendererEvent, requestId: string, info: LlmRetry): void =>
        listener(requestId, info)
      ipcRenderer.on(LLM_RETRY_EVENT, handler)
      return () => ipcRenderer.removeListener(LLM_RETRY_EVENT, handler)
    }
  },
  localEngine: {
    status: () => invoke('localEngine:status'),
    install: (variant) => invoke('localEngine:install', variant),
    uninstall: () => invoke('localEngine:uninstall'),
    installStems: () => invoke('localEngine:installStems'),
    start: () => invoke('localEngine:start'),
    stop: () => invoke('localEngine:stop'),
    onStatus: (listener) => {
      const handler = (_e: Electron.IpcRendererEvent, s: LocalEngineStatus): void => listener(s)
      ipcRenderer.on(LOCAL_ENGINE_STATUS_EVENT, handler)
      return () => ipcRenderer.removeListener(LOCAL_ENGINE_STATUS_EVENT, handler)
    },
    onLog: (listener) => {
      const handler = (_e: Electron.IpcRendererEvent, line: string): void => listener(line)
      ipcRenderer.on(LOCAL_ENGINE_LOG_EVENT, handler)
      return () => ipcRenderer.removeListener(LOCAL_ENGINE_LOG_EVENT, handler)
    }
  },
  singer: {
    status: () => invoke('singer:status'),
    install: () => invoke('singer:install'),
    uninstall: () => invoke('singer:uninstall'),
    render: (requestId, dir, ustx) => invoke('singer:render', requestId, dir, ustx),
    cancel: (requestId) => invoke('singer:cancel', requestId),
    onStatus: (listener) => {
      const handler = (_e: Electron.IpcRendererEvent, s: SingerEngineStatus): void => listener(s)
      ipcRenderer.on(SINGER_STATUS_EVENT, handler)
      return () => ipcRenderer.removeListener(SINGER_STATUS_EVENT, handler)
    },
    onLog: (listener) => {
      const handler = (_e: Electron.IpcRendererEvent, line: string): void => listener(line)
      ipcRenderer.on(SINGER_LOG_EVENT, handler)
      return () => ipcRenderer.removeListener(SINGER_LOG_EVENT, handler)
    },
    onProgress: (listener) => {
      const handler = (_e: Electron.IpcRendererEvent, requestId: string, stage: string): void =>
        listener(requestId, stage)
      ipcRenderer.on(SINGER_PROGRESS_EVENT, handler)
      return () => ipcRenderer.removeListener(SINGER_PROGRESS_EVENT, handler)
    }
  },
  voice: {
    status: () => invoke('voice:status'),
    install: () => invoke('voice:install'),
    uninstall: () => invoke('voice:uninstall'),
    list: () => invoke('voice:list'),
    importVoice: () => invoke('voice:import'),
    remove: (id) => invoke('voice:remove', id),
    convert: (requestId, dir, clipFile, voiceId, opts) =>
      invoke('voice:convert', requestId, dir, clipFile, voiceId, opts),
    cancel: (requestId) => invoke('voice:cancel', requestId),
    onStatus: (listener) => {
      const handler = (_e: Electron.IpcRendererEvent, s: VoiceEngineStatus): void => listener(s)
      ipcRenderer.on(VOICE_STATUS_EVENT, handler)
      return () => ipcRenderer.removeListener(VOICE_STATUS_EVENT, handler)
    },
    onLog: (listener) => {
      const handler = (_e: Electron.IpcRendererEvent, line: string): void => listener(line)
      ipcRenderer.on(VOICE_LOG_EVENT, handler)
      return () => ipcRenderer.removeListener(VOICE_LOG_EVENT, handler)
    },
    onProgress: (listener) => {
      const handler = (_e: Electron.IpcRendererEvent, requestId: string, stage: string): void =>
        listener(requestId, stage)
      ipcRenderer.on(VOICE_PROGRESS_EVENT, handler)
      return () => ipcRenderer.removeListener(VOICE_PROGRESS_EVENT, handler)
    }
  },
  stems: {
    separate: (requestId, dir, clipFile) => invoke('stems:separate', requestId, dir, clipFile),
    cancel: (requestId) => invoke('stems:cancel', requestId),
    onProgress: (listener) => {
      const handler = (
        _e: Electron.IpcRendererEvent,
        requestId: string,
        progress: number | null,
        stage: string
      ): void => listener(requestId, progress, stage)
      ipcRenderer.on(STEMS_PROGRESS_EVENT, handler)
      return () => ipcRenderer.removeListener(STEMS_PROGRESS_EVENT, handler)
    }
  },
  settings: {
    get: () => invoke('settings:get'),
    setReplicateToken: (token) => invoke('settings:setReplicateToken', token),
    clearReplicateToken: () => invoke('settings:clearReplicateToken'),
    setHfToken: (token) => invoke('settings:setHfToken', token),
    clearHfToken: () => invoke('settings:clearHfToken'),
    setDefaultProvider: (id) => invoke('settings:setDefaultProvider', id),
    setSingingEngine: (engine) => invoke('settings:setSingingEngine', engine),
    setLocalModel: (id) => invoke('settings:setLocalModel', id),
    setLlm: (patch) => invoke('settings:setLlm', patch),
    setLlmKey: (provider, key) => invoke('settings:setLlmKey', provider, key),
    clearLlmKey: (provider) => invoke('settings:clearLlmKey', provider),
    testLlm: (provider) => invoke('settings:testLlm', provider)
  },
  export: {
    saveFile: (bytes, name, ext) => invoke('export:saveFile', bytes, name, ext),
    chooseFolder: () => invoke('export:chooseFolder'),
    writeInFolder: (token, fileName, bytes) =>
      invoke('export:writeInFolder', token, fileName, bytes)
  },
  app: {
    version: () => invoke('app:version'),
    updateStatus: () => invoke('app:updateStatus'),
    checkForUpdates: () => invoke('app:checkForUpdates'),
    installUpdate: () => invoke('app:installUpdate'),
    onMenuCommand: (listener) => {
      const handler = (_e: Electron.IpcRendererEvent, c: MenuCommand): void => listener(c)
      ipcRenderer.on(MENU_COMMAND_EVENT, handler)
      return () => ipcRenderer.removeListener(MENU_COMMAND_EVENT, handler)
    },
    onUpdateStatus: (listener) => {
      const handler = (_e: Electron.IpcRendererEvent, status: UpdateStatus): void =>
        listener(status)
      ipcRenderer.on(UPDATE_STATUS_EVENT, handler)
      return () => ipcRenderer.removeListener(UPDATE_STATUS_EVENT, handler)
    },
    whatsNew: () => invoke('app:whatsNew'),
    setBusy: (busy) => invoke('app:setBusy', busy),
    openLogs: () => invoke('app:openLogs')
  }
}

contextBridge.exposeInMainWorld('vibe', api)
