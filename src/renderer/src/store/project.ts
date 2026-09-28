import { create } from 'zustand'
import {
  createTrack,
  newId,
  secondsToBeats,
  type Project,
  type Region,
  type VersionMeta
} from '@shared/project'
import {
  baseMessage,
  emptyUndo,
  recordChange,
  takeRedo,
  takeUndo,
  type UndoState
} from '@shared/history'
import { encodeWav } from '@shared/wav'
import { engine, renderOffline } from '../audio/engine'

interface ProjectState {
  dir: string | null
  project: Project | null
  /** Último estado guardado en disco (para no crear versiones sin cambios). */
  saved: Project | null
  versions: VersionMeta[]
  history: UndoState
  /** Se incrementa al cargar audio para que las formas de onda se redibujen. */
  clipsLoaded: number
  newProject(name: string): Promise<void>
  openProject(): Promise<void>
  /** Cambio temporal (p. ej. mientras arrastras un fader): se oye pero no crea versión. */
  preview(next: Project): void
  /** Guarda un cambio del usuario (o del agente) como versión nueva y lo hace deshacible. */
  commit(next: Project, message: string): Promise<void>
  undo(): Promise<void>
  redo(): Promise<void>
  /** Vuelve al estado que había justo después de la versión indicada. */
  checkout(versionId: number): Promise<void>
  loadClips(): Promise<void>
  importAudio(): Promise<void>
  exportWav(): Promise<string | null>
}

export const useProject = create<ProjectState>((set, get) => ({
  dir: null,
  project: null,
  saved: null,
  versions: [],
  history: emptyUndo,
  clipsLoaded: 0,

  async newProject(name) {
    const res = await window.vibe.project.create(name)
    if (!res) return
    engine.stop()
    engine.buffers.clear()
    set({
      ...res,
      saved: res.project,
      history: emptyUndo,
      versions: await window.vibe.project.listVersions(res.dir)
    })
  },

  async openProject() {
    const res = await window.vibe.project.open()
    if (!res) return
    engine.stop()
    engine.buffers.clear()
    set({
      ...res,
      saved: res.project,
      history: emptyUndo,
      versions: await window.vibe.project.listVersions(res.dir)
    })
    await get().loadClips()
  },

  preview(next) {
    set({ project: next })
  },

  async commit(next, message) {
    const { saved, history } = get()
    if (!saved || !(await persist(next, message))) return
    set({ history: recordChange(history, saved, message) })
  },

  async undo() {
    const { saved, history } = get()
    const step = saved && takeUndo(history, saved)
    if (!step) return
    set({ history: step.state })
    await persist(step.entry.project, `Deshacer: ${baseMessage(step.entry.message)}`)
    await get().loadClips()
  },

  async redo() {
    const { saved, history } = get()
    const step = saved && takeRedo(history, saved)
    if (!step) return
    set({ history: step.state })
    await persist(step.entry.project, `Rehacer: ${baseMessage(step.entry.message)}`)
    await get().loadClips()
  },

  async checkout(versionId) {
    const { dir, versions } = get()
    if (!dir) return
    const snapshot = await window.vibe.project.loadVersion(dir, versionId)
    const label = baseMessage(versions.find((v) => v.id === versionId)?.message ?? '')
    // Volver atrás crea una versión nueva (como `git revert`), nunca borra historia,
    // y se puede deshacer con Ctrl+Z como cualquier otro cambio.
    await get().commit(snapshot, `Vuelta a v${versionId}: ${label}`)
    await get().loadClips()
  },

  async loadClips() {
    const { dir, project } = get()
    if (!dir || !project) return
    const results = await Promise.allSettled(
      Object.values(project.clips).map((c) => engine.loadClip(dir, c))
    )
    const failed = results.filter((r) => r.status === 'rejected').length
    if (failed > 0) console.warn(`${failed} clip(s) no se pudieron decodificar`)
    set((s) => ({ clipsLoaded: s.clipsLoaded + 1 }))
  },

  async importAudio() {
    const { dir, project } = get()
    if (!dir || !project) return
    const files = await window.vibe.clips.import(dir)
    if (files.length === 0) return

    const next: Project = { ...project, clips: { ...project.clips }, tracks: [...project.tracks] }
    const imported: string[] = []
    for (const f of files) {
      try {
        const buffer = await engine.loadClip(dir, {
          id: f.clipId,
          file: f.file,
          durationSec: 0,
          spec: null,
          provider: 'import'
        })
        next.clips[f.clipId] = {
          id: f.clipId,
          file: f.file,
          durationSec: buffer.duration,
          spec: null,
          provider: 'import'
        }
        const region: Region = {
          id: newId('rgn'),
          clipId: f.clipId,
          startBeat: 0,
          offsetSec: 0,
          lengthSec: buffer.duration,
          fadeInSec: 0,
          fadeOutSec: 0
        }
        next.tracks.push({ ...createTrack(f.name, 'full'), regions: [region] })
        imported.push(f.name)
      } catch (err) {
        console.error(`No se pudo decodificar ${f.name}`, err)
        window.alert(`No se pudo leer "${f.name}". ¿Es un formato de audio soportado?`)
      }
    }
    if (imported.length === 0) return
    const bars = Math.ceil(
      secondsToBeats(engine.buffers.get(files[0].clipId)?.duration ?? 0, next.bpm) /
        next.timeSignature[0]
    )
    await get().commit(next, `Importado ${imported.join(', ')} (${bars} compases)`)
    set((s) => ({ clipsLoaded: s.clipsLoaded + 1 }))
  },

  async exportWav() {
    const { project } = get()
    if (!project) return null
    const rendered = await renderOffline(project)
    const channels = Array.from({ length: rendered.numberOfChannels }, (_, i) =>
      rendered.getChannelData(i)
    )
    return window.vibe.export.saveWav(encodeWav(channels, rendered.sampleRate), project.name)
  }
}))

/**
 * Guarda `next` en disco como versión nueva. Devuelve false si no había cambios
 * respecto a lo último guardado (así no se crean versiones vacías).
 */
async function persist(next: Project, message: string): Promise<boolean> {
  const { dir, saved } = useProject.getState()
  useProject.setState({ project: next })
  if (!dir || JSON.stringify(next) === JSON.stringify(saved)) return false
  useProject.setState({ saved: next })
  const meta = await window.vibe.project.save(dir, next, message)
  useProject.setState((s) => ({ versions: [...s.versions, meta] }))
  return true
}
