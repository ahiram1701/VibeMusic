import { create } from 'zustand'
import { conformAudio } from '@shared/conform'
import type { AppSettings, GenerationJob, ProviderId, ProviderInfo } from '@shared/generation'
import {
  createTrack,
  newId,
  type GenerationSpec,
  type Project,
  type Region,
  type TrackRole
} from '@shared/project'
import { barsToSeconds } from '@shared/prompt'
import { encodeWav } from '@shared/wav'
import { engine } from '../audio/engine'
import { ROLE_LABELS } from '../labels'
import { useProject } from './project'

/** Dónde colocar el resultado cuando termine. */
interface Placement {
  atBeat: number
  /** null = crear una pista nueva. */
  trackId: string | null
  /** Nombre de la pista nueva (por defecto, el tipo: "Batería"…). */
  trackName?: string
  bars: number
  /** Prefijo del mensaje en el historial (p. ej. 🤖 si lo pidió el productor). */
  messagePrefix?: string
  /** Variación: la región nueva sustituye a esta (mismo sitio y pista). */
  replaceRegionId?: string
  /** Texto del historial en lugar del genérico "Generado …". */
  message?: string
  parentClipId?: string
}

export interface JobView {
  job: GenerationJob
  placement: Placement
  /** Ya se añadió al proyecto. */
  added: boolean
  /** Error al procesar el resultado en la app (después de generarlo). */
  localError?: string
}

export interface GenerateInput {
  prompt: string
  role: TrackRole
  bars: number
  providerId: ProviderId
  atBeat: number
  trackId: string | null
  trackName?: string
  messagePrefix?: string
  seed?: number
  replaceRegionId?: string
  message?: string
  /** Variación/continuación: se parte de un clip existente. */
  mode?: GenerationSpec['mode']
  conditioning?: GenerationSpec['conditioning']
  parentClipId?: string
}

/** Resultado de una generación ya colocada en el timeline. */
export interface GenerationResult {
  trackId: string
  regionId: string
  clipId: string
}

interface GenerationState {
  providers: ProviderInfo[]
  settings: AppSettings | null
  jobs: Record<string, JobView>
  init(): Promise<void>
  refresh(): Promise<void>
  /** Encola una generación y devuelve el id del trabajo. */
  generate(input: GenerateInput): Promise<string>
  cancel(jobId: string): Promise<void>
  retry(jobId: string): Promise<void>
  dismiss(jobId: string): void
}

let unsubscribe: (() => void) | null = null
const finalizing = new Set<string>()
/** Actualizaciones que llegan antes de que `generate()` registre el trabajo. */
const early = new Map<string, GenerationJob>()
/** Quien espera el resultado de un trabajo (p. ej. el agente productor). */
const waiters = new Map<string, { resolve(r: GenerationResult): void; reject(e: Error): void }>()
const settled = new Map<string, GenerationResult | Error>()

function settle(jobId: string, outcome: GenerationResult | Error): void {
  const w = waiters.get(jobId)
  waiters.delete(jobId)
  if (!w) {
    settled.set(jobId, outcome)
    return
  }
  if (outcome instanceof Error) w.reject(outcome)
  else w.resolve(outcome)
}

/** Espera a que el trabajo termine y su audio esté en el timeline. */
export function waitForJob(jobId: string): Promise<GenerationResult> {
  const done = settled.get(jobId)
  if (done) {
    settled.delete(jobId)
    return done instanceof Error ? Promise.reject(done) : Promise.resolve(done)
  }
  return new Promise((resolve, reject) => waiters.set(jobId, { resolve, reject }))
}

export const useGeneration = create<GenerationState>((set, get) => ({
  providers: [],
  settings: null,
  jobs: {},

  async init() {
    if (!unsubscribe) {
      unsubscribe = window.vibe.generation.onUpdate((job) => {
        const view = get().jobs[job.id]
        if (!view) {
          early.set(job.id, job)
          return
        }
        set((s) => ({ jobs: { ...s.jobs, [job.id]: { ...view, job } } }))
        if (job.status === 'done') void finalize(job.id)
        if (job.status === 'error') settle(job.id, new Error(job.error ?? 'Error al generar'))
        if (job.status === 'cancelled') settle(job.id, new Error('Generación cancelada'))
      })
    }
    await get().refresh()
  },

  async refresh() {
    const [providers, settings] = await Promise.all([
      window.vibe.generation.providers(),
      window.vibe.settings.get()
    ])
    set({ providers, settings })
  },

  async generate(input) {
    const { dir, project } = useProject.getState()
    if (!dir || !project) throw new Error('No hay ningún proyecto abierto')
    const spec: GenerationSpec = {
      prompt: input.prompt.trim(),
      role: input.role,
      bpm: project.bpm,
      key: project.key,
      durationSec: barsToSeconds(input.bars, project),
      mode: input.mode ?? 'text',
      ...(input.conditioning && { conditioning: input.conditioning }),
      // Siempre guardamos una semilla: así cualquier clip se puede volver a generar igual.
      seed: input.seed ?? Math.floor(Math.random() * 2 ** 31)
    }
    const queued = await window.vibe.generation.enqueue(dir, input.providerId, spec)
    const job = early.get(queued.id) ?? queued
    early.delete(queued.id)
    set((s) => ({
      jobs: {
        ...s.jobs,
        [job.id]: {
          job,
          placement: {
            atBeat: input.atBeat,
            trackId: input.trackId,
            trackName: input.trackName,
            bars: input.bars,
            messagePrefix: input.messagePrefix,
            replaceRegionId: input.replaceRegionId,
            message: input.message,
            parentClipId: input.parentClipId
          },
          added: false
        }
      }
    }))
    if (job.status === 'done') void finalize(job.id)
    return job.id
  },

  async cancel(jobId) {
    await window.vibe.generation.cancel(jobId)
  },

  async retry(jobId) {
    const view = get().jobs[jobId]
    if (!view) return
    get().dismiss(jobId)
    await get().generate({
      prompt: view.job.spec.prompt,
      role: view.job.spec.role,
      bars: view.placement.bars,
      providerId: view.job.providerId,
      atBeat: view.placement.atBeat,
      trackId: view.placement.trackId,
      trackName: view.placement.trackName,
      messagePrefix: view.placement.messagePrefix,
      replaceRegionId: view.placement.replaceRegionId,
      message: view.placement.message,
      parentClipId: view.placement.parentClipId,
      mode: view.job.spec.mode,
      conditioning: view.job.spec.conditioning
    })
  },

  dismiss(jobId) {
    set((s) => {
      const jobs = { ...s.jobs }
      delete jobs[jobId]
      return { jobs }
    })
  }
}))

/**
 * Convierte el audio en bruto del proveedor en un clip del proyecto:
 * decodifica (a 48 kHz), lo conforma a la duración exacta en compases,
 * lo guarda como WAV y lo coloca en el timeline como un cambio deshacible.
 */
async function finalize(jobId: string): Promise<void> {
  if (finalizing.has(jobId)) return
  finalizing.add(jobId)
  const view = useGeneration.getState().jobs[jobId]
  const setView = (patch: Partial<JobView>): void =>
    useGeneration.setState((s) => ({
      jobs: s.jobs[jobId] ? { ...s.jobs, [jobId]: { ...s.jobs[jobId], ...patch } } : s.jobs
    }))

  try {
    const { dir } = useProject.getState()
    const { job, placement } = view
    if (!job.rawFile || dir !== job.dir) {
      throw new Error('El proyecto cambió antes de terminar la generación')
    }

    const bytes = await window.vibe.clips.read(dir, job.rawFile)
    const decoded = await engine.ctx.decodeAudioData(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    )
    const source = Array.from({ length: decoded.numberOfChannels }, (_, i) =>
      decoded.getChannelData(i)
    )
    // Algunos motores devuelven el fragmento de partida antes del audio nuevo: fuera.
    const skip = Math.round((job.trimStartSec ?? 0) * decoded.sampleRate)
    const fresh = skip > 0 ? source.map((ch) => ch.subarray(Math.min(skip, ch.length))) : source
    const stereo = fresh.length === 1 ? [fresh[0], fresh[0]] : fresh.slice(0, 2)
    const channels = conformAudio(stereo, {
      targetSec: job.spec.durationSec,
      sampleRate: decoded.sampleRate
    })

    const clipId = newId('clp')
    const file = `clips/${clipId}.wav`
    await window.vibe.clips.write(dir, file, encodeWav(channels, decoded.sampleRate))

    const buffer = engine.ctx.createBuffer(2, channels[0].length, decoded.sampleRate)
    channels.forEach((ch, i) => buffer.copyToChannel(ch as Float32Array<ArrayBuffer>, i))
    engine.buffers.set(clipId, buffer)

    // Se lee el proyecto *ahora* (no al empezar): el usuario pudo editar mientras tanto.
    const project = useProject.getState().project!
    const region: Region = {
      id: newId('rgn'),
      clipId,
      startBeat: placement.atBeat,
      offsetSec: 0,
      lengthSec: buffer.duration,
      fadeInSec: 0,
      fadeOutSec: 0
    }
    const replaced =
      placement.replaceRegionId &&
      project.tracks.find((t) => t.regions.some((r) => r.id === placement.replaceRegionId))
    const target =
      replaced || (placement.trackId && project.tracks.find((t) => t.id === placement.trackId))
    const label = ROLE_LABELS[job.spec.role]
    const newTrack = target
      ? null
      : { ...createTrack(placement.trackName?.trim() || label, job.spec.role), regions: [region] }
    const next: Project = {
      ...project,
      clips: {
        ...project.clips,
        [clipId]: {
          id: clipId,
          file,
          durationSec: buffer.duration,
          spec: job.spec,
          provider: job.providerId,
          ...(placement.parentClipId && { parentClipId: placement.parentClipId })
        }
      },
      tracks: target
        ? project.tracks.map((t) =>
            t.id === target.id
              ? {
                  ...t,
                  regions: [...t.regions.filter((r) => r.id !== placement.replaceRegionId), region]
                }
              : t
          )
        : [...project.tracks, newTrack!]
    }
    const short = job.spec.prompt.length > 40 ? `${job.spec.prompt.slice(0, 40)}…` : job.spec.prompt
    await useProject
      .getState()
      .commit(
        next,
        placement.message
          ? `${placement.messagePrefix ?? ''}${placement.message}`
          : `${placement.messagePrefix ?? ''}Generado ${label.toLowerCase()}: "${short}" (${placement.bars} compases)`
      )
    useProject.setState((s) => ({ clipsLoaded: s.clipsLoaded + 1 }))
    setView({ added: true })
    settle(jobId, { trackId: target ? target.id : newTrack!.id, regionId: region.id, clipId })
  } catch (err) {
    console.error('No se pudo añadir el audio generado', err)
    const message = err instanceof Error ? err.message : String(err)
    setView({ localError: message })
    settle(jobId, new Error(`No se pudo añadir el audio: ${message}`))
  } finally {
    finalizing.delete(jobId)
  }
}
