import { describe, expect, it } from 'vitest'
import { renderDrums, synthVoice } from './drum-synth'
import type { DrumHit } from './drums'

const SR = 16000
const peak = (x: Float32Array): number => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0)

describe('síntesis de la batería', () => {
  it('cada sonido sale a su pico y el bombo cae de tono', () => {
    const kick = synthVoice('kick', SR)
    expect(peak(kick)).toBeCloseTo(0.9, 2)
    // Más energía al principio que al final (decae).
    const early = peak(kick.subarray(0, SR * 0.05))
    const late = peak(kick.subarray(SR * 0.35))
    expect(late).toBeLessThan(early / 4)
  })

  it('el riser crece hasta el final', () => {
    const riser = synthVoice('riser', SR, { lengthSec: 2 })
    expect(peak(riser.subarray(0, SR * 0.5))).toBeLessThan(peak(riser.subarray(SR * 1.5)) / 4)
  })

  it('coloca los golpes en su sitio y solo los de su tramo', () => {
    const hits: DrumHit[] = [
      { beat: 0, voice: 'kick', vel: 1 },
      { beat: 2, voice: 'kick', vel: 1 },
      { beat: 9, voice: 'kick', vel: 1 } // fuera del tramo
    ]
    const [l, r] = renderDrums(hits, { sampleRate: SR, bpm: 120, fromBeat: 1, lengthBeats: 4 })
    expect(l.length).toBe(2 * SR)
    // El golpe del pulso 2 cae a 0,5 s del principio del tramo (que empieza en el 1).
    expect(peak(l.subarray(0, SR * 0.49))).toBeLessThan(0.01)
    expect(peak(l.subarray(SR * 0.5, SR * 0.6))).toBeGreaterThan(0.5)
    expect(Array.from(r)).toEqual(Array.from(l)) // el bombo va al centro
  })

  it('siempre suena igual', () => {
    const hits: DrumHit[] = [{ beat: 0, voice: 'clap', vel: 1 }]
    const opts = { sampleRate: SR, bpm: 120, fromBeat: 0, lengthBeats: 1 }
    expect(Array.from(renderDrums(hits, opts)[0])).toEqual(Array.from(renderDrums(hits, opts)[0]))
  })
})
