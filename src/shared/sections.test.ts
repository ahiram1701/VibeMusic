import { describe, expect, it } from 'vitest'
import { createProject, createTrack, type Project, type Region } from './project'
import {
  appendSection,
  copySection,
  removeSection,
  sectionRangeSec,
  sectionsOf,
  setSections,
  updateSection
} from './sections'

const region = (id: string, startBeat: number, lengthSec: number): Region => ({
  id,
  clipId: 'c',
  startBeat,
  offsetSec: 0,
  lengthSec,
  fadeInSec: 0,
  fadeOutSec: 0
})

/** 120 BPM, 4/4: 1 compás = 4 beats = 2 s. */
const base = (): Project => ({ ...createProject('t'), bpm: 120 })

describe('secciones', () => {
  it('añade secciones una detrás de otra con nombres sugeridos', () => {
    let p = appendSection(base(), 4)
    p = appendSection(p, 8)
    p = appendSection(p, 8, 'Mi estribillo')
    expect(sectionsOf(p).map((s) => [s.name, s.startBar, s.bars])).toEqual([
      ['Intro', 1, 4],
      ['Estrofa', 5, 8],
      ['Mi estribillo', 13, 8]
    ])
  })

  it('rechaza solapes y datos inválidos con mensajes claros', () => {
    expect(() =>
      setSections(base(), [
        { name: 'A', startBar: 1, bars: 8 },
        { name: 'B', startBar: 5, bars: 4 }
      ])
    ).toThrow(/"B" se solapa con "A"/)
    expect(() => setSections(base(), [{ name: 'A', startBar: 0, bars: 4 }])).toThrow(/entero ≥ 1/)
    expect(() => setSections(base(), [{ name: ' ', startBar: 1, bars: 4 }])).toThrow(/nombre/)
    const p = appendSection(base(), 4)
    expect(() => updateSection(p, 'nope', { bars: 2 })).toThrow(/No existe/)
  })

  it('renombra, cambia la longitud y elimina', () => {
    let p = appendSection(appendSection(base(), 4), 4)
    const [a, b] = sectionsOf(p)
    p = updateSection(p, a.id, { name: ' Intro larga ', bars: 4 })
    expect(sectionsOf(p)[0].name).toBe('Intro larga')
    expect(() => updateSection(p, a.id, { bars: 6 })).toThrow(/se solapa/)
    p = removeSection(p, b.id)
    expect(sectionsOf(p)).toHaveLength(1)
  })

  it('calcula el rango en segundos para el bucle', () => {
    const p = setSections(base(), [{ name: 'Estribillo', startBar: 3, bars: 2 }])
    expect(sectionRangeSec(p, sectionsOf(p)[0])).toEqual({ startSec: 4, endSec: 8 })
  })

  it('copia una sección con su audio al final, recortando lo que sobresale', () => {
    let p = setSections(base(), [
      { name: 'Intro', startBar: 1, bars: 2 },
      { name: 'Estribillo', startBar: 3, bars: 2 }
    ])
    p = {
      ...p,
      tracks: [
        {
          ...createTrack('Drums', 'drums'),
          // dentro del estribillo (compás 3, 2 s) y otra que se sale (compás 4, 4 s)
          regions: [region('intro', 0, 4), region('a', 8, 2), region('b', 12, 4)]
        }
      ]
    }
    const chorus = sectionsOf(p)[1]
    const out = copySection(p, chorus.id)

    expect(sectionsOf(out).map((s) => [s.name, s.startBar])).toEqual([
      ['Intro', 1],
      ['Estribillo', 3],
      ['Estribillo', 5]
    ])
    const copies = out.tracks[0].regions.slice(3)
    expect(copies.map((r) => [r.startBeat, r.lengthSec])).toEqual([
      [16, 2],
      [20, 2] // recortada: la sección acaba en el compás 5
    ])
    expect(copies[1].fadeOutSec).toBeGreaterThan(0) // fundido en el corte
    expect(out.tracks[0].regions.slice(0, 3)).toEqual(p.tracks[0].regions) // original intacto
  })

  it('no copia encima de otra sección', () => {
    const p = setSections(base(), [
      { name: 'A', startBar: 1, bars: 4 },
      { name: 'B', startBar: 5, bars: 4 }
    ])
    expect(() => copySection(p, sectionsOf(p)[0].id, 3)).toThrow(/se solapa/)
  })
})
