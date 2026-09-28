import { writeFile } from 'node:fs/promises'
import type { GenerationSpec, TrackRole } from '@shared/project'
import { encodeWav } from '@shared/wav'
import { sleep, throwIfAborted, type AudioProvider } from './types'

// Proveedor "Demo": un sintetizador sencillo SIN IA. Genera patrones por rol en el
// tempo y la tonalidad del proyecto. Sirve para probar todo el flujo gratis y sin
// conexión, y como proveedor falso en los tests.

const SR = 48000
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const FLATS: Record<string, string> = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#' }

/** "A minor" → { root: 57 (La3), minor: true }. Por defecto Do menor. */
export function parseKey(key: string): { root: number; minor: boolean } {
  const m = /^\s*([A-G][#b]?)\s*(m|min|minor|menor)?/i.exec(key)
  if (!m) return { root: 48, minor: true }
  const name = m[1][0].toUpperCase() + (m[1][1] ?? '')
  const idx = NOTE_NAMES.indexOf(FLATS[name] ?? name)
  const minor = !!m[2] || /minor|menor/i.test(key)
  return { root: 48 + Math.max(0, idx), minor }
}

const midiToHz = (n: number): number => 440 * Math.pow(2, (n - 69) / 12)

/** Generador pseudoaleatorio con semilla (mulberry32): misma semilla → mismo audio. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function synthesize(spec: GenerationSpec, seconds: number): Float32Array {
  const out = new Float32Array(Math.round(seconds * SR))
  const beat = 60 / spec.bpm
  const { root, minor } = parseKey(spec.key)
  const scale = minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11]
  const rand = rng(spec.seed ?? 1)
  // Progresión i–VI–III–VII (menor) o I–V–vi–IV (mayor), en grados de la escala
  const progression = minor ? [0, 5, 2, 6] : [0, 4, 5, 3]

  const add = (startSec: number, durSec: number, fn: (t: number) => number): void => {
    const s0 = Math.floor(startSec * SR)
    const n = Math.min(Math.floor(durSec * SR), out.length - s0)
    for (let i = 0; i < n; i++) out[s0 + i] += fn(i / SR)
  }
  const tone = (hz: number, amp: number, decay: number) => (t: number) =>
    amp * Math.sin(2 * Math.PI * hz * t) * Math.exp(-t * decay) * Math.min(1, t * 400)
  const chordDegree = (bar: number): number => progression[bar % progression.length]
  const noteOf = (degree: number, octave = 0): number =>
    root + scale[((degree % 7) + 7) % 7] + 12 * (octave + Math.floor(degree / 7))

  const beats = Math.floor(seconds / beat)
  const layers: TrackRole[] = spec.role === 'full' ? ['drums', 'bass', 'chords'] : [spec.role]

  for (const role of layers) {
    for (let b = 0; b < beats; b++) {
      const t = b * beat
      const bar = Math.floor(b / 4)
      switch (role) {
        case 'drums':
          add(
            t,
            0.4,
            (x) =>
              Math.sin(2 * Math.PI * (50 + 120 * Math.exp(-x * 30)) * x) * Math.exp(-x * 10) * 0.9
          )
          if (b % 2 === 1) add(t, 0.2, (x) => (rand() * 2 - 1) * Math.exp(-x * 25) * 0.35)
          add(t + beat / 2, 0.05, (x) => (rand() * 2 - 1) * Math.exp(-x * 80) * 0.15)
          break
        case 'bass':
          add(t, beat * 0.9, tone(midiToHz(noteOf(chordDegree(bar), -1)), 0.6, 3))
          break
        case 'chords':
          if (b % 4 === 0) {
            for (const d of [0, 2, 4])
              add(t, beat * 4, tone(midiToHz(noteOf(chordDegree(bar) + d, 1)), 0.18, 0.8))
          }
          break
        case 'melody':
        case 'vocal':
          for (const half of [0, 1]) {
            if (rand() < 0.3) continue
            const degree = chordDegree(bar) + Math.floor(rand() * 5)
            add(t + half * (beat / 2), beat / 2, tone(midiToHz(noteOf(degree, 2)), 0.3, 4))
          }
          break
        case 'fx':
          if (b % 8 === 0)
            add(t, beat * 8, (x) => (rand() * 2 - 1) * 0.1 * Math.sin((Math.PI * x) / (beat * 8)))
          break
      }
    }
  }
  return out
}

export const demoProvider: AudioProvider = {
  id: 'demo',
  label: 'Demo (sin IA)',
  description: 'Sintetizador local sencillo. Gratis y sin conexión, útil para probar.',
  // "Continuar" en Demo solo sigue el mismo patrón: no escucha el audio de partida.
  capabilities: {
    maxDurationSec: 120,
    supportsSeed: true,
    supportsContinue: true,
    supportsMelody: false
  },

  async status() {
    return { ready: true }
  },

  async generate(spec, ctx) {
    // Progreso simulado para que la UI se comporte como con un modelo real.
    for (let i = 1; i <= 4; i++) {
      ctx.onProgress(i / 5, 'Sintetizando…')
      await sleep(150, ctx.signal)
    }
    const mono = synthesize(spec, spec.durationSec)
    throwIfAborted(ctx.signal)
    const path = `${ctx.outBase}.wav`
    await writeFile(path, encodeWav([mono, mono], SR))
    ctx.onProgress(1, 'Listo')
    return { path }
  }
}
