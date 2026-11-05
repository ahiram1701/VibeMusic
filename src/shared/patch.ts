// Compases que la mezcla no puede salvar: los que se quedaron sin agudos (un muro grave
// de distorsión, un drone) no se arreglan con un ecualizador, porque no hay agudos que
// subir (test17: un verso a −16 dB de agudos aun con +9 dB de realce). Un productor los
// cambiaría por compases sanos de una sección igual: el coro final que se apaga, por
// compases del primer coro. Aquí se eligen y se empalman, sin regenerar nada.

import { brightened } from './arrange'
import { THIN_DB, THIN_HIGH_DB } from './drone'
import { sectionFamily } from './genres'
import { eqAt } from './playback'
import { beatsToSeconds, newId, secondsToBeats, type Project, type Region } from './project'

/** Región con lo que se midió de cada segundo de su clip (ver soundSummary). */
export type HeardRegion = Pick<
  Region,
  'id' | 'clipId' | 'startBeat' | 'offsetSec' | 'lengthSec' | 'gainDb' | 'brightDb' | 'eq'
> & { seconds: { db: number; highDb: number }[] }

/** Un compás está opaco si sus agudos quedan esto por debajo de la referencia. */
export const DULL_DB = 7
/** O si quedan esto por debajo de lo típico de sus secciones hermanas. */
const SISTER_DULL_DB = 4
/** Y sirve para tapar a otro si no quedan más de esto por debajo. */
const HEALTHY_DB = 5
/** Por debajo de esto un compás es silencio. */
const SILENCE_DB = -45
const PHRASE_BARS = 4

interface BarSound {
  db: number
  highDb: number
}

/**
 * Cómo se oye cada compás de la canción (1 = el primero): volumen y agudos de sus
 * segundos con el volumen, el realce y la curva de su región.
 */
export function heardBars(
  regions: HeardRegion[],
  beatsPerBar: number,
  bpm: number
): Map<number, BarSound> {
  const secPerBar = beatsToSeconds(beatsPerBar, bpm)
  const sums = new Map<number, { power: number; high: number; n: number }>()
  for (const r of regions) {
    const start = beatsToSeconds(r.startBeat, bpm)
    const curve = eqAt(r)
    r.seconds.forEach((w, i) => {
      if (i + 0.5 > r.lengthSec) return
      const c = curve(i + 0.5)
      const lit = brightened(w, (r.brightDb ?? 0) + c.brightDb)
      const db = lit.db + (r.gainDb ?? 0) + c.gainDb
      const bar = Math.floor((start + i + 0.5) / secPerBar) + 1
      const s = sums.get(bar) ?? { power: 0, high: 0, n: 0 }
      const p = Math.pow(10, db / 10)
      s.power += p
      s.high += p * Math.pow(10, lit.highDb / 10)
      s.n += 1
      sums.set(bar, s)
    })
  }
  const out = new Map<number, BarSound>()
  for (const [bar, s] of sums) {
    out.set(bar, {
      db: 10 * Math.log10(s.power / s.n + 1e-24),
      highDb: 10 * Math.log10(s.high / (s.power + 1e-24) + 1e-12)
    })
  }
  return out
}

/** Unos compases opacos y los compases sanos con que se tapan. */
export interface BarPatch {
  section: string
  /** Primer compás tapado y cuántos. */
  bar: number
  bars: number
  /** Primer compás de donde sale el audio. */
  fromBar: number
  /** Región de donde sale y segundo de su clip en que empieza. */
  regionId: string
  offsetSec: number
}

/**
 * Qué compases opacos tapar y con qué. Opaco: sus agudos, ya con la mezcla, quedan
 * DULL_DB por debajo de `reference` (los agudos de la primera región, ver
 * sectionBrightness). Se tapan por frases (no cruzan un múltiplo de 4 compases) con
 * compases sanos de una sección de la misma familia (un coro con un coro), de la misma
 * región para que el audio sea seguido, y mejor en la misma posición de la frase. Nunca
 * en secciones tranquilas (energía ≤ 2), ni el primer y el último compás de la canción,
 * ni el siseo o el silencio. Sin donante, el compás se queda como está.
 */
export function planDullPatches(
  sections: { name: string; startBar: number; bars: number; energy?: number }[],
  regions: HeardRegion[],
  beatsPerBar: number,
  bpm: number,
  reference: number
): BarPatch[] {
  const heard = heardBars(regions, beatsPerBar, bpm)
  const sounding = (h: BarSound | undefined): h is BarSound =>
    !!h && h.db >= SILENCE_DB && !(h.db < THIN_DB && h.highDb > THIN_HIGH_DB)
  const bars = [...heard.keys()]
  const firstBar = Math.min(...bars)
  const lastBar = Math.max(...bars)
  const dullBelow = (bar: number, threshold: number): boolean => {
    const h = heard.get(bar)
    return bar !== firstBar && bar !== lastBar && sounding(h) && h.highDb < threshold
  }
  const healthy = (bar: number): boolean => {
    const h = heard.get(bar)
    return sounding(h) && h.highDb >= reference - HEALTHY_DB
  }
  const energyOf = (s: (typeof sections)[number]): number =>
    s.energy ?? sections.find((o) => o.name === s.name && o.energy !== undefined)?.energy ?? 3
  // La región que cubre entera los compases [bar, bar + n), si hay una.
  const regionOver = (bar: number, n: number): HeardRegion | undefined => {
    const a = (bar - 1) * beatsPerBar
    const b = a + n * beatsPerBar
    return regions.find(
      (r) => r.startBeat <= a + 0.05 && r.startBeat + secondsToBeats(r.lengthSec, bpm) >= b - 0.05
    )
  }
  const barsOf = (s: (typeof sections)[number]): number[] =>
    Array.from({ length: s.bars }, (_, i) => s.startBar + i)
  const patches: BarPatch[] = []
  for (const s of sections) {
    if (energyOf(s) <= 2) continue
    const family = sectionFamily(s.name)
    const kin = sections.filter((o) => sectionFamily(o.name) === family)
    // Opaco respecto a la referencia o a sus hermanas: un coro final 7 dB más apagado
    // que el primer coro se oye aunque no llegue al umbral general (test17: 5 dB con
    // esta medida, que aprieta las diferencias).
    const sister = kin
      .filter((o) => o !== s)
      .flatMap(barsOf)
      .map((bar) => heard.get(bar))
      .filter(sounding)
      .map((h) => h.highDb)
      .sort((x, y) => x - y)
    const typical = sister.length ? sister[Math.floor(sister.length / 2)] : -Infinity
    const threshold = Math.max(reference - DULL_DB, typical - SISTER_DULL_DB)
    const dull = (bar: number): boolean => dullBelow(bar, threshold)
    // Una frase con varios compases opacos se cambia entera (a trozos sonaría a
    // parches); si no hay una frase sana entera, o solo tiene uno, por compases.
    const chunks: { bar: number; bars: number; whole: boolean }[] = []
    for (let phrase = s.startBar; phrase < s.startBar + s.bars; phrase += PHRASE_BARS) {
      const len = Math.min(PHRASE_BARS, s.startBar + s.bars - phrase)
      const inPhrase = Array.from({ length: len }, (_, i) => phrase + i).filter(dull)
      if (inPhrase.length >= 2 && len === PHRASE_BARS) {
        chunks.push({ bar: phrase, bars: len, whole: true })
        continue
      }
      for (const bar of inPhrase) {
        const prev = chunks[chunks.length - 1]
        if (prev && !prev.whole && prev.bar + prev.bars === bar) prev.bars += 1
        else chunks.push({ bar, bars: 1, whole: false })
      }
    }
    const donorFor = (chunk: { bar: number; bars: number }) => {
      const want = (chunk.bar - s.startBar) % PHRASE_BARS
      let best: { score: number; from: number; region: HeardRegion } | null = null
      for (const o of kin) {
        for (let from = o.startBar; from + chunk.bars <= o.startBar + o.bars; from++) {
          const overlaps = from < chunk.bar + chunk.bars && from + chunk.bars > chunk.bar
          if (overlaps) continue
          let ok = true
          let worst = 0
          for (let k = 0; k < chunk.bars && ok; k++) {
            ok = healthy(from + k)
            worst = Math.min(worst, heard.get(from + k)?.highDb ?? -99)
          }
          if (!ok) continue
          const region = regionOver(from, chunk.bars)
          if (!region) continue
          // Mejor la misma posición en la frase, luego otra sección, el mismo sitio dentro
          // de ella (la segunda mitad del coro por la segunda) y luego lo más brillante.
          const score =
            ((from - o.startBar) % PHRASE_BARS === want ? 100 : 0) +
            (o === s ? 0 : 10) +
            (from - o.startBar === chunk.bar - s.startBar ? 5 : 0) +
            Math.max(-9, worst - reference)
          if (!best || score > best.score) best = { score, from, region }
        }
      }
      return best
    }
    const push = (chunk: { bar: number; bars: number }): boolean => {
      const best = donorFor(chunk)
      if (!best) return false
      const startSec = beatsToSeconds((best.from - 1) * beatsPerBar - best.region.startBeat, bpm)
      patches.push({
        section: s.name,
        bar: chunk.bar,
        bars: chunk.bars,
        fromBar: best.from,
        regionId: best.region.id,
        offsetSec: best.region.offsetSec + startSec
      })
      return true
    }
    for (const chunk of chunks) {
      if (push(chunk) || !chunk.whole) continue
      // Sin frase sana entera: los compases opacos de la frase, de uno en uno.
      for (let bar = chunk.bar; bar < chunk.bar + chunk.bars; bar++) {
        if (dull(bar)) push({ bar, bars: 1 })
      }
    }
  }
  return patches
}

/**
 * Pone en la pista `trackId`, desde el pulso `atBeat` y durante `beats`, el audio de
 * `donor` desde el segundo `offsetSec` de su clip: lo que hubiera ahí se corta (lo de
 * antes y lo de después siguen sonando). La región nueva lleva la mezcla del donante.
 */
export function spliceBars(
  p: Project,
  trackId: string,
  atBeat: number,
  beats: number,
  donor: Region,
  offsetSec: number,
  fromBar: number
): Project {
  const end = atBeat + beats
  const sec = (b: number): number => beatsToSeconds(b, p.bpm)
  return {
    ...p,
    tracks: p.tracks.map((t) => {
      if (t.id !== trackId) return t
      const regions: Region[] = []
      for (const r of t.regions) {
        const re = r.startBeat + secondsToBeats(r.lengthSec, p.bpm)
        if (re <= atBeat + 0.01 || r.startBeat >= end - 0.01) {
          regions.push(r)
          continue
        }
        if (r.startBeat < atBeat - 0.01) {
          regions.push({ ...r, lengthSec: sec(atBeat - r.startBeat), fadeOutSec: 0.01 })
        }
        if (re > end + 0.01) {
          const after: Region = {
            ...r,
            id: newId('rgn'),
            startBeat: end,
            offsetSec: r.offsetSec + sec(Math.max(0, end - r.startBeat)),
            lengthSec: sec(re - end),
            fadeInSec: 0.01
          }
          delete after.leadInSec
          regions.push(after)
        }
      }
      const patch: Region = {
        id: newId('rgn'),
        clipId: donor.clipId,
        startBeat: atBeat,
        offsetSec,
        lengthSec: sec(beats),
        fadeInSec: 0.01,
        fadeOutSec: 0.01,
        ...(donor.gainDb !== undefined && { gainDb: donor.gainDb }),
        ...(donor.brightDb !== undefined && { brightDb: donor.brightDb }),
        ...(donor.eq && { eq: donor.eq }),
        patchFromBar: fromBar
      }
      regions.push(patch)
      return { ...t, regions: regions.sort((a, b) => a.startBeat - b.startBeat) }
    })
  }
}
