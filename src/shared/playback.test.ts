import { describe, expect, it } from 'vitest'
import { seamGainDb } from './conform'
import { regionPlayback } from './playback'
import type { Region } from './project'

const region = (over: Partial<Region> = {}): Region => ({
  id: 'r',
  clipId: 'c',
  startBeat: 8, // a 120 BPM, segundo 4
  offsetSec: 0,
  lengthSec: 10,
  fadeInSec: 0.01,
  fadeOutSec: 0.01,
  ...over
})

describe('reproducción de una región', () => {
  it('sin pre-roll suena desde su inicio', () => {
    expect(regionPlayback(region(), 120, 0)).toEqual({
      startSec: 4,
      clipSec: 0,
      durationSec: 10,
      fadeInSec: 0.01,
      skipSec: 0
    })
  })

  it('con pre-roll empieza antes y entra en fundido durante el pre-roll', () => {
    const play = regionPlayback(region({ offsetSec: 0.5, leadInSec: 0.5 }), 120, 0)!
    expect(play).toMatchObject({ startSec: 3.5, clipSec: 0, durationSec: 10.5, fadeInSec: 0.5 })
  })

  it('el pre-roll nunca lee antes del principio del clip', () => {
    const play = regionPlayback(region({ offsetSec: 0.2, leadInSec: 0.5 }), 120, 0)!
    expect(play.startSec).toBeCloseTo(3.8)
    expect(play.clipSec).toBe(0)
  })

  it('empezando a mitad, salta lo ya sonado y no repite el fundido', () => {
    const play = regionPlayback(region({ offsetSec: 0.5, leadInSec: 0.5 }), 120, 5)!
    expect(play).toMatchObject({ startSec: 5, clipSec: 1.5, durationSec: 9, fadeInSec: 0 })
    expect(regionPlayback(region(), 120, 14)).toBeNull()
  })
})

describe('volumen en la unión', () => {
  const tone = (amp: number): Float32Array[] => [
    Float32Array.from({ length: 1000 }, (_, i) => amp * Math.sin(i / 5))
  ]

  it('sube o baja el tramo nuevo para que su pre-roll suene como el final anterior', () => {
    expect(seamGainDb(tone(0.25), tone(0.5), 0.25)).toBeCloseTo(6, 0)
    expect(seamGainDb(tone(0.5), tone(0.25), 0.9)).toBeCloseTo(-6, 0)
  })

  it('no satura, no pasa de ±6 dB y no toca el silencio', () => {
    // Pico ya en −1 dB: no hay sitio para subir.
    expect(seamGainDb(tone(0.25), tone(0.5), 0.891)).toBeCloseTo(0, 1)
    expect(seamGainDb(tone(0.05), tone(0.8), 0.05)).toBe(6)
    expect(seamGainDb(tone(0), tone(0.5), 0.5)).toBe(0)
  })
})
