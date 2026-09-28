import { contextBridge, ipcRenderer } from 'electron'
import type { GenerationJob } from '@shared/generation'
import {
  GENERATION_UPDATE_EVENT,
  LLM_DELTA_EVENT,
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
    onDelta: (listener) => {
      const handler = (_e: Electron.IpcRendererEvent, requestId: string, text: string): void =>
        listener(requestId, text)
      ipcRenderer.on(LLM_DELTA_EVENT, handler)
      return () => ipcRenderer.removeListener(LLM_DELTA_EVENT, handler)
    }
  },
  settings: {
    get: () => invoke('settings:get'),
    setReplicateToken: (token) => invoke('settings:setReplicateToken', token),
    clearReplicateToken: () => invoke('settings:clearReplicateToken'),
    setDefaultProvider: (id) => invoke('settings:setDefaultProvider', id),
    setLlm: (patch) => invoke('settings:setLlm', patch),
    setLlmKey: (provider, key) => invoke('settings:setLlmKey', provider, key),
    clearLlmKey: (provider) => invoke('settings:clearLlmKey', provider),
    testOllama: () => invoke('settings:testOllama')
  },
  export: {
    saveWav: (bytes, name) => invoke('export:saveWav', bytes, name)
  },
  app: {
    version: () => invoke('app:version')
  }
}

contextBridge.exposeInMainWorld('vibe', api)
