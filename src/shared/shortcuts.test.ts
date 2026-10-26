import { describe, expect, it } from 'vitest'
import { searchShortcuts, shortcutHint, SHORTCUTS } from './shortcuts'

describe('atajos', () => {
  it('no hay ids repetidos y todos tienen teclas y descripción', () => {
    const ids = SHORTCUTS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const s of SHORTCUTS) {
      expect(s.keys.length, s.id).toBeGreaterThan(0)
      expect(s.description.trim(), s.id).not.toBe('')
    }
  })

  it('incluye los atajos que maneja la app', () => {
    for (const id of [
      'play',
      'start',
      'end',
      'prevBar',
      'nextBar',
      'prevSection',
      'nextSection',
      'undo',
      'redo',
      'deleteRegion',
      'zoom',
      'help'
    ]) {
      expect(() => shortcutHint(id), id).not.toThrow()
    }
    expect(shortcutHint('prevSection')).toBe('Mayús+←')
    expect(() => shortcutHint('nope')).toThrow(/desconocido/)
  })

  it('busca por descripción, teclas o grupo, sin acentos', () => {
    expect(searchShortcuts('seccion').map((s) => s.id)).toContain('nextSection')
    expect(searchShortcuts('ctrl').map((s) => s.id)).toEqual(
      expect.arrayContaining(['undo', 'redo', 'zoom'])
    )
    expect(searchShortcuts('MEZCLADOR').map((s) => s.id)).toEqual(['mixerReset'])
    expect(searchShortcuts('   ')).toHaveLength(SHORTCUTS.length)
    expect(searchShortcuts('zzz')).toEqual([])
  })
})
