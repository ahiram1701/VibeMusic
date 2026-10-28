// Sonidos de la batería programada, sintetizados con muestras en bruto: sin samples
// (ni licencias), siempre iguales (el ruido sale de una semilla) y probables sin Web
// Audio. Recetas clásicas de caja de ritmos: el bombo es un seno que cae de tono con
// un click, las palmas ráfagas de ruido filtrado, los hats ruido agudo muy corto. Puro.

import type { DrumHit, DrumVoice } from './drums'

/** Filtro biquad (recetas de R. Bristow-Johnson). */
class Biquad {
  private b0 = 1
  private b1 = 0
  private b2 = 0
  private a1 = 0
  private a2 = 0
  private x1 = 0
  private x2 = 0
  private y1 = 0
  private y2 = 0

  constructor(
    private type: 'lowpass' | 'highpass' | 'bandpass',
    hz: number,
    private q: number,
    private sr: number
  ) {
    this.tune(hz)
  }

  tune(hz: number): void {
    const w = (2 * Math.PI * Math.min(hz, this.sr * 0.45)) / this.sr
    const c = Math.cos(w)
    const alpha = Math.sin(w) / (2 * this.q)
    const a0 = 1 + alpha
    let b0: number, b1: number, b2: number
    if (this.type === 'lowpass') [b0, b1, b2] = [(1 - c) / 2, 1 - c, (1 - c) / 2]
    else if (this.type === 'highpass') [b0, b1, b2] = [(1 + c) / 2, -(1 + c), (1 + c) / 2]
    else [b0, b1, b2] = [alpha, 0, -alpha]
    this.b0 = b0 / a0
    this.b1 = b1 / a0
    this.b2 = b2 / a0
    this.a1 = (-2 * c) / a0
    this.a2 = (1 - alpha) / a0
  }

  run(x: number): number {
    const y =
      this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2
    this.x2 = this.x1
    this.x1 = x
    this.y2 = this.y1
    this.y1 = y
    return y
  }
}

/** Ruido blanco determinista. */
function noiseSource(seed: number): () => number {
  let s = (seed >>> 0) % 2147483647 || 1
  return () => {
    s = (s * 48271) % 2147483647
    return s / 1073741823.5 - 1
  }
}

/** Pico de cada sonido a toda intensidad (antes de la mezcla). */
const PEAK: Record<DrumVoice, number> = {
  kick: 0.9,
  sub808: 0.8,
  clap: 0.5,
  snare: 0.42,
  hat: 0.2,
  openhat: 0.22,
  shaker: 0.12,
  conga: 0.38,
  congaHi: 0.3,
  rim: 0.26,
  crash: 0.28,
  riser: 0.22
}

/** Panorama de cada sonido (−1 izquierda, +1 derecha). */
const PAN: Partial<Record<DrumVoice, number>> = {
  hat: 0.25,
  openhat: 0.2,
  shaker: -0.3,
  conga: -0.25,
  congaHi: 0.3,
  rim: 0.15
}

/** Un golpe en mono, ya a su pico (`PEAK` × intensidad). */
export function synthVoice(
  voice: DrumVoice,
  sr: number,
  { seed = 1, lengthSec }: { seed?: number; lengthSec?: number } = {}
): Float32Array {
  const noise = noiseSource(seed)
  const make = (sec: number, f: (t: number, i: number) => number): Float32Array => {
    const out = new Float32Array(Math.max(1, Math.round(sec * sr)))
    for (let i = 0; i < out.length; i++) out[i] = f(i / sr, i)
    return out
  }
  let buf: Float32Array
  switch (voice) {
    case 'kick': {
      let phase = 0
      buf = make(0.45, (t) => {
        phase += (2 * Math.PI * (48 + 120 * Math.exp(-t / 0.035))) / sr
        const body = Math.sin(phase) * Math.exp(-t / 0.16) * Math.min(1, t / 0.002)
        const click = noise() * Math.exp(-t / 0.003) * 0.3
        return Math.tanh(1.6 * (body + click))
      })
      break
    }
    case 'sub808': {
      let phase = 0
      buf = make(lengthSec ?? 1, (t) => {
        phase += (2 * Math.PI * (45 + 30 * Math.exp(-t / 0.05))) / sr
        return Math.tanh(2 * Math.sin(phase) * Math.exp(-t / 0.9))
      })
      break
    }
    case 'clap': {
      const bp = new Biquad('bandpass', 1300, 1.2, sr)
      buf = make(0.3, (t) => {
        let env = 0
        for (const at of [0, 0.011, 0.022]) if (t >= at) env += Math.exp(-(t - at) / 0.004)
        if (t >= 0.022) env += 0.6 * Math.exp(-(t - 0.022) / 0.12)
        return bp.run(noise() * env)
      })
      break
    }
    case 'snare': {
      const bp = new Biquad('bandpass', 2200, 0.8, sr)
      buf = make(0.18, (t) => {
        const tone = Math.sin(2 * Math.PI * 190 * t) * Math.exp(-t / 0.04) * 0.5
        return bp.run(noise()) * Math.exp(-t / 0.06) + tone
      })
      break
    }
    case 'hat':
    case 'openhat': {
      const hp = new Biquad('highpass', 7000, 0.7, sr)
      const decay = voice === 'hat' ? 0.012 : 0.09
      buf = make(voice === 'hat' ? 0.06 : 0.32, (t) => hp.run(noise()) * Math.exp(-t / decay))
      break
    }
    case 'shaker': {
      const hp = new Biquad('highpass', 5000, 0.7, sr)
      buf = make(0.09, (t) => {
        const env = t < 0.012 ? t / 0.012 : Math.exp(-(t - 0.012) / 0.025)
        return hp.run(noise()) * env
      })
      break
    }
    case 'conga':
    case 'congaHi': {
      const base = voice === 'conga' ? 210 : 320
      const bp = new Biquad('bandpass', 1500, 1, sr)
      let phase = 0
      buf = make(0.25, (t) => {
        phase += (2 * Math.PI * base * (1 + 0.15 * Math.exp(-t / 0.01))) / sr
        const slap = bp.run(noise()) * Math.exp(-t / 0.004) * 0.2
        return Math.sin(phase) * Math.exp(-t / 0.09) + slap
      })
      break
    }
    case 'rim': {
      const bp = new Biquad('bandpass', 3000, 2, sr)
      buf = make(0.06, (t) => {
        const tone = Math.sin(2 * Math.PI * 800 * t) * Math.exp(-t / 0.01)
        return tone + bp.run(noise()) * Math.exp(-t / 0.008)
      })
      break
    }
    case 'crash': {
      const hp = new Biquad('highpass', 4500, 0.7, sr)
      buf = make(2, (t) => hp.run(noise()) * Math.exp(-t / 0.6))
      break
    }
    case 'riser': {
      // Ruido que sube de 300 Hz a 9 kHz y de volumen, y se corta en seco: el drop.
      const len = lengthSec ?? 4
      const bp = new Biquad('bandpass', 300, 2, sr)
      buf = make(len, (t, i) => {
        const p = t / len
        if (i % 32 === 0) bp.tune(300 * Math.pow(30, p))
        return bp.run(noise()) * p * p
      })
      break
    }
  }
  let peak = 0
  for (const x of buf) peak = Math.max(peak, Math.abs(x))
  const k = peak > 0 ? PEAK[voice] / peak : 0
  for (let i = 0; i < buf.length; i++) buf[i] *= k
  return buf
}

/** Saturación suave por encima de 0,8: los picos que se suman no recortan en seco. */
function softClip(x: number): number {
  const a = Math.abs(x)
  return a < 0.8 ? x : Math.sign(x) * (0.8 + 0.2 * Math.tanh((a - 0.8) / 0.2))
}

/**
 * Renderiza en estéreo los golpes que caen en [fromBeat, fromBeat + lengthBeats). Las
 * colas que pasan del final se cortan (las regiones ya duran eso).
 */
export function renderDrums(
  hits: DrumHit[],
  opts: { sampleRate: number; bpm: number; fromBeat: number; lengthBeats: number }
): Float32Array[] {
  const { sampleRate: sr, bpm, fromBeat, lengthBeats } = opts
  const secPerBeat = 60 / bpm
  const length = Math.max(1, Math.round(lengthBeats * secPerBeat * sr))
  const left = new Float32Array(length)
  const right = new Float32Array(length)
  for (const hit of hits) {
    if (hit.beat < fromBeat || hit.beat >= fromBeat + lengthBeats) continue
    const at = Math.round((hit.beat - fromBeat) * secPerBeat * sr)
    const seed = Math.round(hit.beat * 1000) * 31 + hit.voice.length * 7919
    const wide = hit.voice === 'crash' || hit.voice === 'riser'
    const lengthSec = hit.lengthBeats ? hit.lengthBeats * secPerBeat : undefined
    const l = synthVoice(hit.voice, sr, { seed, lengthSec })
    // Platillo y riser con ruido distinto en cada lado: suenan abiertos.
    const r = wide ? synthVoice(hit.voice, sr, { seed: seed + 1, lengthSec }) : l
    const pan = PAN[hit.voice] ?? 0
    const gl = hit.vel * Math.min(1, 1 - pan)
    const gr = hit.vel * Math.min(1, 1 + pan)
    for (let i = 0; i < l.length && at + i < length; i++) {
      left[at + i] += l[i] * gl
      right[at + i] += r[i] * gr
    }
  }
  for (let i = 0; i < length; i++) {
    left[i] = softClip(left[i])
    right[i] = softClip(right[i])
  }
  return [left, right]
}
