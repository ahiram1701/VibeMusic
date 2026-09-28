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
import { planRetempo } from '@shared/retempo'
import { timeStretch } from '@shared/stretch'
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
  /**
   * Cambia tempo (y tonalidad) estirando el audio generado para que siga ocupando
   * los mismos compases. Devuelve cuántos clips se ajustaron y cuántos no se pudieron
   * (audio importado, cuyo tempo no se conoce).
   */
  setTempo(
    bpm: number,
    opts?: { key?: string; messagePrefix?: string }
  ): Promise<{ adjusted: number; skipped: number }>
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
    if (!saved || !stage(next)) return
    // Se registra en "deshacer" YA, antes de esperar al disco: si el usuario pulsa
    // Ctrl+Z durante el guardado, debe deshacer este cambio y no el anterior.
    set({ history: recordChange(history, saved, message) })
    await write(next, message)
  },

  async undo() {
    const { saved, history } = get()
    const step = saved && takeUndo(history, saved)
    if (!step) return
    set({ history: step.state })
    if (stage(step.entry.project)) {
      await write(step.entry.project, `Deshacer: ${baseMessage(step.entry.message)}`)
    }
    await get().loadClips()
  },

  async redo() {
    const { saved, history } = get()
    const step = saved && takeRedo(history, saved)
    if (!step) return
    set({ history: step.state })
    if (stage(step.entry.project)) {
      await write(step.entry.project, `Rehacer: ${baseMessage(step.entry.message)}`)
    }
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

  async setTempo(bpm, opts = {}) {
    const { dir, project } = get()
    if (!dir || !project) return { adjusted: 0, skipped: 0 }
    const plan = planRetempo(project, bpm)
    const next = { ...plan.project, key: opts.key ?? project.key }

    for (const job of plan.jobs) {
      const source = project.clips[job.sourceClipId]
      const buffer = engine.buffers.get(source.id) ?? (await engine.loadClip(dir, source))
      const input = Array.from({ length: buffer.numberOfChannels }, (_, i) =>
        buffer.getChannelData(i)
      )
      const stretched = timeStretch(input, buffer.sampleRate, job.ratio)
      const file = next.clips[job.newClipId].file
      await window.vibe.clips.write(dir, file, encodeWav(stretched, buffer.sampleRate))
      const out = engine.ctx.createBuffer(stretched.length, stretched[0].length, buffer.sampleRate)
      stretched.forEach((ch, i) => out.copyToChannel(ch as Float32Array<ArrayBuffer>, i))
      engine.buffers.set(job.newClipId, out)
      // Duración real tras el estirado (puede diferir en alguna muestra).
      next.clips[job.newClipId] = { ...next.clips[job.newClipId], durationSec: out.duration }
    }

    const parts = [`Tempo ${bpm} BPM`]
    if (opts.key && opts.key !== project.key) parts.push(opts.key)
    if (plan.jobs.length > 0) parts.push(`${plan.jobs.length} clip(s) ajustados`)
    await get().commit(next, `${opts.messagePrefix ?? ''}${parts.join(' · ')}`)
    set((s) => ({ clipsLoaded: s.clipsLoaded + 1 }))
    return { adjusted: plan.jobs.length, skipped: plan.skipped.length }
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

// Guardar un cambio tiene dos mitades:
//   stage(): síncrono. Aplica el cambio en memoria (pantalla, audio, "deshacer").
//   write(): asíncrono. Lo escribe en disco como versión nueva.
// Separarlas garantiza que el estado en memoria nunca va por detrás de lo que el
// usuario ve, aunque el disco tarde.

/** Aplica `next` en memoria. Devuelve false si no cambia nada (sin versiones vacías). */
function stage(next: Project): boolean {
  const { dir, saved } = useProject.getState()
  useProject.setState({ project: next })
  if (!dir || JSON.stringify(next) === JSON.stringify(saved)) return false
  useProject.setState({ saved: next })
  return true
}

/** Escribe en disco la versión (el proceso principal las guarda en orden de llegada). */
async function write(next: Project, message: string): Promise<void> {
  const { dir } = useProject.getState()
  if (!dir) return
  const meta = await window.vibe.project.save(dir, next, message)
  useProject.setState((s) => ({ versions: [...s.versions, meta] }))
}
