import { describe, expect, it } from 'vitest'
import { bedAutomation, DUCK_DB } from './production'

const song = [
  { name: 'Intro', startBar: 1, bars: 8, energy: 2 },
  { name: 'Verso', startBar: 9, bars: 8, energy: 3 },
  { name: 'Coro', startBar: 17, bars: 8, energy: 5 },
  { name: 'Break', startBar: 25, bars: 8, energy: 3 },
  { name: 'Coro', startBar: 33, bars: 8, energy: 5 },
  { name: 'Outro', startBar: 41, bars: 8, energy: 2 }
]

describe('automatización de la cama', () => {
  const auto = bedAutomation(song, 4, [32, 33, 34])
  const low = auto.sweeps!.lowpass!
  const high = auto.sweeps!.highpass!

  it('la intro se abre de un filtro de graves a todo', () => {
    expect(low[0]).toEqual({ beat: 0, hz: 500 })
    expect(low[1].beat).toBeCloseTo(32, 1)
    expect(low[1].hz).toBe(20000)
  })

  it('antes de cada coro sube un paso alto, que se quita al entrar', () => {
    // Coro en el compás 17 (pulso 64): subida en los compases 15-16.
    expect(high.slice(0, 3)).toEqual([
      { beat: 56, hz: 20 },
      { beat: 63.99, hz: 600 },
      { beat: 64, hz: 20 }
    ])
    // Y antes del segundo coro, al final del break.
    expect(high.some((p) => p.beat === 120 && p.hz === 20)).toBe(true)
  })

  it('el break suena apagado y se abre en su subida', () => {
    const brk = low.filter((p) => p.beat >= 96 && p.beat < 128)
    expect(brk.map((p) => p.hz)).toEqual([20000, 1200, 1200, 20000])
  })

  it('el outro se cierra al final', () => {
    expect(low.at(-1)).toEqual({ beat: 192, hz: 700 })
  })

  it('bombea con el bombo, y sin bombo no hay sidechain', () => {
    expect(auto.duck).toMatchObject({ beats: [32, 33, 34], depthDb: DUCK_DB })
    expect(bedAutomation(song, 4, []).duck).toBeUndefined()
  })

  it('los puntos van en orden', () => {
    for (const pts of [low, high]) {
      for (let i = 1; i < pts.length; i++)
        expect(pts[i].beat).toBeGreaterThanOrEqual(pts[i - 1].beat)
    }
  })
})
