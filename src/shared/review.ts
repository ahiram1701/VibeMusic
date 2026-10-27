// El productor "escucha" la canción terminada: medidas sencillas (volumen y brillo por
// segundo, las de drone.ts) de cada sección y de cada unión entre tramos, y una lista
// de problemas concretos que sabría oír un productor: un corte en una unión, un coro
// que no sube respecto al verso, una sección apagada. Puro para probarlo.

import type { WindowStats } from './drone'

/** Lo que suena de una región de la pista de la canción. */
export interface RegionSound {
  startBeat: number
  endBeat: number
  /** Primer y último cuarto de segundo de la región, y la media de toda ella. */
  head: WindowStats
  tail: WindowStats
  mean: WindowStats
}

export interface ReviewSection {
  name: string
  startBar: number
  bars: number
  energy?: number
}

export type ReviewIssue =
  | {
      type: 'seam'
      section: string
      bar: number
      level_jump_db: number
      brightness_jump_db: number
    }
  | {
      type: 'flat_energy'
      section: string
      quieter_than: string
      level_db: number
      other_db: number
    }
  | { type: 'dull'; section: string; brightness_db: number }

export interface SongReview {
  sections: { name: string; level_db: number; brightness_db: number }[]
  issues: ReviewIssue[]
}

/** Umbrales: lo que ya se oye como un cambio en seco o una sección sin vida. */
// Calibrado con una canción real con cortes audibles: en cuartos de segundo, sus
// uniones saltaban 2-3,5 dB de volumen y 5-8 dB de agudos.
export const SEAM_LEVEL_DB = 3
export const SEAM_BRIGHTNESS_DB = 5
export const DULL_DB = -28
/** Un coro (más energía) debe sonar al menos así de fuerte respecto al verso. */
const ENERGY_MARGIN_DB = 0.5

const r1 = (n: number): number => Math.round(n * 10) / 10

/** Media en potencia (no en dB) de varias medidas, ponderada por duración. */
function average(parts: { stats: WindowStats; weight: number }[]): WindowStats | null {
  const total = parts.reduce((n, p) => n + p.weight, 0)
  if (total <= 0) return null
  let power = 0
  let high = 0
  for (const { stats, weight } of parts) {
    const p = Math.pow(10, stats.db / 10)
    power += p * weight
    high += p * Math.pow(10, stats.highDb / 10) * weight
  }
  return {
    db: 10 * Math.log10(power / total + 1e-24),
    highDb: 10 * Math.log10(high / power + 1e-12)
  }
}

export function reviewSong(
  sections: ReviewSection[],
  regions: RegionSound[],
  beatsPerBar: number
): SongReview {
  const sorted = [...regions].sort((a, b) => a.startBeat - b.startBeat)
  const sectionAt = (beat: number): ReviewSection | undefined =>
    sections.find(
      (s) =>
        beat >= (s.startBar - 1) * beatsPerBar && beat < (s.startBar - 1 + s.bars) * beatsPerBar
    )
  const issues: ReviewIssue[] = []

  // Uniones: el final de una región contra el principio de la que la sigue.
  for (let i = 0; i + 1 < sorted.length; i++) {
    const a = sorted[i]
    const b = sorted[i + 1]
    if (Math.abs(a.endBeat - b.startBeat) > 0.05) continue
    const level = b.head.db - a.tail.db
    const bright = b.head.highDb - a.tail.highDb
    if (Math.abs(level) > SEAM_LEVEL_DB || Math.abs(bright) > SEAM_BRIGHTNESS_DB) {
      issues.push({
        type: 'seam',
        section: sectionAt(b.startBeat)?.name ?? '?',
        bar: Math.round(b.startBeat / beatsPerBar) + 1,
        level_jump_db: r1(level),
        brightness_jump_db: r1(bright)
      })
    }
  }

  // Por sección: la media de lo que suena dentro de ella.
  const measured = sections.map((s) => {
    const a = (s.startBar - 1) * beatsPerBar
    const b = a + s.bars * beatsPerBar
    const stats = average(
      sorted
        .map((r) => ({ stats: r.mean, weight: Math.min(b, r.endBeat) - Math.max(a, r.startBeat) }))
        .filter((p) => p.weight > 0)
    )
    return { section: s, stats }
  })
  for (const { section, stats } of measured) {
    if (stats && stats.highDb < DULL_DB) {
      issues.push({ type: 'dull', section: section.name, brightness_db: r1(stats.highDb) })
    }
  }

  // La curva de energía: la sección más intensa del plan debe sonar más fuerte que
  // las más tranquilas (se compara con la de menos energía que sí suena).
  const planned = measured.filter((m) => m.stats && m.section.energy !== undefined)
  for (const hi of planned) {
    const calmer = planned.filter((lo) => lo.section.energy! < hi.section.energy! - 1)
    const loudest = calmer.sort((x, y) => y.stats!.db - x.stats!.db)[0]
    if (loudest && hi.stats!.db < loudest.stats!.db + ENERGY_MARGIN_DB) {
      if (issues.some((x) => x.type === 'flat_energy' && x.section === hi.section.name)) continue
      issues.push({
        type: 'flat_energy',
        section: hi.section.name,
        quieter_than: loudest.section.name,
        level_db: r1(hi.stats!.db),
        other_db: r1(loudest.stats!.db)
      })
    }
  }

  return {
    sections: measured
      .filter((m) => m.stats)
      .map((m) => ({
        name: m.section.name,
        level_db: r1(m.stats!.db),
        brightness_db: r1(m.stats!.highDb)
      })),
    issues
  }
}
