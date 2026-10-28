import { describe, expect, it } from 'vitest'
import { seamGainDb } from './conform'
import { duckEvents, regionPlayback, sweepEvents } from './playback'
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

describe('automatización de filtros y sidechain', () => {
  // A 120 BPM un pulso dura 0,5 s.
  const sweep = [
    { beat: 0, hz: 400 },
    { beat: 8, hz: 20000 }
  ]

  it('un barrido desde el principio salta al primer valor y sube en curva', () => {
    expect(sweepEvents(sweep, 120, 0)).toEqual([
      { atSec: 0, value: 400, kind: 'set' },
      { atSec: 4, value: 20000, kind: 'exp' }
    ])
  })

  it('empezando a mitad, arranca en el valor de ese momento', () => {
    const [first, ramp] = sweepEvents(sweep, 120, 2)
    expect(first.value).toBeCloseTo(400 * Math.sqrt(50), 3) // a mitad en curva
    expect(ramp).toEqual({ atSec: 2, value: 20000, kind: 'exp' })
    // Pasado el último punto se queda en él.
    expect(sweepEvents(sweep, 120, 10)).toEqual([{ atSec: 0, value: 20000, kind: 'set' }])
  })

  it('el sidechain baja en cada bombo y vuelve', () => {
    const events = duckEvents({ beats: [1, 2], depthDb: 6, releaseSec: 0.2 }, 120, 0)
    const low = Math.pow(10, -6 / 20)
    expect(events[0]).toEqual({ atSec: 0, value: 1, kind: 'set' })
    expect(events.slice(1, 4)).toEqual([
      { atSec: 0.495, value: 1, kind: 'set' },
      { atSec: 0.5, value: low, kind: 'linear' },
      { atSec: 0.7, value: 1, kind: 'linear' }
    ])
    expect(events).toHaveLength(7)
  })
})
