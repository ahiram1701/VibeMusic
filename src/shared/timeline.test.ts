import { describe, expect, it } from 'vitest'
import { createProject } from './project'
import { formatClock, jumpTarget, parsePosition, snapBeat } from './timeline'

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

describe('formatClock y parsePosition', () => {
  const at120 = { ...project, bpm: 120 } // 1 compás = 2 s

  it('formatea minutos:segundos', () => {
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(47.9)).toBe('0:47')
    expect(formatClock(151)).toBe('2:31')
    expect(formatClock(725)).toBe('12:05')
  })

  it('entiende compás, compás.tiempo y minutos:segundos', () => {
    expect(parsePosition('1', at120)).toBe(0)
    expect(parsePosition('9', at120)).toBe(16)
    expect(parsePosition(' 9.3 ', at120)).toBe(17)
    expect(parsePosition('9,3', at120)).toBe(17)
    expect(parsePosition('1:23', at120)).toBe(83)
    expect(parsePosition('0:05.5', at120)).toBe(5.5)
  })

  it('rechaza lo que no existe', () => {
    for (const bad of ['', 'abc', '0', '9.5', '9.0', '1:75', '-3']) {
      expect(parsePosition(bad, at120), bad).toBeNull()
    }
  })
})

describe('jumpTarget (atajos)', () => {
  // 120 BPM, 4/4: 1 compás = 2 s. Secciones en los compases 1, 5 y 9; audio hasta 20 s.
  const song = {
    ...project,
    bpm: 120,
    sections: [
      { id: 'a', name: 'Intro', startBar: 1, bars: 4 },
      { id: 'b', name: 'Verso', startBar: 5, bars: 4 },
      { id: 'c', name: 'Coro', startBar: 9, bars: 4 }
    ],
    tracks: [
      {
        id: 't',
        name: 'x',
        role: 'full' as const,
        gainDb: 0,
        pan: 0,
        mute: false,
        solo: false,
        regions: [
          {
            id: 'r',
            clipId: 'c',
            startBeat: 0,
            offsetSec: 0,
            lengthSec: 20,
            fadeInSec: 0,
            fadeOutSec: 0
          }
        ]
      }
    ]
  }

  it('inicio y final', () => {
    expect(jumpTarget('start', 7, song)).toBe(0)
    expect(jumpTarget('end', 7, song)).toBe(20)
  })

  it('compás anterior y siguiente', () => {
    expect(jumpTarget('nextBar', 3, song)).toBe(4) // del compás 2 al 3
    expect(jumpTarget('nextBar', 4, song)).toBe(6)
    expect(jumpTarget('prevBar', 5, song)).toBe(4) // a mitad del compás 3: a su inicio
    expect(jumpTarget('prevBar', 4, song)).toBe(2) // ya al inicio: al anterior
    expect(jumpTarget('prevBar', 0, song)).toBe(0)
  })

  it('sección anterior y siguiente', () => {
    expect(jumpTarget('nextSection', 3, song)).toBe(8) // Verso
    expect(jumpTarget('nextSection', 8, song)).toBe(16) // Coro
    expect(jumpTarget('nextSection', 17, song)).toBe(20) // no hay más: al final
    expect(jumpTarget('prevSection', 17, song)).toBe(16)
    expect(jumpTarget('prevSection', 16, song)).toBe(8)
    expect(jumpTarget('prevSection', 1, song)).toBe(0)
  })
})
