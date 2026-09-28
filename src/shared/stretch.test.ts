import { describe, expect, it } from 'vitest'
import { timeStretch } from './stretch'

const sr = 16000
const sine = (freq: number, sec: number, amp = 0.5): Float32Array =>
  Float32Array.from(
    { length: Math.round(sec * sr) },
    (_, i) => amp * Math.sin((2 * Math.PI * freq * i) / sr)
  )

/** Frecuencia dominante estimada contando cruces por cero (en la parte central). */
function pitch(x: Float32Array): number {
  const a = Math.floor(x.length * 0.2)
  const b = Math.floor(x.length * 0.8)
  let crossings = 0
  for (let i = a + 1; i < b; i++) if (x[i - 1] < 0 !== x[i] < 0) crossings++
  return crossings / 2 / ((b - a) / sr)
}

const rms = (x: Float32Array): number => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length)

describe('timeStretch (WSOLA)', () => {
  it('alarga sin cambiar el tono (120 → 90 BPM)', () => {
    const input = sine(440, 1)
    const [out] = timeStretch([input], sr, 120 / 90)
    expect(out.length).toBe(Math.round(input.length * (120 / 90)))
    expect(pitch(out)).toBeCloseTo(440, -1) // ±5 Hz
    expect(rms(out.subarray(1000, -1000))).toBeCloseTo(rms(input), 1) // mismo volumen
  })

  it('acorta sin cambiar el tono (90 → 120 BPM)', () => {
    const input = sine(220, 1)
    const [out] = timeStretch([input], sr, 90 / 120)
    expect(out.length).toBe(12000)
    expect(pitch(out)).toBeCloseTo(220, -1)
  })

  it('mantiene los canales alineados', () => {
    const left = sine(330, 0.5)
    const [l, r] = timeStretch([left, Float32Array.from(left)], sr, 1.2)
    expect(r).toEqual(l)
  })

  it('con ratio 1 devuelve una copia', () => {
    const input = sine(100, 0.2)
    const [out] = timeStretch([input], sr, 1)
    expect(out).toEqual(input)
    expect(out).not.toBe(input)
  })

  it('es rápido con clips de varios segundos', () => {
    const input = sine(440, 8)
    const t0 = performance.now()
    timeStretch([input, input], sr, 1.1)
    expect(performance.now() - t0).toBeLessThan(3000)
  })
})
