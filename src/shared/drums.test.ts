import { describe, expect, it } from 'vitest'
import { drumPlan, findPattern, kickBeats, type DrumHit } from './drums'

const house = findPattern('house')!
const song = [
  { name: 'Intro', startBar: 1, bars: 8, energy: 2 },
  { name: 'Verso', startBar: 9, bars: 8, energy: 3 },
  { name: 'Coro', startBar: 17, bars: 8, energy: 5 },
  { name: 'Break', startBar: 25, bars: 8, energy: 3 },
  { name: 'Outro', startBar: 33, bars: 8, energy: 2 }
]
const inBars = (hits: DrumHit[], from: number, to: number): DrumHit[] =>
  hits.filter((h) => h.beat >= (from - 1) * 4 && h.beat < to * 4)
const voices = (hits: DrumHit[]): Set<string> => new Set(hits.map((h) => h.voice))

describe('batería programada', () => {
  const hits = drumPlan(song, 4, house)

  it('bombo a negras (4×4) en el verso', () => {
    const kicks = kickBeats(inBars(hits, 9, 14))
    expect(kicks).toEqual(Array.from({ length: 24 }, (_, i) => 32 + i))
  })

  it('la intro arranca sin bombo y con pocas capas', () => {
    expect(kickBeats(inBars(hits, 1, 4))).toEqual([])
    expect(kickBeats(inBars(hits, 5, 8)).length).toBeGreaterThan(0)
    expect(voices(inBars(hits, 1, 8)).has('clap')).toBe(false)
  })

  it('el coro suena con todas las capas y entra con un platillo', () => {
    const chorus = voices(inBars(hits, 17, 22))
    for (const v of ['kick', 'clap', 'shaker', 'conga', 'hat', 'openhat']) {
      expect(chorus.has(v)).toBe(true)
    }
    expect(hits).toContainEqual({ beat: 64, voice: 'crash', vel: 1 })
  })

  it('antes del coro: redoble, riser y el último pulso sin bombo', () => {
    const build = inBars(hits, 15, 16)
    expect(build.filter((h) => h.voice === 'snare').length).toBeGreaterThan(20)
    expect(hits).toContainEqual(
      expect.objectContaining({ voice: 'riser', beat: 56, lengthBeats: 8 })
    )
    expect(kickBeats(build)).not.toContain(63)
    expect(kickBeats(build)).toContain(62)
  })

  it('el break no lleva bombo pero sigue la percusión', () => {
    const brk = inBars(hits, 25, 32)
    expect(kickBeats(brk)).toEqual([])
    expect(voices(brk).has('clap')).toBe(true)
  })

  it('la canción acaba con un solo golpe en el último compás', () => {
    expect(inBars(hits, 40, 40).every((h) => h.beat === 156)).toBe(true)
  })

  it('más intensidad, más capas', () => {
    const calm = voices(inBars(drumPlan(song, 4, house, { intensity: -1 }), 9, 14))
    const hot = voices(inBars(drumPlan(song, 4, house, { intensity: 1 }), 9, 14))
    expect(calm.has('clap')).toBe(false)
    expect(hot.has('hat')).toBe(true)
  })
})
