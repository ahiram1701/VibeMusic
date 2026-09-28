import { app, dialog, ipcMain } from 'electron'
import type { IpcChannel } from '@shared/ipc-contract'
import { createProject, type Project } from '@shared/project'
import {
  initProjectDir,
  listVersions,
  loadProject,
  loadVersion,
  saveProject
} from './project/store'

function handle(channel: IpcChannel, fn: (...args: never[]) => unknown): void {
  ipcMain.handle(channel, (_event, ...args) => fn(...(args as never[])))
}

export function registerIpc(): void {
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
  handle('app:version', () => app.getVersion())
}
