import { describe, expect, it } from 'vitest'
import { alignClip, beatCorrection, beatMarginSec, estimateBeat, MIN_STRENGTH } from './beat-align'

const SR = 8000

/** Bombos (seno grave con caída) a `bpm`, el primero a `firstSec`, sobre un poco de ruido. */
function kicks(bpm: number, firstSec: number, seconds: number): Float32Array {
  const out = new Float32Array(seconds * SR)
  let seed = 7
  for (let i = 0; i < out.length; i++) {
    seed = (seed * 1103515245 + 12345) % 2 ** 31
    out[i] = 0.01 * (seed / 2 ** 30 - 1)
  }
  for (let t = firstSec; t < seconds; t += 60 / bpm) {
    const at = Math.round(t * SR)
    for (let i = 0; i < 0.15 * SR && at + i < out.length; i++) {
      out[at + i] += 0.8 * Math.exp(-i / (0.04 * SR)) * Math.sin((2 * Math.PI * 55 * i) / SR)
    }
  }
  return out
}

describe('tempo y fase de un clip', () => {
  it('mide el tempo real y dónde cae el primer pulso', () => {
    const est = estimateBeat(kicks(127, 0.1, 15), SR, 124)!
    expect(est.bpm).toBeCloseTo(127, 0)
    expect(est.phaseSec).toBeCloseTo(0.1, 1)
    expect(est.strength).toBeGreaterThan(MIN_STRENGTH)
  })

  it('corrige el tempo si se desvía y quita lo que sobra antes del primer pulso', () => {
    const fix = beatCorrection({ bpm: 127, phaseSec: 0.1, strength: 5 }, 124)!
    expect(fix.ratio).toBeCloseTo(127 / 124, 5)
    expect(fix.shiftSec).toBeCloseTo(0.1 * (127 / 124), 5)
    // Casi a tempo: no se estira, solo se desplaza.
    expect(beatCorrection({ bpm: 124.2, phaseSec: 0, strength: 5 }, 124)).toEqual({
      ratio: 1,
      shiftSec: 0
    })
  })

  it('sin pulso claro no corrige nada', () => {
    const noise = kicks(124, 100, 15) // ningún bombo dentro del audio
    expect(beatCorrection(estimateBeat(noise, SR, 124), 124)).toBeNull()
  })
})

describe('alinear un clip al compás', () => {
  const opts = { bpm: 124, leadInSec: 0, needSec: 15, phase: true }

  it('un clip que tocó a 127 se estira a 124 y empieza en su primer pulso', () => {
    const audio = kicks(127, 0.2, 17)
    const { channels, fix } = alignClip([audio, audio], SR, opts)
    expect(fix!.ratio).toBeCloseTo(127 / 124, 2)
    expect(fix!.shiftSec).toBeCloseTo(0.2 * (127 / 124), 1)
    const again = estimateBeat(channels[0], SR, 124)!
    expect(again.bpm).toBeCloseTo(124, 0)
    // El primer pulso cae ya en el principio (o a un pulso entero de él).
    const period = 60 / 124
    expect(Math.min(again.phaseSec, period - again.phaseSec)).toBeLessThan(0.02)
  })

  it('una continuación no se desplaza y conserva su pre-roll tal cual', () => {
    const audio = kicks(127, 0.2, 17)
    const lead = 0.5
    const { channels, fix } = alignClip([audio], SR, { ...opts, leadInSec: lead, phase: false })
    expect(fix!.shiftSec).toBe(0)
    const n = lead * SR
    expect(Array.from(channels[0].subarray(0, n))).toEqual(Array.from(audio.subarray(0, n)))
  })

  it('si no queda audio suficiente, no se toca', () => {
    const audio = kicks(120, 0, 15) // más lento: al estirarlo a 124 encogería
    const res = alignClip([audio], SR, opts)
    expect(res.fix).toBeNull()
    expect(res.channels[0]).toBe(audio)
  })

  it('el margen que se pide cubre un pulso y un 5 % de la duración', () => {
    expect(beatMarginSec(120, 20)).toBeCloseTo(0.5 + 1, 5)
  })
})
