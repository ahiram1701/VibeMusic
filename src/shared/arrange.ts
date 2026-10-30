import {
  beatsToSeconds,
  newId,
  secondsToBeats,
  type Project,
  type Region,
  type Section,
  type Track,
  type TrackRole
} from './project'
import { THIN_DB, THIN_HIGH_DB } from './drone'
import { lyricsLanguages } from './lyrics-language'
import { sectionsOf } from './sections'

// Arreglo automático. El productor escribe el arreglo (qué suena y con qué energía en
// cada sección) y este módulo hace lo mecánico: en qué tramos se genera la canción,
// qué se pide en cada uno (con sus transiciones) y qué huecos quedan.
// Los motores tipo MusicGen se entrenaron con mezclas completas y saben *continuar*
// audio: por eso la canción se genera como una sola interpretación, tramo a tramo,
// cada uno continuando al anterior, en lugar de capas sueltas que no se escuchan
// entre sí. Todo es puro (sin E/S) para poder probarlo sin la app.

/** Una canción tal como la describe el productor en `compose_song`. */
export interface SongSpec {
  style: string
  /** Cómo es la voz que canta, en inglés (solo si hay letra). */
  vocals: string | null
  /** Idioma de la letra (ISO 639-1, p. ej. "es"), o null si no se indicó. */
  language: string | null
  sections: {
    name: string
    bars: number
    arrangement: string
    /** 1 (mínima) a 5 (máxima); sirve para elegir las transiciones. */
    energy: number | null
    /** Repite el audio de la sección anterior con el mismo nombre en vez de generarlo. */
    reuse: boolean
    /** Letra cantada en esta sección; null si es instrumental. */
    lyrics: string | null
    /** Melodía de la letra para el cantante local (una entrada por frase), o null. */
    melody: { text: string; notes: string; lang?: string }[] | null
  }[]
}

/** Un paso de la composición: generar un tramo o repetir una sección ya hecha. */
export interface GenerateStep {
  kind: 'generate'
  section: number
  /** Compás (1 = primero) donde empieza el tramo. */
  startBar: number
  bars: number
  prompt: string
}

export type ChunkStep =
  | GenerateStep
  /** Copia la sección `from`; si salió atascada, se graban `fallback` en su lugar. */
  | { kind: 'reuse'; section: number; from: number; fallback: GenerateStep[] }

type Input = Record<string, unknown>

/** Los modelos pequeños a veces mandan listas u objetos serializados como texto. */
function parseJsonish(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw
  const t = raw.trim()
  if (!t.startsWith('[') && !t.startsWith('{')) return raw
  try {
    return JSON.parse(t)
  } catch {
    return raw
  }
}

function toNumber(raw: unknown): number {
  return typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : (raw as number)
}

export const sameName = (a: string, b: string): boolean =>
  a.trim().toLowerCase() === b.trim().toLowerCase()

/**
 * Valida y normaliza la canción que manda el LLM. Los errores dicen exactamente qué
 * corregir, porque el modelo los lee y vuelve a intentarlo.
 */
export function parseSongSpec(input: Input): SongSpec {
  const style = typeof input.style === 'string' ? input.style.trim() : ''
  if (!style) throw new Error('Falta "style": el sonido común de la canción, en inglés')

  const rawSections = parseJsonish(input.sections)
  if (!Array.isArray(rawSections) || rawSections.length === 0) {
    throw new Error(
      '"sections" debe ser una lista: [{"name": "Intro", "bars": 8, "arrangement": "..."}]'
    )
  }
  const sections: SongSpec['sections'] = []
  for (const [i, item] of rawSections.entries()) {
    const it = (item ?? {}) as Input
    const name = typeof it.name === 'string' ? it.name.trim() : ''
    if (!name) throw new Error(`Sección ${i + 1}: falta "name"`)
    const bars = toNumber(it.bars)
    if (typeof bars !== 'number' || !Number.isFinite(bars) || bars < 1 || bars > 64) {
      throw new Error(`Sección "${name}": "bars" debe ser un número de 1 a 64`)
    }
    const reuse = it.reuse === true || it.reuse === 'true'
    if (reuse && !sections.some((s) => sameName(s.name, name))) {
      throw new Error(
        `Sección "${name}": "reuse" repite una sección anterior con el mismo nombre, y no hay ninguna antes`
      )
    }
    const arrangement = typeof it.arrangement === 'string' ? it.arrangement.trim() : ''
    if (!arrangement && !reuse) {
      throw new Error(
        `Sección "${name}": falta "arrangement" (qué instrumentos suenan y con qué energía, en inglés)`
      )
    }
    const rawEnergy = it.energy === undefined || it.energy === null ? null : toNumber(it.energy)
    const energy =
      typeof rawEnergy === 'number' && Number.isFinite(rawEnergy)
        ? Math.min(5, Math.max(1, Math.round(rawEnergy)))
        : null
    const melody = parseMelodyLines(it.melody, name)
    // Con melodía, la letra son sus frases (así no pueden quedar distintas).
    const lyrics = melody
      ? melody.map((l) => l.text).join('\n')
      : typeof it.lyrics === 'string' && it.lyrics.trim()
        ? cleanLyrics(it.lyrics)
        : null
    sections.push({ name, bars: Math.round(bars), arrangement, energy, reuse, lyrics, melody })
  }
  if (sections.every((s) => s.reuse)) throw new Error('Alguna sección tiene que generarse')
  const vocals =
    typeof input.vocals === 'string' && input.vocals.trim() ? input.vocals.trim() : null
  const rawLanguage = typeof input.language === 'string' ? input.language.trim().toLowerCase() : ''
  const language = /^[a-z]{2,3}$/.test(rawLanguage) ? rawLanguage : null
  return { style, vocals, language, sections }
}

/** Frases con su melodía tal como las manda el LLM: [{text, notes}]. null si no hay. */
export function parseMelodyLines(
  raw: unknown,
  section: string
): { text: string; notes: string; lang?: string }[] | null {
  const value = parseJsonish(raw)
  if (value === undefined || value === null || (Array.isArray(value) && value.length === 0)) {
    return null
  }
  if (!Array.isArray(value)) {
    throw new Error(
      `Sección "${section}": "melody" debe ser una lista de frases: [{"text": "...", "notes": "A4 B4:0.5 ..."}]`
    )
  }
  return value.map((item, i) => {
    const it = (item ?? {}) as Input
    const text = typeof it.text === 'string' ? it.text.trim() : ''
    const notes = typeof it.notes === 'string' ? it.notes.trim() : ''
    if (!text || !notes) {
      throw new Error(`Sección "${section}", frase ${i + 1}: falta "text" o "notes"`)
    }
    const lang = typeof it.lang === 'string' ? it.lang.trim().toLowerCase() : ''
    return { text, notes, ...(/^[a-z]{2}$/.test(lang) && { lang }) }
  })
}

// --- Letra -------------------------------------------------------------------
// Los motores que cantan (ACE-Step) reciben la letra de toda la canción en un solo
// texto, con una etiqueta por sección: "[Verse]", "[Chorus]"… Así saben dónde va
// cada parte y qué repetir con más fuerza.

/** Quita líneas vacías de más y espacios sobrantes de una letra escrita a mano o por el LLM. */
export function cleanLyrics(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l, i, all) => l !== '' || (i > 0 && all[i - 1] !== ''))
    .join('\n')
    .trim()
}

const TAGS: [RegExp, string][] = [
  [/^pre.?(coro|chorus|estribillo)/, 'Pre-Chorus'],
  [/^(coro|chorus|estribillo|hook|refran)/, 'Chorus'],
  [/^(verso|verse|estrofa)/, 'Verse'],
  [/^(puente|bridge)/, 'Bridge'],
  [/^intro/, 'Intro'],
  [/^(outro|final|cierre|coda)/, 'Outro']
]

/** Etiqueta de ACE-Step para una sección según su nombre ("Coro 2" → "Chorus"). */
export function lyricsTag(name: string, sung: boolean): string {
  const n = name.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()
  const tag = TAGS.find(([re]) => re.test(n))?.[1]
  // Sin letra, solo la intro y el final conservan su nombre; el resto es instrumental.
  if (sung) return tag ?? 'Verse'
  return tag === 'Intro' || tag === 'Outro' ? tag : 'Instrumental'
}

/** Letra de la canción completa: una etiqueta por sección y su texto (vacío si es instrumental). */
export function formatLyrics(sections: { name: string; lyrics?: string | null }[]): string {
  return sections
    .map((s) => {
      const text = s.lyrics ? cleanLyrics(s.lyrics) : ''
      const tag = `[${lyricsTag(s.name, !!text)}]`
      return text ? `${tag}\n${text}` : tag
    })
    .join('\n\n')
}

/** ¿Tiene letra alguna sección? */
export function hasLyrics(sections: { lyrics?: string | null }[]): boolean {
  return sections.some((s) => !!s.lyrics?.trim())
}

const languageName = (code: string): string => ({ es: 'Spanish', en: 'English' })[code] ?? code

/**
 * Lo que hay que pedir al motor para cantar la canción del proyecto entera, de una
 * vez: descripción del sonido y la voz, la letra con sus etiquetas y cuántos compases
 * dura (desde el compás 1 hasta el final de la última sección).
 */
export function vocalSongRequest(p: Project): {
  prompt: string
  lyrics: string
  language?: string
  bars: number
} {
  const sections = sectionsOf(p)
  if (!hasLyrics(sections)) throw new Error('La canción no tiene letra')
  const bars = Math.max(...sections.map((s) => s.startBar + s.bars - 1))
  const lyrics = formatLyrics(sections)
  // Con la letra mezclando español e inglés no se fija el idioma: fijarlo obliga al
  // motor a pronunciarlo todo así ("baby" a la española). Se le describe la mezcla.
  const langs = p.lyricsLanguage ? lyricsLanguages(lyrics, p.lyricsLanguage) : []
  const mixed = langs.length > 1
  const prompt = [
    p.style?.trim(),
    p.vocals?.trim(),
    mixed &&
      `bilingual ${langs.map(languageName).join(' and ')} lyrics, English lines sung with native English pronunciation`
  ]
    .filter(Boolean)
    .join(', ')
  return {
    prompt: prompt || 'song with vocals',
    lyrics,
    ...(p.lyricsLanguage && !mixed && { language: p.lyricsLanguage }),
    bars
  }
}

/**
 * Compases por tramo: cada continuación lleva hasta `contextSec` de audio previo y el
 * motor genera como mucho `maxSec` en total, así que caben `(maxSec − contexto)`
 * segundos nuevos. Se redondea a 8 o 4 compases (frases musicales) si caben.
 */
export function chunkBars(secPerBar: number, maxSec: number, contextSec: number): number {
  const fit = Math.floor((maxSec - contextSec) / secPerBar)
  if (fit >= 8) return 8
  if (fit >= 4) return 4
  return Math.max(1, fit)
}

// --- Prompts para MusicGen ----------------------------------------------------
// MusicGen se entrenó con descripciones cortas tipo etiquetas ("latin pop, guitar,
// drums, 96 bpm"). Con prompts largos se diluye y, si abundan "dark", "sub bass" o
// "reverb", colapsa en un drone grave. Tampoco entiende negaciones: "not ambient"
// le empuja hacia lo ambiental. Por eso cada tramo lleva pocas palabras, todas
// positivas, y el tempo.

/** Palabras máximas del estilo y del arreglo dentro del prompt de un tramo. */
export const STYLE_WORDS = 15
export const ARRANGEMENT_WORDS = 15

/**
 * Recorta un texto a `max` palabras quedándose con frases completas (separadas por
 * comas); si la primera ya es más larga, la corta por palabras.
 */
export function clampWords(text: string, max: number): string {
  const words = (t: string): string[] => t.split(/\s+/).filter(Boolean)
  const kept: string[] = []
  let count = 0
  for (const phrase of text
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)) {
    const n = words(phrase).length
    if (count + n > max) {
      if (kept.length === 0) kept.push(words(phrase).slice(0, max).join(' '))
      break
    }
    kept.push(phrase)
    count += n
  }
  return kept.join(', ')
}

/**
 * Lo que tiene que seguir sonando según la energía (MusicGen no entiende el número).
 * Con batería programada, el ritmo lo pone la batería: la cama pide el pulso con el
 * bajo ("groove"), sin "drums" (ver withoutPercussion).
 */
export function energyHint(energy: number | null, { drums = false } = {}): string {
  if (energy !== null && energy <= 2) return drums ? 'groove' : 'soft drums, groove'
  if (energy !== null && energy >= 4)
    return drums ? 'energetic, full groove' : 'energetic, full drums'
  return drums ? 'steady groove' : 'steady beat'
}

/**
 * Con batería programada la app filtra la cama (intro que se abre, break apagado): si
 * además el prompt pide "filtered", MusicGen la entrega ya oscura y el filtro de la
 * mezcla la deja en un zumbido grave. Se quitan esas palabras del arreglo.
 */
const FILTER_WORDS = /\b(filtered|muffled|low-?pass(ed)?|high-?pass(ed)?)\b/gi

export function withoutFilterWords(text: string): string {
  return text
    .split(',')
    .map((p) => p.replace(FILTER_WORDS, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(', ')
}

/** Instrumentos de percusión (y sus giros: "four-on-the-floor", "drum fill"…). */
const PERCUSSION =
  /\b(kicks?|drums?|percussion|cowbells?|congas?|bongos?|claps?|hi-?hats?|hats?|shakers?|snares?|cymbals?|crash|rims?(hot)?|toms?|four-on-the-floor|808s?|beats?)\b/i

/**
 * Con batería programada, la cama no pide percusión: con "kick, metallic percussion,
 * cowbell, congas" MusicGen tocaba solo eso y, sin bajo ni sintes, se vaciaba en
 * unos hats débiles (test8: 5 de 11 tramos), y encima la batería ya lo toca. Quita
 * cada trozo (entre comas, "and" o "with") que nombre percusión y deja el resto:
 * "kick and rolling bassline" → "rolling bassline".
 */
export function withoutPercussion(text: string): string {
  return text
    .split(',')
    .map((phrase) =>
      phrase
        .split(/\s+(?:and|with|&|\+)\s+/i)
        .map((p) => p.trim())
        .filter((p) => p && !PERCUSSION.test(p))
        .join(' and ')
    )
    .filter(Boolean)
    .join(', ')
}

/**
 * Palabras que hunden la cama en un zumbido grave. Con batería programada no hay
 * percusión en el prompt que las equilibre (test11: "industrial …, low rolling
 * bassline" perdió los agudos a mitad de la subida y el drop salió zumbido dos veces).
 */
const DRONE_WORDS =
  /\b(industrial|dark|low|deep|sub|rumbling|ambient|atmospheric|cinematic|drone|droning)\b/gi

/** Prompt de la cama cuando la batería es programada: sin filtros, percusión ni graves. */
export function bedText(text: string): string {
  return withoutPercussion(withoutFilterWords(text))
    .split(',')
    .map((p) => p.replace(DRONE_WORDS, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(', ')
}

/**
 * Quita del arreglo lo que ya dice el estilo: "rolling bassline" en los dos pedía el
 * bajo dos veces en cada tramo y la cama se iba al grave.
 */
export function withoutStyleRepeats(arrangement: string, style: string): string {
  const norm = (t: string): string => t.toLowerCase().replace(/\s+/g, ' ').trim()
  const said = new Set(style.split(',').map(norm))
  return arrangement
    .split(',')
    .map((phrase) =>
      phrase
        .split(/\s+and\s+/i)
        .map((p) => p.trim())
        .filter((p) => p && !said.has(norm(p)))
        .join(' and ')
    )
    .filter(Boolean)
    .join(', ')
}

/** Transición al final de una sección, según cómo cambia la energía. */
function transitionOut(from: number | null, to: number | null, drums: boolean): string {
  const rising = from !== null && to !== null && to > from
  if (drums) return rising ? 'build-up at the end' : ''
  return rising ? 'build-up and drum fill at the end' : 'drum fill at the end'
}

/**
 * Pasos para componer la canción: cada sección en tramos de `bars` compases (el
 * último puede ser más corto), con transiciones automáticas en los bordes. Las
 * secciones con `reuse` copian la anterior del mismo nombre; por si esa salió
 * atascada, llevan también sus tramos (`fallback`) para grabarla de nuevo. Todo tramo
 * generado continúa al que suena antes que él: escuchar otra parte de la canción
 * daría un cambio en seco en la unión.
 */
export function planChunks(
  spec: SongSpec,
  bars: number,
  tempo: { bpm?: number; key?: string; drums?: boolean } = {}
): ChunkStep[] {
  const drums = tempo.drums ?? false
  const steps: ChunkStep[] = []
  const style = clampWords(drums ? bedText(spec.style) : spec.style, STYLE_WORDS)
  const tail = [tempo.bpm ? `${Math.round(tempo.bpm)} bpm` : '', tempo.key ?? ''].filter(Boolean)
  /** Tramos de la sección `i` sonando como `like` (ella misma, o la que repite). */
  const generateSteps = (
    i: number,
    like: SongSpec['sections'][number],
    startBar: number
  ): GenerateStep[] => {
    const next = spec.sections[i + 1]
    const s = spec.sections[i]
    const count = Math.ceil(s.bars / bars)
    const arrangement = drums
      ? withoutStyleRepeats(bedText(like.arrangement), style)
      : like.arrangement
    return Array.from({ length: count }, (_, k) => {
      const hints: string[] = [energyHint(like.energy, { drums }), ...tail]
      if (k === 0 && i === 0) hints.unshift('intro')
      // La transición va al final: es lo último que suena en el tramo.
      if (k === count - 1)
        hints.push(next ? transitionOut(like.energy, next.energy, drums) : 'fade out ending')
      return {
        kind: 'generate' as const,
        section: i,
        startBar: startBar + k * bars,
        bars: Math.min(bars, s.bars - k * bars),
        prompt: [style, clampWords(arrangement, ARRANGEMENT_WORDS), ...hints]
          .filter(Boolean)
          .join(', ')
      }
    })
  }
  let startBar = 1
  spec.sections.forEach((s, i) => {
    if (s.reuse) {
      const from = spec.sections.findIndex((o, j) => j < i && sameName(o.name, s.name))
      const fallback = from >= 0 ? generateSteps(i, spec.sections[from], startBar) : []
      steps.push({ kind: 'reuse', section: i, from, fallback })
    } else {
      steps.push(...generateSteps(i, s, startBar))
    }
    startBar += s.bars
  })
  return steps
}

/** Segundos de audio previo que escucha el motor al continuar (ver audio/excerpt.ts). */
export const CONTEXT_SEC = 8

/**
 * Pre-roll de cada continuación: el tramo nuevo empieza un pulso antes, repitiendo el
 * final del anterior, y se funden. Sin él, cada unión cambia de timbre en seco.
 */
export const XFADE_BEATS = 1

/** Segundos de fundido cruzado entre tramos encadenados a este tempo (mínimo 0,25 s). */
export function crossfadeSeconds(bpm: number): number {
  return Math.max(0.25, (XFADE_BEATS * 60) / bpm)
}

/** La última región de la pista que empieza dentro de la sección. */
export function lastRegionIn(p: Project, trackId: string, s: Section): Region | undefined {
  const [a, b] = sectionBeats(p, s)
  return p.tracks
    .find((t) => t.id === trackId)
    ?.regions.filter((r) => r.startBeat >= a && r.startBeat < b)
    .sort((x, y) => y.startBeat - x.startBeat)[0]
}

/**
 * Pulido final de la canción: un fundido mínimo en cada costura (evita clics), la
 * entrada en fundido durante el primer compás y la salida durante los dos últimos.
 */
export function polishSong(p: Project, trackId: string): Project {
  const track = p.tracks.find((t) => t.id === trackId)
  if (!track || track.regions.length === 0) return p
  const bar = beatsToSeconds(p.timeSignature[0], p.bpm)
  const end = (r: Region): number => r.startBeat + secondsToBeats(r.lengthSec, p.bpm)
  const first = track.regions.reduce((a, r) => (r.startBeat < a.startBeat ? r : a))
  const last = track.regions.reduce((a, r) => (end(r) > end(a) ? r : a))
  const seam = 0.01
  return {
    ...p,
    tracks: p.tracks.map((t) =>
      t.id !== trackId
        ? t
        : {
            ...t,
            regions: t.regions.map((r) => ({
              ...r,
              fadeInSec: Math.min(
                r.lengthSec / 2,
                r.id === first.id ? bar : Math.max(r.fadeInSec, seam)
              ),
              fadeOutSec: Math.min(
                r.lengthSec / 2,
                r.id === last.id ? 2 * bar : Math.max(r.fadeOutSec, seam)
              )
            }))
          }
    )
  }
}

/** Acorta una región a `lengthSec` (p. ej. para quitar un tramo atascado), sin clic al final. */
export function trimRegion(p: Project, regionId: string, lengthSec: number): Project {
  return {
    ...p,
    tracks: p.tracks.map((t) => ({
      ...t,
      regions: t.regions.map((r) =>
        r.id !== regionId
          ? r
          : {
              ...r,
              lengthSec: Math.min(r.lengthSec, lengthSec),
              fadeOutSec: Math.min(0.01, lengthSec)
            }
      )
    }))
  }
}

/**
 * Cambia la región `replaceId` por `bars` compases de `src` (desde su compás
 * `offsetBars`) colocados en `atBeat`: el loop con que un productor tapa un tramo que no
 * sirve. Devuelve también el id de la región nueva.
 */
export function loopRegion(
  p: Project,
  replaceId: string,
  src: Region,
  opts: { atBeat: number; offsetBars: number; bars: number }
): { project: Project; regionId: string } {
  const bar = beatsToSeconds(p.timeSignature[0], p.bpm)
  const region: Region = {
    id: newId('rgn'),
    clipId: src.clipId,
    startBeat: opts.atBeat,
    offsetSec: src.offsetSec + opts.offsetBars * bar,
    lengthSec: opts.bars * bar,
    fadeInSec: 0.01,
    fadeOutSec: 0.01,
    ...(src.gainDb !== undefined && { gainDb: src.gainDb })
  }
  return {
    regionId: region.id,
    project: {
      ...p,
      tracks: p.tracks.map((t) =>
        t.regions.some((r) => r.id === replaceId)
          ? { ...t, regions: [...t.regions.filter((r) => r.id !== replaceId), region] }
          : t
      )
    }
  }
}

/** dB que sube o baja cada punto de energía respecto a una sección de energía 3. */
export const LEVEL_STEP_DB = 1
/** Lo más que se sube una sección (más saturaría el limitador con sus picos). */
export const MAX_BOOST_DB = 6
/** Lo más que se baja una sección. */
export const MAX_CUT_DB = 6
/** Si hace falta subir más de MAX_BOOST_DB, se baja el resto hasta esto para compensar. */
const MAX_SHIFT_DB = 3
/** Diferencias menores no se tocan: ya suenan parejas. */
const MIN_CHANGE_DB = 1.5
/** Salto de volumen en una unión que la mezcla puede dejar sin que se oiga como un corte. */
const SEAM_DB = 6

/**
 * Ganancia de cada región para que las secciones suenen según su energía. Cada tramo
 * se normaliza al mismo pico, no al mismo volumen: uno de golpes sueltos (stabs y riff
 * sin bajo continuo) queda mucho más bajo (test9: el coro 10 dB por debajo del verso, y
 * se repetía tres veces). Como un ingeniero de mezcla, se sube o baja la sección hacia
 * el volumen típico de la canción (la mediana; una sección repetida cuenta una vez) más
 * un dB por punto de energía. `db`: volumen medio de la región tal como sale del clip.
 *
 * Dos excepciones (test11): una sección bajita y de puros agudos es siseo, no música, y
 * no se sube (se oiría más); y la ganancia no agranda el salto de una unión entre
 * secciones más allá de SEAM_DB (o del que ya tenía), con `headDb`/`tailDb` de cada
 * región: el break a −4 y el verso a +6 dejaban una unión de +17 dB.
 */
export function sectionGains(
  sections: { name?: string; startBar: number; bars: number; energy?: number }[],
  regions: {
    id: string
    clipId: string
    offsetSec: number
    startBeat: number
    lengthSec: number
    db: number
    highDb?: number
    headDb?: number
    tailDb?: number
  }[],
  beatsPerBar: number
): Map<string, number> {
  // Un coro repetido ("reuse") no trae energía: es la del primero con su nombre (test10:
  // el coro original subía 6 dB y sus copias 5,5).
  const energyOf = (s: (typeof sections)[number]): number =>
    s.energy ??
    sections.find((o) => o.name && o.name === s.name && o.energy !== undefined)?.energy ??
    3
  const measured = sections
    .map((s) => {
      const a = (s.startBar - 1) * beatsPerBar
      const b = a + s.bars * beatsPerBar
      const inside = regions
        .filter((r) => r.startBeat >= a - 0.05 && r.startBeat < b - 0.05)
        .sort((x, y) => x.startBeat - y.startBeat)
      const weight = inside.reduce((n, r) => n + r.lengthSec, 0)
      if (weight <= 0) return null
      const power = inside.reduce((n, r) => n + Math.pow(10, r.db / 10) * r.lengthSec, 0)
      // Agudos respecto al total, ponderados por la potencia de cada región.
      const high = inside.every((r) => r.highDb !== undefined)
        ? inside.reduce((n, r) => n + Math.pow(10, (r.db + r.highDb!) / 10) * r.lengthSec, 0)
        : null
      const key = inside
        .map((r) => `${r.clipId}@${r.offsetSec.toFixed(2)}`)
        .sort()
        .join(' ')
      const db = 10 * Math.log10(power / weight)
      const hiss = high !== null && db < THIN_DB && 10 * Math.log10(high / power) > THIN_HIGH_DB
      return { energy: energyOf(s), inside, key, db, hiss, a, b }
    })
    .filter((m) => m !== null)
  const gains = new Map<string, number>()
  if (measured.length < 2) return gains
  const distinct = [...new Map(measured.map((m) => [m.key, m.db])).values()].sort((x, y) => x - y)
  const typical = distinct[Math.floor(distinct.length / 2)]
  const wanted = measured.map((m) => typical + (m.energy - 3) * LEVEL_STEP_DB - m.db)
  const shift = Math.min(MAX_SHIFT_DB, Math.max(0, Math.max(...wanted) - MAX_BOOST_DB))
  const clamp = (g: number): number => Math.max(-MAX_CUT_DB, Math.min(MAX_BOOST_DB, g))
  const byKey = new Map<string, number>()
  measured.forEach((m, i) => {
    const g = clamp(wanted[i] - shift)
    byKey.set(m.key, m.hiss ? Math.min(0, g) : g)
  })
  // Uniones entre secciones seguidas: si la ganancia agranda el salto, se acerca a 0 la
  // de la sección que más se movió. Unas pasadas bastan (una sección repetida comparte
  // ganancia en todas sus uniones).
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 1; i < measured.length; i++) {
      const [x, y] = [measured[i - 1], measured[i]]
      const [prev, next] = [x.inside[x.inside.length - 1], y.inside[0]]
      if (x.key === y.key || Math.abs(x.b - y.a) > 0.05) continue
      if (prev.tailDb === undefined || next.headDb === undefined) continue
      const jump = next.headDb - prev.tailDb
      const [gx, gy] = [byKey.get(x.key)!, byKey.get(y.key)!]
      const heard = jump + gy - gx
      const excess = Math.abs(heard) - Math.max(Math.abs(jump), SEAM_DB)
      if (excess <= 0) continue
      const dir = Math.sign(heard)
      if (Math.abs(gy) >= Math.abs(gx)) byKey.set(y.key, clamp(gy - dir * excess))
      else byKey.set(x.key, clamp(gx + dir * excess))
    }
  }
  for (const m of measured) {
    const g = byKey.get(m.key)!
    const rounded = Math.abs(g) < MIN_CHANGE_DB ? 0 : Math.round(g * 2) / 2
    for (const r of m.inside) gains.set(r.id, rounded)
  }
  return gains
}

/** Pone la ganancia de cada región de `gains` (0 la quita). */
export function withRegionGains(p: Project, gains: Map<string, number>): Project {
  return {
    ...p,
    tracks: p.tracks.map((t) =>
      t.regions.some((r) => gains.has(r.id))
        ? {
            ...t,
            regions: t.regions.map((r) => {
              const g = gains.get(r.id)
              if (g === undefined) return r
              const next: Region = { ...r, gainDb: g }
              if (g === 0) delete next.gainDb
              return next
            })
          }
        : t
    )
  }
}

/** Compases de un loop para una capa encima: 8 si caben, si no 4 o lo que quepa. */
export function loopBars(maxBarsPerClip: number, longestSection: number): number {
  const preferred = maxBarsPerClip >= 8 ? 8 : maxBarsPerClip >= 4 ? 4 : maxBarsPerClip
  return Math.max(1, Math.min(preferred, longestSection))
}

/** Prompt de una capa con el sonido común de la canción (la capa primero: es lo que se ve). */
export function layerPrompt(prompt: string, style: string | undefined): string {
  return style ? `${prompt.trim()}, ${style.trim()}` : prompt.trim()
}

/**
 * Copias de `template` una detrás de otra de `fromBeat` a `toBeat`. La última se
 * recorta (con un fundido mínimo para que no haga clic) si no cabe entera.
 */
export function tileRegions(
  template: Region,
  fromBeat: number,
  toBeat: number,
  bpm: number
): Region[] {
  const lenBeats = secondsToBeats(template.lengthSec, bpm)
  if (lenBeats <= 0) return []
  const out: Region[] = []
  for (let beat = fromBeat; beat < toBeat - 1e-6; beat += lenBeats) {
    const beats = Math.min(lenBeats, toBeat - beat)
    const trimmed = beats < lenBeats - 1e-6
    out.push({
      ...template,
      id: newId('rgn'),
      startBeat: beat,
      lengthSec: trimmed ? beatsToSeconds(beats, bpm) : template.lengthSec,
      fadeOutSec: trimmed ? Math.min(0.01, template.lengthSec) : template.fadeOutSec
    })
  }
  return out
}

const sectionBeats = (p: Project, s: Section): [number, number] => {
  const perBar = p.timeSignature[0]
  return [(s.startBar - 1) * perBar, (s.startBar - 1 + s.bars) * perBar]
}

/**
 * Llena unas secciones de una pista con un loop: quita lo que empezaba dentro de
 * ellas y pone copias de `template` de principio a fin de cada una.
 */
export function fillSections(
  p: Project,
  trackId: string,
  template: Region,
  sections: Section[]
): Project {
  const ranges = sections.map((s) => sectionBeats(p, s))
  const inside = (beat: number): boolean => ranges.some(([a, b]) => beat >= a && beat < b)
  return {
    ...p,
    tracks: p.tracks.map((t) =>
      t.id !== trackId
        ? t
        : {
            ...t,
            regions: [
              ...t.regions.filter((r) => r.id !== template.id && !inside(r.startBeat)),
              ...ranges.flatMap(([a, b]) => tileRegions(template, a, b, p.bpm))
            ]
          }
    )
  }
}

/** ¿Tiene la pista audio que se solape con [fromBeat, toBeat)? */
export function trackBusy(p: Project, track: Track, fromBeat: number, toBeat: number): boolean {
  return track.regions.some((r) => {
    const end = r.startBeat + secondsToBeats(r.lengthSec, p.bpm)
    return r.startBeat < toBeat && end > fromBeat
  })
}

/** Qué suena en cada sección: capas presentes y las que se cortan antes del final. */
export interface SectionCoverage {
  section: Section
  /** Pistas audibles con audio en la sección (nombre y papel). */
  layers: { track: string; role: TrackRole }[]
  /** Pistas que suenan en parte de la sección pero dejan huecos. */
  partial: string[]
  /**
   * Suena una sola capa suelta (no una mezcla completa) y la sección no es escasa a
   * propósito: suele sonar vacía.
   */
  thin: boolean
}

export function sectionCoverage(p: Project): SectionCoverage[] {
  const audible = p.tracks.filter((t) => !t.mute)
  return sectionsOf(p).map((section) => {
    const [a, b] = sectionBeats(p, section)
    const layers: SectionCoverage['layers'] = []
    const partial: string[] = []
    for (const t of audible) {
      const covered = coveredBeats(p, t, a, b)
      if (covered <= 0) continue
      layers.push({ track: t.name, role: t.role })
      // El audio importado dura lo que dura: sus huecos no son un fallo del productor.
      const imported = t.regions.every((r) => p.clips[r.clipId]?.spec === null)
      if (!imported && covered < (b - a) * 0.9) partial.push(t.name)
    }
    const thin = layers.length === 1 && layers[0].role !== 'full' && !section.sparse
    return { section, layers, partial, thin }
  })
}

/** Beats de [a, b) cubiertos por regiones de la pista (sin contar solapes dos veces). */
function coveredBeats(p: Project, t: Track, a: number, b: number): number {
  const spans = t.regions
    .map((r) => [r.startBeat, r.startBeat + secondsToBeats(r.lengthSec, p.bpm)] as const)
    .map(([s, e]) => [Math.max(s, a), Math.min(e, b)] as const)
    .filter(([s, e]) => e > s)
    .sort((x, y) => x[0] - y[0])
  let total = 0
  let cursor = a
  for (const [s, e] of spans) {
    const from = Math.max(s, cursor)
    if (e > from) total += e - from
    cursor = Math.max(cursor, e)
  }
  return total
}

/**
 * Revisión automática antes de que el productor dé la canción por terminada.
 * Devuelve un aviso para el LLM, o null si todo está en orden.
 */
export function reviewProject(p: Project): string | null {
  const problems: string[] = []
  const coverage = sectionCoverage(p)
  const hasAudio = coverage.some((c) => c.layers.length > 0)
  if (!hasAudio) return null // aún no hay canción (p. ej. solo se planificó la estructura)
  for (const c of coverage) {
    const where = `"${c.section.name}" (bars ${c.section.startBar}-${c.section.startBar + c.section.bars - 1}, id ${c.section.id})`
    if (c.layers.length === 0) problems.push(`${where} is empty: nothing plays there.`)
    else if (c.thin) {
      problems.push(`${where} has only one layer (${c.layers[0].track}).`)
    }
    if (c.partial.length > 0) {
      problems.push(`${where}: ${c.partial.join(', ')} stop(s) before the section ends.`)
    }
  }
  if (problems.length === 0) return null
  return [
    'Automatic check of the song before you finish:',
    ...problems.map((x) => `- ${x}`),
    'Fix these (extend_region continues the song into an empty section, fill_section adds a layer, copy_section repeats a finished section), then reply. If a gap is intentional, say so to the user instead of calling the song complete.'
  ].join('\n')
}
