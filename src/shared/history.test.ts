import { describe, expect, it } from 'vitest'
import { baseMessage, emptyUndo, recordChange, takeRedo, takeUndo } from './history'
import { createProject, type Project } from './project'

const at = (bpm: number): Project => ({ ...createProject('P'), id: 'fijo', bpm })

describe('deshacer / rehacer', () => {
  it('deshace y rehace en orden', () => {
    const a = at(100)
    const b = at(110)
    const c = at(120)
    let s = recordChange(emptyUndo, a, 'Tempo 110')
    s = recordChange(s, b, 'Tempo 120')

    const u1 = takeUndo(s, c)!
    expect(u1.entry).toEqual({ project: b, message: 'Tempo 120' })
    const u2 = takeUndo(u1.state, b)!
    expect(u2.entry.project).toEqual(a)
    expect(takeUndo(u2.state, a)).toBeNull()

    const r1 = takeRedo(u2.state, a)!
    expect(r1.entry).toEqual({ project: b, message: 'Tempo 110' })
    const r2 = takeRedo(r1.state, b)!
    expect(r2.entry.project).toEqual(c)
    expect(takeRedo(r2.state, c)).toBeNull()
  })

  it('un cambio nuevo borra lo que había para rehacer', () => {
    let s = recordChange(emptyUndo, at(100), 'x')
    s = takeUndo(s, at(110))!.state
    expect(s.redo).toHaveLength(1)
    s = recordChange(s, at(100), 'y')
    expect(s.redo).toHaveLength(0)
  })
})

describe('baseMessage', () => {
  it('quita prefijos encadenados', () => {
    expect(baseMessage('Restaurada v8: Restaurada v7: Pista eliminada')).toBe('Pista eliminada')
    expect(baseMessage('Vuelta a v3: Deshacer: Región eliminada')).toBe('Región eliminada')
    expect(baseMessage('Región movida a 1.1')).toBe('Región movida a 1.1')
  })
})
