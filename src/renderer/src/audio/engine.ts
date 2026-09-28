import type { Clip, Project } from '@shared/project'
import { beatsToSeconds } from '@shared/project'
import { dbToGain, isTrackAudible } from '@shared/mixer'
import { projectEndSec } from '@shared/timeline'

export const SAMPLE_RATE = 48000

interface TrackNodes {
  gain: GainNode
  pan: StereoPannerNode
}

interface Graph {
  output: AudioNode
  sources: AudioBufferSourceNode[]
  tracks: Map<string, TrackNodes>
}

/**
 * Construye el grafo de audio de la canción a partir de `fromSec`.
 *   región → fade → [gain → pan] de la pista → master → limitador → salida
 * Se usa igual en tiempo real (AudioContext) y al exportar (OfflineAudioContext),
 * así lo que oyes es exactamente lo que exportas.
 */
function buildGraph(
  ctx: BaseAudioContext,
  project: Project,
  buffers: Map<string, AudioBuffer>,
  fromSec: number
): Graph {
  const limiter = ctx.createDynamicsCompressor()
  limiter.threshold.value = -1
  limiter.knee.value = 0
  limiter.ratio.value = 20
  limiter.attack.value = 0.003
  limiter.release.value = 0.1
  limiter.connect(ctx.destination)

  const master = ctx.createGain()
  master.connect(limiter)

  const sources: AudioBufferSourceNode[] = []
  const tracks = new Map<string, TrackNodes>()
  const now = ctx.currentTime

  for (const track of project.tracks) {
    const gain = ctx.createGain()
    const pan = ctx.createStereoPanner()
    gain.gain.value = isTrackAudible(track, project.tracks) ? dbToGain(track.gainDb) : 0
    pan.pan.value = track.pan
    gain.connect(pan).connect(master)
    tracks.set(track.id, { gain, pan })

    for (const region of track.regions) {
      const buffer = buffers.get(region.clipId)
      if (!buffer) continue
      const startSec = beatsToSeconds(region.startBeat, project.bpm)
      const endSec = startSec + region.lengthSec
      if (endSec <= fromSec) continue

      // Si empezamos a mitad de la región, saltamos esa parte del clip.
      const skip = Math.max(0, fromSec - startSec)
      const when = now + Math.max(0, startSec - fromSec)
      const duration = region.lengthSec - skip

      const fade = ctx.createGain()
      if (region.fadeInSec > 0 && skip === 0) {
        fade.gain.setValueAtTime(0, when)
        fade.gain.linearRampToValueAtTime(1, when + region.fadeInSec)
      }
      if (region.fadeOutSec > 0) {
        fade.gain.setValueAtTime(1, when + duration - region.fadeOutSec)
        fade.gain.linearRampToValueAtTime(0, when + duration)
      }
      fade.connect(gain)

      const src = ctx.createBufferSource()
      src.buffer = buffer
      src.connect(fade)
      src.start(when, region.offsetSec + skip, duration)
      sources.push(src)
    }
  }
  return { output: limiter, sources, tracks }
}

export interface LoopRange {
  startSec: number
  endSec: number
  /** Qué se está repitiendo (p. ej. el id de la sección), para resaltarlo en la UI. */
  id: string
}

class AudioEngine {
  readonly ctx = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: 'interactive' })
  readonly buffers = new Map<string, AudioBuffer>()
  private graph: Graph | null = null
  private startedAt = 0
  private fromSec = 0
  private endSec = 0
  private playing = false
  /** Cambia en cada play/stop: descarta un play() antiguo que termine tarde. */
  private session = 0
  private watchdog = 0
  private listeners = new Set<() => void>()
  /** Bucle activo (p. ej. una sección) o null. */
  private loop: LoopRange | null = null
  private lastProject: Project | null = null

  async loadClip(dir: string, clip: Clip): Promise<AudioBuffer> {
    const cached = this.buffers.get(clip.id)
    if (cached) return cached
    const bytes = await window.vibe.clips.read(dir, clip.file)
    const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    const buffer = await this.ctx.decodeAudioData(data as ArrayBuffer)
    this.buffers.set(clip.id, buffer)
    return buffer
  }

  // --- Estado observable (para useSyncExternalStore en React) ---

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  isPlaying = (): boolean => this.playing

  /** Bucle activo (referencia estable mientras no cambie, apta para useSyncExternalStore). */
  getLoop = (): LoopRange | null => this.loop

  /** Activa o quita el bucle. Si está sonando, salta al inicio del bucle. */
  setLoop(project: Project, loop: LoopRange | null): void {
    this.loop = loop
    this.emit()
    if (loop && this.playing) void this.play(project, loop.startSec)
    else if (loop) this.seek(project, loop.startSec)
  }

  private emit(): void {
    for (const fn of this.listeners) fn()
  }

  /**
   * Posición actual en segundos. Es una lectura pura: nunca cambia el estado
   * (antes llamaba a stop() al llegar al final y entraba en bucle infinito).
   * Resta la latencia de salida para que el cursor coincida con lo que se oye.
   */
  get positionSec(): number {
    if (!this.playing) return this.fromSec
    const latency = this.ctx.outputLatency || this.ctx.baseLatency || 0
    const elapsed = Math.max(0, this.ctx.currentTime - this.startedAt - latency)
    return Math.min(this.fromSec + elapsed, this.endSec)
  }

  async play(project: Project, fromSec = this.positionSec): Promise<void> {
    const loop = this.loop
    const endSec = loop ? loop.endSec : projectEndSec(project)
    if (endSec <= 0) return // nada que reproducir
    if (loop && (fromSec < loop.startSec || fromSec >= loop.endSec)) fromSec = loop.startSec
    else if (fromSec >= endSec) fromSec = 0 // al final: volver a empezar
    this.lastProject = project

    const session = ++this.session
    this.teardown()
    this.playing = true
    this.fromSec = fromSec
    this.endSec = endSec
    this.emit()

    await this.ctx.resume()
    if (session !== this.session) return // hubo un stop/play mientras tanto

    this.graph = buildGraph(this.ctx, project, this.buffers, fromSec)
    this.startedAt = this.ctx.currentTime
    this.watchEnd(session)
  }

  stop(): void {
    this.fromSec = this.positionSec
    this.session++
    this.teardown()
    if (this.playing) {
      this.playing = false
      this.emit()
    }
  }

  toggle(project: Project): void {
    if (this.playing) this.stop()
    else void this.play(project)
  }

  seek(project: Project, sec: number): void {
    const to = Math.max(0, sec)
    if (this.playing) void this.play(project, to)
    else {
      this.fromSec = to
      this.emit()
    }
  }

  /** Aplica volumen/pan/mute/solo en caliente, sin reiniciar la reproducción. */
  applyMix(project: Project): void {
    if (!this.graph) return
    const t = this.ctx.currentTime
    for (const track of project.tracks) {
      const nodes = this.graph.tracks.get(track.id)
      if (!nodes) continue
      const target = isTrackAudible(track, project.tracks) ? dbToGain(track.gainDb) : 0
      nodes.gain.gain.setTargetAtTime(target, t, 0.01)
      nodes.pan.pan.setTargetAtTime(track.pan, t, 0.01)
    }
  }

  /** Detecta el final de la canción: para y deja el cursor al inicio. */
  private watchEnd(session: number): void {
    cancelAnimationFrame(this.watchdog)
    const check = (): void => {
      if (session !== this.session) return
      if (this.positionSec >= this.endSec) {
        // En bucle: vuelve al inicio sin parar. Si no, para y deja el cursor al inicio.
        if (this.loop && this.lastProject) {
          void this.play(this.lastProject, this.loop.startSec)
          return
        }
        this.stop()
        this.fromSec = 0
        this.emit()
        return
      }
      this.watchdog = requestAnimationFrame(check)
    }
    this.watchdog = requestAnimationFrame(check)
  }

  private teardown(): void {
    cancelAnimationFrame(this.watchdog)
    if (!this.graph) return
    for (const src of this.graph.sources) {
      try {
        src.stop()
      } catch {
        // ya había terminado
      }
    }
    this.graph.output.disconnect()
    this.graph = null
  }
}

export const engine = new AudioEngine()

/** Renderiza la canción completa fuera de tiempo real para exportarla. */
export async function renderOffline(project: Project): Promise<AudioBuffer> {
  const length = Math.max(1, Math.ceil(projectEndSec(project) * SAMPLE_RATE))
  const ctx = new OfflineAudioContext(2, length, SAMPLE_RATE)
  buildGraph(ctx, project, engine.buffers, 0)
  return ctx.startRendering()
}

/** Firma de lo que obliga a reprogramar las fuentes (posiciones/clips/tempo), no la mezcla. */
export function arrangementKey(project: Project): string {
  return JSON.stringify([project.bpm, project.tracks.map((t) => [t.id, t.regions])])
}
