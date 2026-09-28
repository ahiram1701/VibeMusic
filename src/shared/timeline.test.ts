import { describe, expect, it } from 'vitest'
import { createProject } from './project'
import { snapBeat } from './timeline'

const project = createProject('Test') // 4/4

describe('snapBeat', () => {
  it('ajusta al beat más cercano', () => {
    expect(snapBeat(5.7, 'beat', project)).toBe(6)
    expect(snapBeat(5.3, 'beat', project)).toBe(5)
  })

  it('ajusta al compás más cercano en 4/4', () => {
    expect(snapBeat(5.7, 'bar', project)).toBe(4)
    expect(snapBeat(6.5, 'bar', project)).toBe(8)
  })

  it('soporta subdivisiones sin ruido de coma flotante', () => {
    expect(snapBeat(1.3, 'quarter', project)).toBe(1.25)
    expect(snapBeat(0.1 + 0.2, 'quarter', project)).toBe(0.25)
  })

  it('sin rejilla deja la posición tal cual', () => {
    expect(snapBeat(3.14, 'off', project)).toBe(3.14)
  })

  it('nunca devuelve posiciones negativas', () => {
    expect(snapBeat(-3, 'beat', project)).toBe(0)
    expect(snapBeat(-1, 'off', project)).toBe(0)
  })
})
