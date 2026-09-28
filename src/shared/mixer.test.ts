import { describe, expect, it } from 'vitest'
import { createTrack, type Track } from './project'
import { dbToGain, isTrackAudible } from './mixer'

const tracks = (...patches: Partial<Track>[]): Track[] =>
  patches.map((p, i) => ({ ...createTrack(`T${i}`, 'full'), ...p }))

const audible = (ts: Track[]): boolean[] => ts.map((t) => isTrackAudible(t, ts))

describe('isTrackAudible', () => {
  it('sin solo, suenan las pistas que no están en mute', () => {
    expect(audible(tracks({}, { mute: true }, {}))).toEqual([true, false, true])
  })

  it('con una pista en solo, solo suena esa', () => {
    expect(audible(tracks({ solo: true }, {}, {}))).toEqual([true, false, false])
  })

  it('con varias en solo, suenan todas las que están en solo', () => {
    expect(audible(tracks({ solo: true }, {}, { solo: true }))).toEqual([true, false, true])
  })

  it('mute gana a solo', () => {
    expect(audible(tracks({ solo: true, mute: true }, {}))).toEqual([false, false])
  })
})

describe('dbToGain', () => {
  it('0 dB es ganancia 1 y el mínimo es silencio', () => {
    expect(dbToGain(0)).toBe(1)
    expect(dbToGain(-6)).toBeCloseTo(0.501, 3)
    expect(dbToGain(-60)).toBe(0)
  })
})
