import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ dialog: {} }))
const { safeFileName } = await import('./export')

describe('safeFileName', () => {
  it('quita caracteres no válidos y rutas', () => {
    expect(safeFileName('Mi canción: v2 / final?')).toBe('Mi canción_ v2 _ final_')
    expect(safeFileName('..\\..\\Windows\\system32')).toBe('.._.._Windows_system32')
    expect(safeFileName('   ')).toBe('sin nombre')
    expect(safeFileName('pista. ')).toBe('pista')
  })
})
