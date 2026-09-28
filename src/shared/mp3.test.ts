import { describe, expect, it } from 'vitest'
import { encodeMp3 } from './mp3'

const sr = 48000
const tone = (sec: number): Float32Array =>
  Float32Array.from({ length: sec * sr }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / sr))

/** ¿Empieza por una cabecera de trama MPEG (11 bits de sincronización a 1)? */
const hasFrameSync = (b: Uint8Array): boolean => b[0] === 0xff && (b[1] & 0xe0) === 0xe0

describe('encodeMp3', () => {
  it('genera un MP3 estéreo con el tamaño que corresponde al bitrate', () => {
    const t = tone(2)
    const progress: number[] = []
    const mp3 = encodeMp3([t, t], sr, 128, (f) => progress.push(f))
    expect(hasFrameSync(mp3)).toBe(true)
    // 128 kbps × 2 s = 32 000 bytes (±10 % por tramas y relleno)
    expect(mp3.length).toBeGreaterThan(29_000)
    expect(mp3.length).toBeLessThan(36_000)
    expect(progress.at(-1)).toBe(1)
  })

  it('más bitrate, archivo más grande; también en mono', () => {
    const t = tone(1)
    expect(encodeMp3([t, t], sr, 320).length).toBeGreaterThan(encodeMp3([t, t], sr, 128).length * 2)
    expect(hasFrameSync(encodeMp3([t], sr, 192))).toBe(true)
  })

  it('rechaza frecuencias que MP3 no admite', () => {
    expect(() => encodeMp3([tone(1)], 96000, 128)).toThrow(/96000/)
  })
})
