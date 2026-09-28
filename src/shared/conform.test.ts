import { describe, expect, it } from 'vitest'
import { conformAudio } from './conform'

const sr = 1000
const tone = (sec: number, amp: number): Float32Array =>
  Float32Array.from({ length: sec * sr }, (_, i) => amp * Math.sin(i / 3))

const peak = (ch: Float32Array): number => ch.reduce((m, v) => Math.max(m, Math.abs(v)), 0)

describe('conformAudio', () => {
  it('recorta el sobrante a la duración musical exacta', () => {
    const [out] = conformAudio([tone(9, 0.5)], { targetSec: 8, sampleRate: sr })
    expect(out.length).toBe(8000)
  })

  it('rellena con silencio si el audio es más corto', () => {
    const [out] = conformAudio([tone(2, 0.5)], { targetSec: 3, sampleRate: sr })
    expect(out.length).toBe(3000)
    expect(peak(out.subarray(2100))).toBe(0)
  })

  it('normaliza el pico a -1 dBFS en todos los canales por igual', () => {
    const [l, r] = conformAudio([tone(2, 0.2), tone(2, 0.1)], { targetSec: 2, sampleRate: sr })
    expect(peak(l)).toBeCloseTo(Math.pow(10, -1 / 20), 3)
    expect(peak(r) / peak(l)).toBeCloseTo(0.5, 2) // conserva el balance estéreo
  })

  it('no amplifica el silencio y aplica fundidos', () => {
    const [silent] = conformAudio([new Float32Array(2000)], { targetSec: 2, sampleRate: sr })
    expect(peak(silent)).toBe(0)
    const [out] = conformAudio([new Float32Array(2000).fill(0.5)], { targetSec: 2, sampleRate: sr })
    expect(out[0]).toBe(0)
    expect(out[out.length - 1]).toBe(0)
  })
})
