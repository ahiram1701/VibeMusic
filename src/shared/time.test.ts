import { describe, expect, it } from 'vitest'
import { dayLabel, duration, fullDate, relative, shortTime, stopwatch } from './time'

// Martes 14 de octubre de 2026, 00:49 (hora local).
const now = new Date(2026, 9, 14, 0, 49)

describe('time', () => {
  it('hora compacta según lo lejos que quede', () => {
    expect(shortTime(new Date(2026, 9, 14, 0, 5), now)).toBe('00:05')
    expect(shortTime(new Date(2026, 9, 13, 2, 31), now)).toBe('ayer 02:31')
    expect(shortTime(new Date(2026, 9, 10, 9, 0), now)).toBe('sáb 10')
    expect(shortTime(new Date(2026, 8, 28, 9, 0), now)).toBe('28 sept')
    expect(shortTime(new Date(2025, 11, 3, 9, 0), now)).toBe('3 dic 2025')
  })

  it('fecha completa y etiquetas de día', () => {
    expect(fullDate(new Date(2026, 9, 13, 2, 31))).toBe('martes, 13 de octubre de 2026, 02:31')
    expect(dayLabel(new Date(2026, 9, 14, 0, 1), now)).toBe('Hoy')
    expect(dayLabel(new Date(2026, 9, 13, 23, 59), now)).toBe('Ayer')
    expect(dayLabel(new Date(2026, 9, 10), now)).toBe('sábado, 10 de octubre')
  })

  it('tiempo relativo', () => {
    expect(relative(now.getTime() - 20_000, now)).toBe('justo ahora')
    expect(relative(now.getTime() - 3 * 60_000, now)).toBe('hace 3 min')
    expect(relative(new Date(2026, 9, 13, 2, 31), now)).toBe('hace 22 h')
    expect(relative(new Date(2026, 9, 10), now)).toBe('hace 4 días')
  })

  it('duraciones y cronómetro', () => {
    expect(duration(45_000)).toBe('45 s')
    expect(duration(12 * 60_000 + 20_000)).toBe('12 min')
    expect(duration(65 * 60_000)).toBe('1 h 05 min')
    expect(stopwatch(7_000)).toBe('0:07')
    expect(stopwatch(192_000)).toBe('3:12')
    expect(stopwatch(3_909_000)).toBe('1:05:09')
  })
})
