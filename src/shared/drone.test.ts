import { describe, expect, it } from 'vitest'
import { findCollapse, hasStartGap, soundSummary, toMono, windowStats } from './drone'

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
// Una "canción": tono y ruido con un golpe cada medio segundo (el pulso de un bombo).
const beat = (t: number): number => 0.3 + 0.7 * Math.exp(-(t % 0.5) / 0.08)
const song = (t: number): number =>
  beat(t) * (0.3 * Math.sin(2 * Math.PI * 110 * t) + 0.2 * noise())
/** Siseo estático: ruido de amplitud constante, todo agudos y sin ritmo. */
const hiss = (): number => 0.2 * noise()
const drone = (t: number): number => 0.4 * Math.sin(2 * Math.PI * 50 * t)
/** La música se vacía: sin bombo ni bajo, un hilo bajito de platillos al ritmo. */
let lastNoise = 0
const faint = (t: number): number => {
  const n = noise()
  const hat = n - lastNoise // ruido derivado: casi todo agudos, como un platillo
  lastNoise = n
  return 0.03 * beat(t) * hat
}
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

  it('que la música se vacíe (un hilo de platillos) también', () => {
    expect(findCollapse(signal([5, song], [8, faint], [2, song]), SR)).toBe(5)
    // Una intro que empieza de cero puede arrancar así: se puede desactivar.
    expect(
      findCollapse(signal([5, song], [8, faint], [2, song]), SR, { thinDb: -Infinity })
    ).toBeNull()
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

  it('resume el principio, el final y la media de un audio', () => {
    const sum = soundSummary(signal([2, song], [2, drone]), SR)!
    expect(sum.head.highDb).toBeGreaterThan(-25)
    expect(sum.tail.highDb).toBeLessThan(-40)
    expect(sum.mean.highDb).toBeGreaterThan(sum.tail.highDb)
    expect(soundSummary(new Float32Array(10), SR)).toBeNull()
  })

  it('un siseo estático (sin pulso) también es colapso, aunque tenga agudos', () => {
    const stats = windowStats(signal([2, song], [2, hiss]), SR)
    expect(stats[0].pulseDb).toBeGreaterThan(2)
    expect(stats[3].pulseDb).toBeLessThan(1)
    expect(stats[3].highDb).toBeGreaterThan(-15) // no es un drone: tiene agudos
    expect(findCollapse(signal([5, song], [6, hiss], [4, song]), SR)).toBe(5)
    const sum = soundSummary(signal([5, song], [6, hiss], [4, song]), SR)!
    expect(sum.staticRun).toEqual({ startSec: 5, sec: 6 })
  })

  it('ve un hueco al empezar: más de 1 s muy por debajo del final anterior', () => {
    const opening = soundSummary(signal([1.5, silence], [3, song]), SR)!.opening
    expect(opening).toHaveLength(6)
    expect(hasStartGap(opening, -18)).toBe(true)
    // Un golpe de silencio corto (0,5 s) es un respiro, no un hueco.
    expect(hasStartGap(soundSummary(signal([0.5, silence], [3, song]), SR)!.opening, -18)).toBe(
      false
    )
  })
})
