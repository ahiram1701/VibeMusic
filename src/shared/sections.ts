import {
  beatsToSeconds,
  newId,
  secondsToBeats,
  type Project,
  type Region,
  type Section
} from './project'

// Secciones de la canción (intro, estrofa, estribillo…). Son marcas en compases que
// no mueven el audio por sí mismas; sirven para orientarse, reproducir en bucle y
// copiar partes enteras con todo su audio.

/** Nombres sugeridos, en el orden típico de una canción. */
export const SECTION_NAMES = [
  'Intro',
  'Estrofa',
  'Estribillo',
  'Estrofa',
  'Estribillo',
  'Puente',
  'Estribillo',
  'Outro'
]

export const sectionsOf = (p: Project): Section[] =>
  [...(p.sections ?? [])].sort((a, b) => a.startBar - b.startBar)

const endBar = (s: Section): number => s.startBar + s.bars

/** Comprueba que una lista de secciones es válida (compases enteros, sin solaparse). */
export function validateSections(sections: Section[]): void {
  const sorted = [...sections].sort((a, b) => a.startBar - b.startBar)
  for (const s of sorted) {
    if (!s.name.trim()) throw new Error('Cada sección necesita un nombre')
    if (!Number.isInteger(s.startBar) || s.startBar < 1) {
      throw new Error(`"${s.name}": el compás de inicio debe ser un entero ≥ 1`)
    }
    if (!Number.isInteger(s.bars) || s.bars < 1 || s.bars > 256) {
      throw new Error(`"${s.name}": la longitud debe ser de 1 a 256 compases`)
    }
  }
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].startBar < endBar(sorted[i - 1])) {
      throw new Error(`"${sorted[i].name}" se solapa con "${sorted[i - 1].name}"`)
    }
  }
}

function withSections(p: Project, sections: Section[]): Project {
  validateSections(sections)
  return { ...p, sections: [...sections].sort((a, b) => a.startBar - b.startBar) }
}

/** Añade una sección detrás de la última (o en el compás 1). */
export function appendSection(p: Project, bars = 8, name?: string): Project {
  const existing = sectionsOf(p)
  const last = existing.at(-1)
  const section: Section = {
    id: newId('sec'),
    name: name ?? SECTION_NAMES[existing.length % SECTION_NAMES.length],
    startBar: last ? endBar(last) : 1,
    bars
  }
  return withSections(p, [...existing, section])
}

/** Sustituye todas las secciones (lo usa el productor para planificar la estructura). */
export function setSections(
  p: Project,
  list: { name: string; startBar: number; bars: number }[]
): Project {
  return withSections(
    p,
    list.map((s) => ({ id: newId('sec'), name: s.name.trim(), startBar: s.startBar, bars: s.bars }))
  )
}

export function updateSection(
  p: Project,
  id: string,
  patch: Partial<Pick<Section, 'name' | 'startBar' | 'bars'>>
): Project {
  const existing = sectionsOf(p)
  if (!existing.some((s) => s.id === id)) throw new Error(`No existe la sección "${id}"`)
  return withSections(
    p,
    existing.map((s) => (s.id === id ? { ...s, ...patch, name: (patch.name ?? s.name).trim() } : s))
  )
}

export function removeSection(p: Project, id: string): Project {
  return withSections(
    p,
    sectionsOf(p).filter((s) => s.id !== id)
  )
}

/** Rango de una sección en segundos (para reproducir en bucle). */
export function sectionRangeSec(p: Project, s: Section): { startSec: number; endSec: number } {
  const perBar = p.timeSignature[0]
  return {
    startSec: beatsToSeconds((s.startBar - 1) * perBar, p.bpm),
    endSec: beatsToSeconds((endBar(s) - 1) * perBar, p.bpm)
  }
}

/**
 * Copia una sección con todo su audio a partir de `toBar` (por defecto, detrás de la
 * última sección). Las regiones que empiezan dentro de la sección se copian con el
 * mismo desplazamiento; si se salen del final de la sección, se recortan en el borde.
 * Si el destino se solapa con otra sección, falla sin tocar nada.
 */
export function copySection(p: Project, id: string, toBar?: number): Project {
  const existing = sectionsOf(p)
  const src = existing.find((s) => s.id === id)
  if (!src) throw new Error(`No existe la sección "${id}"`)
  const target = toBar ?? endBar(existing.at(-1)!)
  const perBar = p.timeSignature[0]
  const srcStart = (src.startBar - 1) * perBar
  const srcEnd = (endBar(src) - 1) * perBar
  const shift = (target - src.startBar) * perBar

  const copy: Section = { id: newId('sec'), name: src.name, startBar: target, bars: src.bars }
  const next = withSections(p, [...existing, copy])

  const tracks = p.tracks.map((t) => {
    const copies: Region[] = []
    for (const r of t.regions) {
      if (r.startBeat < srcStart || r.startBeat >= srcEnd) continue
      const lengthBeats = secondsToBeats(r.lengthSec, p.bpm)
      const clippedBeats = Math.min(lengthBeats, srcEnd - r.startBeat)
      copies.push({
        ...r,
        id: newId('rgn'),
        startBeat: r.startBeat + shift,
        lengthSec: beatsToSeconds(clippedBeats, p.bpm),
        fadeOutSec: clippedBeats < lengthBeats ? Math.min(0.01, r.lengthSec) : r.fadeOutSec
      })
    }
    return copies.length ? { ...t, regions: [...t.regions, ...copies] } : t
  })
  return { ...next, tracks }
}
