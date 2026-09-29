import { contextBridge, ipcRenderer } from 'electron'
import type { GenerationJob } from '@shared/generation'
import type { LocalEngineStatus } from '@shared/local-engine'
import {
  GENERATION_UPDATE_EVENT,
  LLM_DELTA_EVENT,
  LOCAL_ENGINE_LOG_EVENT,
  LOCAL_ENGINE_STATUS_EVENT,
  STEMS_PROGRESS_EVENT,
  type IpcChannel,
  type VibeApi
} from '@shared/ipc-contract'

const invoke = (channel: IpcChannel, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args)

const api: VibeApi = {
  project: {
    create: (name) => invoke('project:create', name),
    open: () => invoke('project:open'),
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
    setDefaultProvider: (id) => invoke('settings:setDefaultProvider', id),
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
    version: () => invoke('app:version')
  }
}

contextBridge.exposeInMainWorld('vibe', api)
