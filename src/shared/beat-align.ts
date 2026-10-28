// ¿A qué tempo y en qué fase toca de verdad un clip? MusicGen toma el "124 bpm" del
// prompt como una sugerencia: en una canción real tocó a ~127, así que cada tramo de
// 15 s acababa ~350 ms adelantado y en cada unión el pulso saltaba. Se mide sin IA:
// los ataques de los graves (el bombo) a 200 fotogramas por segundo y, para cada tempo
// candidato cerca del pedido, la fase en la que más ataques caen sobre el pulso. Puro.

import { timeStretch } from './stretch'

/** Fotogramas por segundo de la envolvente de ataques. */
const RATE = 200
/** Corte del filtro de graves: deja el bombo y el bajo. */
const BASS_HZ = 150

export interface BeatEstimate {
  /** Tempo medido. */
  bpm: number
  /** Segundos desde el principio hasta el primer pulso (0 ≤ fase < un pulso). */
  phaseSec: number
  /**
   * Cuánto encaja este tempo mejor que el típico del margen buscado (1 = ninguno
   * destaca, como en el ruido; con un bombo, a un 2 % de tempo ya no cuadra y se nota).
   * Por debajo de MIN_STRENGTH no hay pulso fiable.
   */
  strength: number
}

/** Un pulso menos marcado que esto no se corrige: puede ser una intro sin bombo. */
export const MIN_STRENGTH = 2

/** Ataques de los graves: cuánto sube el volumen (en log) de un fotograma al siguiente. */
export function bassOnsets(samples: Float32Array, sampleRate: number): Float32Array {
  const hop = Math.max(1, Math.round(sampleRate / RATE))
  const a = Math.exp((-2 * Math.PI * BASS_HZ) / sampleRate)
  let y1 = 0
  let y2 = 0
  const frames = Math.floor(samples.length / hop)
  const energy = new Float32Array(frames)
  let peak = 0
  for (let f = 0; f < frames; f++) {
    let e = 0
    for (let i = f * hop; i < (f + 1) * hop; i++) {
      y1 = a * y1 + (1 - a) * samples[i]
      y2 = a * y2 + (1 - a) * y1
      e += y2 * y2
    }
    energy[f] = e / hop
    peak = Math.max(peak, energy[f])
  }
  // Suelo: 40 dB bajo el fotograma más fuerte (y nunca por debajo de −50 dB). Sin él,
  // en un fondo casi mudo el logaritmo convierte cualquier rizo en un "ataque".
  const floor = Math.max(1e-5, peak * 1e-4)
  const out = new Float32Array(frames)
  for (let f = 1; f < frames; f++) {
    out[f] = Math.max(0, Math.log10(energy[f] + floor) - Math.log10(energy[f - 1] + floor))
  }
  return out
}

/**
 * Tempo y fase del pulso de un audio, buscando a ±`rangePct` % del tempo pedido (así
 * no se confunde con el doble o la mitad). null si el audio dura menos de 4 pulsos o
 * si el mejor tempo cae en el borde del margen (el de verdad está fuera: no se sabe).
 */
export function estimateBeat(
  samples: Float32Array,
  sampleRate: number,
  bpm: number,
  { rangePct = 4 }: { rangePct?: number } = {}
): BeatEstimate | null {
  const onsets = bassOnsets(samples, sampleRate)
  if (onsets.length < (4 * 60 * RATE) / bpm) return null
  let best: Omit<BeatEstimate, 'strength'> | null = null
  let bestScore = -1
  const tops: number[] = []
  const lo = bpm * (1 - rangePct / 100)
  const hi = bpm * (1 + rangePct / 100)
  for (let b = lo; b <= hi + 1e-9; b += 0.05) {
    const period = (RATE * 60) / b
    const scores: number[] = []
    for (let phase = 0; phase < period; phase++) {
      let sum = 0
      let n = 0
      for (let t = phase; t < onsets.length - 0.5; t += period) {
        sum += onsets[Math.round(t)] ?? 0
        n++
      }
      scores.push(sum / n)
    }
    const top = Math.max(...scores)
    tops.push(top)
    if (top <= bestScore) continue
    bestScore = top
    best = { bpm: b, phaseSec: scores.indexOf(top) / RATE }
  }
  if (!best || Math.abs(best.bpm / bpm - 1) > (rangePct - 0.3) / 100) return null
  const typical = tops.sort((x, y) => x - y)[Math.floor(tops.length / 2)]
  return typical > 0 ? { ...best, strength: bestScore / typical } : null
}

/** Cuánto puede desviarse el tempo sin corregirlo (0,5 %: ~75 ms en un tramo de 15 s). */
export const TEMPO_TOLERANCE = 0.005

/**
 * Cómo dejar un clip a tempo: `ratio` para timeStretch (duración nueva / vieja; > 1 si
 * tocó más rápido) y los segundos del principio que sobran para que el primer pulso
 * caiga en el 0 (`shiftSec`, ya en la duración estirada). null si no hay pulso fiable.
 */
export function beatCorrection(
  est: BeatEstimate | null,
  bpm: number
): { ratio: number; shiftSec: number } | null {
  if (!est || est.strength < MIN_STRENGTH) return null
  const off = Math.abs(est.bpm / bpm - 1)
  const ratio = off > TEMPO_TOLERANCE ? est.bpm / bpm : 1
  const shiftSec = est.phaseSec * ratio
  return { ratio, shiftSec }
}

/**
 * Segundos de más que se piden al motor para poder alinear: hasta un pulso que se
 * recorta del principio y lo que encoge un clip que tocó más lento (hasta un 5 %).
 */
export function beatMarginSec(bpm: number, durationSec: number): number {
  return 60 / bpm + 0.05 * durationSec
}

export interface AlignResult {
  channels: Float32Array[]
  /** Lo que se corrigió (para el historial y los tests), o null si nada. */
  fix: { measuredBpm: number; ratio: number; shiftSec: number } | null
}

/**
 * Deja un clip recién generado a tempo y en fase: mide el pulso de lo nuevo (tras el
 * pre-roll de `leadInSec`, que ya viene a tempo del tramo anterior), lo estira al tempo
 * del proyecto y, si `phase`, recorta hasta su primer pulso (solo en un clip que
 * empieza de cero: una continuación ya hereda la fase de lo que escucha). Si después
 * no quedan `needSec` de audio nuevo, no se toca: mejor desfasado que con un hueco.
 */
export function alignClip(
  channels: Float32Array[],
  sampleRate: number,
  opts: { bpm: number; leadInSec: number; needSec: number; phase: boolean }
): AlignResult {
  const lead = Math.round(opts.leadInSec * sampleRate)
  const body = channels.map((ch) => ch.subarray(Math.min(lead, ch.length)))
  const mono = new Float32Array(body[0]?.length ?? 0)
  for (const ch of body) for (let i = 0; i < mono.length; i++) mono[i] += ch[i] / body.length
  const est = estimateBeat(mono, sampleRate, opts.bpm)
  const fix = beatCorrection(est, opts.bpm)
  if (!est || !fix) return { channels, fix: null }
  const need = Math.round(opts.needSec * sampleRate)
  let shift = opts.phase ? Math.round(fix.shiftSec * sampleRate) : 0
  const stretchedLen = Math.round(mono.length * fix.ratio)
  if (stretchedLen - shift < need) shift = 0
  if (stretchedLen < need || (fix.ratio === 1 && shift === 0)) return { channels, fix: null }
  const stretched = fix.ratio === 1 ? body : timeStretch(body, sampleRate, fix.ratio)
  const out = channels.map((ch, c) => {
    const tail = stretched[c].subarray(shift)
    const joined = new Float32Array(lead + tail.length)
    joined.set(ch.subarray(0, lead))
    joined.set(tail, lead)
    return joined
  })
  return {
    channels: out,
    fix: { measuredBpm: est.bpm, ratio: fix.ratio, shiftSec: shift / sampleRate }
  }
}
