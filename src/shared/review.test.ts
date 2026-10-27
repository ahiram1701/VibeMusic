import { describe, expect, it } from 'vitest'
import { reviewSong, type RegionSound } from './review'

const w = (db: number, highDb = -15): { db: number; highDb: number } => ({ db, highDb })
const region = (startBeat: number, mean: number, over: Partial<RegionSound> = {}): RegionSound => ({
  startBeat,
  endBeat: startBeat + 32,
  head: w(mean),
  tail: w(mean),
  mean: w(mean),
  ...over
})

const sections = [
  { name: 'Verso', startBar: 1, bars: 8, energy: 3 },
  { name: 'Coro', startBar: 9, bars: 8, energy: 5 }
]

describe('revisión de la canción', () => {
  it('una canción coherente no tiene problemas', () => {
    // El coro sube, pero la unión es suave: entra desde el nivel en que acaba el verso.
    const review = reviewSong(sections, [region(0, -18), region(32, -14, { head: w(-17) })], 4)
    expect(review.issues).toEqual([])
    expect(review.sections.map((s) => s.name)).toEqual(['Verso', 'Coro'])
    expect(review.sections[1].level_db).toBe(-14)
  })

  it('avisa de una unión con un salto de volumen o de brillo', () => {
    const review = reviewSong(
      sections,
      [region(0, -18, { tail: w(-13, -22) }), region(32, -14, { head: w(-16, -13) })],
      4
    )
    expect(review.issues).toEqual([
      { type: 'seam', section: 'Coro', bar: 9, level_jump_db: -3, brightness_jump_db: 9 }
    ])
  })

  it('avisa si el coro no suena más fuerte que el verso', () => {
    const review = reviewSong(sections, [region(0, -14), region(32, -16)], 4)
    expect(review.issues).toContainEqual(
      expect.objectContaining({ type: 'flat_energy', section: 'Coro', quieter_than: 'Verso' })
    )
  })

  it('avisa de una sección apagada (casi sin agudos)', () => {
    const dark = { head: w(-14, -35), tail: w(-14, -35), mean: w(-14, -35) }
    const review = reviewSong(sections, [region(0, -18), region(32, -14, dark)], 4)
    expect(review.issues).toContainEqual({ type: 'dull', section: 'Coro', brightness_db: -35 })
  })

  it('sin energía planificada no juzga la curva', () => {
    const plain = sections.map((s) => ({ name: s.name, startBar: s.startBar, bars: s.bars }))
    expect(reviewSong(plain, [region(0, -14), region(32, -16)], 4).issues).toEqual([])
  })
})
