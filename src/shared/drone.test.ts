import { describe, expect, it } from 'vitest'
import { findCollapse, tailBrightness, toMono, windowStats } from './drone'

const SR = 8000

/** Concatena segundos de señal generada por `f(t)`. */
function signal(...parts: [seconds: number, f: (t: number, i: number) => number][]): Float32Array {
  const out: number[] = []
  for (const [sec, f] of parts) {
    for (let i = 0; i < sec * SR; i++) out.push(f(i / SR, i))
  }
  return Float32Array.from(out)
}

// Ruido determinista (no depende de Math.random): una canción "sana" tiene agudos.
let seed = 1
const noise = (): number => {
  seed = (seed * 1103515245 + 12345) % 2 ** 31
  return seed / 2 ** 30 - 1
}
const song = (t: number): number => 0.3 * Math.sin(2 * Math.PI * 110 * t) + 0.2 * noise()
const drone = (t: number): number => 0.4 * Math.sin(2 * Math.PI * 50 * t)
const silence = (): number => 0

describe('drone', () => {
  it('mide volumen y agudos por segundo', () => {
    const stats = windowStats(signal([1, song], [1, drone]), SR)
    expect(stats).toHaveLength(2)
    expect(stats[0].highDb).toBeGreaterThan(-25)
    expect(stats[1].highDb).toBeLessThan(-40)
    expect(stats[1].db).toBeGreaterThan(-15)
  })

  it('un tramo sano no colapsa', () => {
    expect(findCollapse(signal([15, song]), SR)).toBeNull()
  })

  it('un tono grave sostenido es colapso desde donde empieza', () => {
    expect(findCollapse(signal([5, song], [8, drone], [2, song]), SR)).toBe(5)
  })

  it('un silencio largo a mitad de tramo también', () => {
    expect(findCollapse(signal([3, song], [5, silence], [7, song]), SR)).toBe(3)
  })

  it('una pausa breve no cuenta, pero una cola muerta sí (se contagiaría)', () => {
    expect(findCollapse(signal([5, song], [2, drone], [8, song]), SR)).toBeNull()
    expect(findCollapse(signal([12, song], [3, drone]), SR)).toBe(12)
  })

  it('se puede ignorar el fundido final del último tramo', () => {
    expect(findCollapse(signal([12, song], [3, silence]), SR, { ignoreTailSec: 3 })).toBeNull()
  })

  it('mezcla a mono promediando canales', () => {
    expect(Array.from(toMono([Float32Array.of(1, 0), Float32Array.of(0, 1)]))).toEqual([0.5, 0.5])
  })

  it('mide el brillo solo del final y sin contar el silencio', () => {
    const bright = tailBrightness(signal([8, drone], [8, song]), SR, 8)!
    const dark = tailBrightness(signal([8, song], [8, drone]), SR, 8)!
    expect(bright - dark).toBeGreaterThan(15)
    expect(tailBrightness(signal([8, song], [2, silence]), SR, 4)).toBeCloseTo(bright, 0)
    expect(tailBrightness(signal([3, silence]), SR, 3)).toBeNull()
  })
})
