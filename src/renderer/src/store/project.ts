import { create } from 'zustand'
import type { Project, VersionMeta } from '@shared/project'

interface ProjectState {
  dir: string | null
  project: Project | null
  versions: VersionMeta[]
  newProject(name: string): Promise<void>
  openProject(): Promise<void>
  commit(next: Project, message: string): Promise<void>
  checkout(versionId: number): Promise<void>
}

export const useProject = create<ProjectState>((set, get) => ({
  dir: null,
  project: null,
  versions: [],

  async newProject(name) {
    const res = await window.vibe.project.create(name)
    if (!res) return
    set({ ...res, versions: await window.vibe.project.listVersions(res.dir) })
  },

  async openProject() {
    const res = await window.vibe.project.open()
    if (!res) return
    set({ ...res, versions: await window.vibe.project.listVersions(res.dir) })
  },

  async commit(next, message) {
    const { dir } = get()
    if (!dir) return
    const meta = await window.vibe.project.save(dir, next, message)
    set((s) => ({ project: next, versions: [...s.versions, meta] }))
  },

  async checkout(versionId) {
    const { dir, versions } = get()
    if (!dir) return
    const snapshot = await window.vibe.project.loadVersion(dir, versionId)
    const label = versions.find((v) => v.id === versionId)?.message ?? ''
    // Volver atrás crea una versión nueva (como `git revert`), nunca borra historia.
    await get().commit(snapshot, `Restaurada v${versionId}: ${label}`)
  }
}))
