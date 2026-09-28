import { contextBridge, ipcRenderer } from 'electron'
import type { IpcChannel, VibeApi } from '@shared/ipc-contract'

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
    read: (dir, file) => invoke('clips:read', dir, file)
  },
  export: {
    saveWav: (bytes, name) => invoke('export:saveWav', bytes, name)
  },
  app: {
    version: () => invoke('app:version')
  }
}

contextBridge.exposeInMainWorld('vibe', api)
