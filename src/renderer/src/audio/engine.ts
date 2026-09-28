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
  master: GainNode
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
  return { master, sources, tracks }
}

class AudioEngine {
  readonly ctx = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: 'interactive' })
  readonly buffers = new Map<string, AudioBuffer>()
  private graph: Graph | null = null
  private startedAt = 0
  private fromSec = 0
  private endSec = 0
  playing = false

  async loadClip(dir: string, clip: Clip): Promise<AudioBuffer> {
    const cached = this.buffers.get(clip.id)
    if (cached) return cached
    const bytes = await window.vibe.clips.read(dir, clip.file)
    const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    const buffer = await this.ctx.decodeAudioData(data as ArrayBuffer)
    this.buffers.set(clip.id, buffer)
    return buffer
  }

  get positionSec(): number {
    if (!this.playing) return this.fromSec
    const pos = this.fromSec + this.ctx.currentTime - this.startedAt
    if (pos >= this.endSec) {
      this.stop()
      this.fromSec = 0
      return 0
    }
    return pos
  }

  async play(project: Project, fromSec = this.positionSec): Promise<void> {
    await this.ctx.resume()
    this.teardown()
    this.graph = buildGraph(this.ctx, project, this.buffers, fromSec)
    this.startedAt = this.ctx.currentTime
    this.fromSec = fromSec
    this.endSec = projectEndSec(project)
    this.playing = true
  }

  stop(): void {
    this.fromSec = this.positionSec
    this.teardown()
    this.playing = false
  }

  seek(project: Project, sec: number): void {
    if (this.playing) void this.play(project, sec)
    else this.fromSec = sec
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

  private teardown(): void {
    if (!this.graph) return
    for (const src of this.graph.sources) {
      try {
        src.stop()
      } catch {
        // ya había terminado
      }
    }
    this.graph.master.disconnect()
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
