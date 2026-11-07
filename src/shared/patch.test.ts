import { describe, expect, it } from 'vitest'
import { heardBars, planDullPatches, spliceBars, type HeardRegion } from './patch'
import { createProject, createTrack, type Region } from './project'

// 120 bpm, 4/4: un compás = 2 s, así cada compás son dos segundos medidos.
const BPM = 120
const sec = (db: number, highDb: number) => ({ db, highDb })
const region = (
  id: string,
  bar: number,
  bars: number,
  highDb: (bar: number) => number,
  extra: Partial<Region> = {}
): HeardRegion => ({
  id,
  clipId: `c${id}`,
  startBeat: (bar - 1) * 4,
  offsetSec: 0,
  lengthSec: bars * 2,
  seconds: Array.from({ length: bars * 2 }, (_, i) => sec(-17, highDb(bar + Math.floor(i / 2)))),
  ...extra
})

describe('compases opacos tapados con compases sanos (test17)', () => {
  const sections = [
    { name: 'Intro', startBar: 1, bars: 4, energy: 3 },
    { name: 'Coro', startBar: 5, bars: 8, energy: 5 },
    { name: 'Verso', startBar: 13, bars: 4, energy: 3 },
    { name: 'Coro final', startBar: 17, bars: 8, energy: 5 },
    { name: 'Outro', startBar: 25, bars: 2, energy: 2 }
  ]
  const intro = region('i', 1, 4, () => -5)
  const coro = region('c', 5, 8, () => -5)
  const verso = region('v', 13, 4, () => -6)
  const outro = region('o', 25, 2, () => -25)

  it('mide cada compás con la mezcla de su región', () => {
    const bars = heardBars([region('x', 1, 2, () => -10, { gainDb: 3 })], 4, BPM)
    expect(bars.get(1)!.db).toBeCloseTo(-14)
    expect(bars.get(2)!.highDb).toBeCloseTo(-10)
  })

  it('una frase apagada del coro final se cambia entera por la del primer coro', () => {
    const final = region('f', 17, 8, (bar) => (bar >= 21 ? -13 : -5))
    const patches = planDullPatches(sections, [intro, coro, verso, final, outro], 4, BPM, -5)
    expect(patches).toEqual([
      { section: 'Coro final', bar: 21, bars: 4, fromBar: 9, regionId: 'c', offsetSec: 8 }
    ])
  })

  it('un compás suelto no se tapa: sonaría a empalme (test19)', () => {
    const final = region('f', 17, 8, (bar) => (bar === 19 ? -13 : -5))
    expect(planDullPatches(sections, [intro, coro, verso, final, outro], 4, BPM, -5)).toEqual([])
  })

  it('no toca lo tranquilo, lo que no tiene donante ni lo que está bien', () => {
    const darkVerse = region('v', 13, 4, () => -20)
    // El verso no tiene hermanas sanas; el outro es tranquilo.
    expect(planDullPatches(sections, [intro, coro, darkVerse, outro], 4, BPM, -5)).toEqual([])
    expect(planDullPatches(sections, [intro, coro, verso, outro], 4, BPM, -5)).toEqual([])
  })

  it('empalma el audio sin solaparse con lo de antes y lo de después', () => {
    const p = createProject('X')
    const base: Region = {
      id: 'f',
      clipId: 'cf',
      startBeat: 64,
      offsetSec: 1,
      lengthSec: 16,
      fadeInSec: 0,
      fadeOutSec: 0,
      gainDb: -2,
      leadInSec: 0.5
    }
    const donor: Region = { ...base, id: 'c', clipId: 'cc', startBeat: 16, gainDb: 3 }
    const t = { ...createTrack('Canción', 'full'), regions: [donor, base] }
    const out = spliceBars({ ...p, bpm: BPM, tracks: [t] }, t.id, 72, 8, donor, 9, 9)
    const rs = out.tracks[0].regions.filter((r) => r.startBeat >= 64)
    expect(rs.map((r) => [r.startBeat, r.lengthSec, r.offsetSec, r.clipId])).toEqual([
      [64, 4, 1, 'cf'],
      [72, 4, 9, 'cc'],
      [80, 8, 9, 'cf']
    ])
    expect(rs[1]).toMatchObject({ gainDb: 3, patchFromBar: 9 })
    expect(rs[2].leadInSec).toBeUndefined()
  })
})
