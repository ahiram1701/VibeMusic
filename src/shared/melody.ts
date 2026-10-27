// Melodías cantadas por el cantante local (DiffSinger en OpenUtau). El productor
// escribe cada frase de la letra con sus notas; aquí se separan las sílabas, se
// reparten en las notas y se genera el proyecto de OpenUtau (.ustx) que se renderiza.
// Todo es puro (sin E/S) para poder probarlo sin la app.

import { lineLanguage } from './lyrics-language'

/** Una frase de la letra con su melodía: "A4:0.5 B4:0.5 C5:1 R:1 …" (nota:pulsos). */
export interface MelodyLine {
  text: string
  notes: string
  /** Idioma de la frase ("en", "es"…) si el productor lo indica; si no, se adivina. */
  lang?: string
}

/** Nota ya colocada: en pulsos (negras) desde el inicio de la canción. */
export interface SungNote {
  beat: number
  beats: number
  /** Altura MIDI (C4 = 60). */
  midi: number
  /** Palabra en su primera sílaba; "+" en las siguientes (así lo entiende OpenUtau). */
  lyric: string
  /** Idioma con el que se pronuncia (cada idioma va en su pista del .ustx). */
  lang?: string
}

// --- Sílabas (español) -----------------------------------------------------------

const STRONG = 'aeoáéóíú' // las acentuadas débiles (í, ú) rompen el diptongo: hiato
const WEAK = 'iuü'
const isVowel = (c: string): boolean => (STRONG + WEAK).includes(c)
/** Grupos de dos consonantes que van juntos al principio de sílaba (pla, tre…). */
const CLUSTERS = new Set([
  'pl',
  'pr',
  'bl',
  'br',
  'cl',
  'cr',
  'dr',
  'fl',
  'fr',
  'gl',
  'gr',
  'kl',
  'kr',
  'tr',
  'tl'
])

/** Normaliza una palabra para separarla: minúsculas y solo letras. */
function clean(word: string): string {
  return word.toLowerCase().replace(/[^a-záéíóúüñ]/g, '')
}

/**
 * Sílabas ortográficas de una palabra en español ("caminando" → ca·mi·nan·do).
 * Trata ch, ll, rr y qu/gu como una unidad y la "y" final como vocal ("hoy").
 */
export function syllables(word: string): string[] {
  const w = clean(word)
  if (!w) return []
  // Unidades: letras, con ch/ll/rr juntas. Se marca qué unidades son vocales.
  const units: { text: string; vowel: boolean }[] = []
  for (let i = 0; i < w.length; i++) {
    const two = w.slice(i, i + 2)
    if (two === 'ch' || two === 'll' || two === 'rr') {
      units.push({ text: two, vowel: false })
      i++
      continue
    }
    const c = w[i]
    const prev = w[i - 1]
    const next = w[i + 1]
    // La u de "que, qui, gue, gui" no suena: va con la consonante.
    const silentU = c === 'u' && (prev === 'q' || (prev === 'g' && (next === 'e' || next === 'i')))
    const finalY = c === 'y' && i === w.length - 1 && i > 0
    units.push({ text: c, vowel: (isVowel(c) && !silentU) || finalY })
  }
  // Núcleos: grupos de vocales seguidas, partidos donde hay hiato (dos fuertes).
  const nuclei: [number, number][] = [] // [inicio, fin] en índices de unidades
  for (let i = 0; i < units.length; i++) {
    if (!units[i].vowel) continue
    let j = i
    while (j + 1 < units.length && units[j + 1].vowel) {
      const a = units[j].text
      const b = units[j + 1].text
      if (STRONG.includes(a) && STRONG.includes(b)) break // hiato
      j++
    }
    nuclei.push([i, j])
    i = j
  }
  if (nuclei.length === 0) return [w]
  // Fronteras entre núcleos según cuántas consonantes hay entre ellos.
  const cuts: number[] = []
  for (let k = 0; k + 1 < nuclei.length; k++) {
    const from = nuclei[k][1] + 1
    const to = nuclei[k + 1][0]
    const n = to - from
    if (n <= 1) cuts.push(from)
    else if (n === 2) {
      const pair = units[from].text + units[from + 1].text
      cuts.push(CLUSTERS.has(pair) ? from : from + 1)
    } else if (n === 3) {
      const pair = units[from + 1].text + units[from + 2].text
      cuts.push(CLUSTERS.has(pair) ? from + 1 : from + 2)
    } else cuts.push(from + 2)
  }
  const out: string[] = []
  let start = 0
  for (const cut of [...cuts, units.length]) {
    out.push(
      units
        .slice(start, cut)
        .map((u) => u.text)
        .join('')
    )
    start = cut
  }
  return out
}

// --- Sílabas (inglés) ------------------------------------------------------------
// El fonemizador inglés de OpenUtau busca cada palabra en su diccionario: basta con
// saber cuántas notas ocupa (las sílabas que se oyen, no las vocales escritas).

/** Palabras en las que contar grupos de vocales falla. */
const ENGLISH_EXCEPTIONS: Record<string, string[]> = {
  every: ['ev', 'ery'],
  everything: ['ev', 'ery', 'thing'],
  everyone: ['ev', 'ery', 'one'],
  everybody: ['ev', 'ery', 'bo', 'dy'],
  someone: ['some', 'one'],
  somebody: ['some', 'bo', 'dy'],
  something: ['some', 'thing'],
  sometimes: ['some', 'times'],
  maybe: ['may', 'be'],
  fire: ['fire'],
  desire: ['de', 'sire'],
  our: ['our'],
  hour: ['hour'],
  hours: ['hours'],
  heaven: ['hea', 'ven'],
  different: ['dif', 'frent'],
  beautiful: ['beau', 'ti', 'ful'],
  people: ['peo', 'ple'],
  real: ['real'],
  idea: ['i', 'de', 'a'],
  lion: ['li', 'on'],
  quiet: ['qui', 'et'],
  science: ['sci', 'ence'],
  create: ['cre', 'ate'],
  queen: ['queen']
}

const EN_VOWELS = /[aeiouy]+/g

/** Normaliza una palabra inglesa: minúsculas, solo letras y el apóstrofo ("Don’t" → "don't"). */
function englishWord(word: string): string {
  return word
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[^a-z']/g, '')
    .replace(/^'+|'+$/g, '')
}

/**
 * Sílabas que se oyen de una palabra en inglés ("tonight" → to·night, "time" → time,
 * "loved" → loved). Aproximado: grupos de vocales, sin la e muda final ni la de -ed/-es.
 */
export function englishSyllables(word: string): string[] {
  const w = englishWord(word)
  if (!/[a-z]/.test(w)) return []
  const base = w.replace(/'(s|d|ll|re|ve|m|t)$/, '')
  if (ENGLISH_EXCEPTIONS[base]) return ENGLISH_EXCEPTIONS[base]
  // Grupos de vocales (la "y" inicial es consonante: "you", "yeah").
  const groups: { start: number; end: number }[] = []
  for (const m of base.matchAll(EN_VOWELS)) {
    let start = m.index
    let text = m[0]
    if (start === 0 && text[0] === 'y') {
      start++
      text = text.slice(1)
      if (!text) continue
    }
    // "going", "being", "saying": la i de -ing es otra sílaba.
    if (text.length > 1 && text.endsWith('i') && base.slice(start + text.length) === 'ng') {
      groups.push({ start, end: start + text.length - 1 })
      groups.push({ start: start + text.length - 1, end: start + text.length })
      continue
    }
    groups.push({ start, end: start + text.length })
  }
  if (groups.length > 1) {
    const last = groups[groups.length - 1]
    const tail = base.slice(last.start)
    const before = base[last.start - 1] ?? ''
    const silent =
      // e muda: "time", "love", "fire" (pero no "little", "free", "the")
      (tail === 'e' && !/[aeiouy]/.test(before) && !base.endsWith('le')) ||
      // -ed que no suena: "loved" (pero "wanted", "needed")
      (tail === 'ed' && !/[td]/.test(before)) ||
      // -es que no suena: "times" (pero "kisses", "places")
      (tail === 'es' && !/[sxzc]|[cs]h|g/.test(base.slice(last.start - 2, last.start)))
    if (silent) groups.pop()
  }
  if (groups.length <= 1) return [w]
  // Se corta antes de la última consonante entre dos grupos ("ba·by", "danc·ing").
  const out: string[] = []
  let from = 0
  for (let k = 1; k < groups.length; k++) {
    const gap = groups[k].start - groups[k - 1].end
    const cut = gap === 0 ? groups[k].start : groups[k].start - 1
    out.push(w.slice(from, cut))
    from = cut
  }
  out.push(w.slice(from))
  return out
}

/** Palabras cantables de una frase, cada una con sus sílabas (en español o inglés). */
export function lineSyllables(text: string, lang = 'es'): { word: string; syllables: string[] }[] {
  if (lang === 'en') {
    return text
      .split(/[^\p{L}'’`]+/u)
      .map((w) => ({ word: englishWord(w), syllables: englishSyllables(w) }))
      .filter((w) => w.syllables.length > 0)
  }
  return text
    .split(/[\s\-—–]+/)
    .map((w) => ({ word: clean(w), syllables: syllables(w) }))
    .filter((w) => w.syllables.length > 0)
}

// --- Notas -----------------------------------------------------------------------

const NOTE_BASE: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }

/** "A4" → 69, "F#3" → 54, "Bb4" → 70. null si no es una nota. */
export function noteToMidi(name: string): number | null {
  const m = /^([a-g])([#b]?)(-?\d)$/i.exec(name.trim())
  if (!m) return null
  const base = NOTE_BASE[m[1].toLowerCase()]
  const shift = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0
  return (Number(m[3]) + 1) * 12 + base + shift
}

export interface ParsedNote {
  /** null = silencio. */
  midi: number | null
  beats: number
}

/** "A4:0.5 B4 R:1" → notas y silencios (sin duración, 1 pulso). Lanza errores claros. */
export function parseNotes(notes: string): ParsedNote[] {
  const tokens = notes
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
  if (tokens.length === 0) throw new Error('la melodía no tiene notas')
  return tokens.map((t) => {
    const [name, dur] = t.split(':')
    const beats = dur === undefined ? 1 : Number(dur)
    if (!Number.isFinite(beats) || beats <= 0 || beats > 16) {
      throw new Error(`"${t}": la duración debe ser un número de pulsos entre 0 y 16`)
    }
    if (/^r$/i.test(name)) return { midi: null, beats }
    const midi = noteToMidi(name)
    if (midi === null)
      throw new Error(`"${t}" no es una nota (usa p. ej. A4, F#4, Bb3 o R para silencio)`)
    return { midi, beats }
  })
}

/**
 * Reparte las sílabas de una frase en sus notas. Si sobran notas, la última sílaba se
 * alarga sobre ellas (melisma). Si faltan, en modo estricto falla explicando cuántas
 * sílabas hay (el productor corrige la melodía); si no, parte las últimas notas.
 */
export function alignLine(
  line: MelodyLine,
  startBeat: number,
  opts: { strict: boolean; language?: string }
): { notes: SungNote[]; beats: number } {
  const lang = line.lang ?? lineLanguage(line.text, opts.language ?? 'es')
  const words = lineSyllables(line.text, lang)
  const parsed = parseNotes(line.notes)
  const total = parsed.reduce((n, p) => n + p.beats, 0)
  const sung = words.flatMap((w) => w.syllables.map((_, i) => (i === 0 ? w.word : '+')))
  const pitched = parsed.filter((p) => p.midi !== null)
  if (sung.length === 0) return { notes: [], beats: total }
  if (pitched.length < sung.length) {
    // Cantando, las vocales que se tocan se unen en una sílaba (sinalefa, sinéresis):
    // una melodía con menos notas es correcta mientras no baje de ese mínimo. En inglés
    // las sílabas se cuentan de forma aproximada: se admite una nota menos por frase.
    const fewest = sung.length - (lang === 'es' ? vowelJoins(words) : 1)
    if (opts.strict && pitched.length < fewest) {
      const split = words.map((w) => w.syllables.join('-')).join(' ')
      throw new Error(
        `"${line.text}" tiene ${sung.length} sílabas (${split})${fewest < sung.length ? `, ${fewest} uniendo las vocales que se tocan,` : ''} y solo ${pitched.length} notas: pon una nota por sílaba`
      )
    }
    // Se parten las notas más largas hasta que haya una por sílaba (como un cantante
    // que pronuncia rápido las dos vocales unidas).
    const many = [...parsed]
    while (many.filter((p) => p.midi !== null).length < sung.length) {
      const i = many.reduce(
        (best, p, k) => (p.midi !== null && p.beats > many[best].beats ? k : best),
        many.findIndex((p) => p.midi !== null)
      )
      const half = many[i].beats / 2
      many.splice(i, 1, { ...many[i], beats: half }, { ...many[i], beats: half })
    }
    return alignLine(
      { text: line.text, notes: many.map(noteText).join(' '), lang },
      startBeat,
      opts
    )
  }
  const out: SungNote[] = []
  let beat = startBeat
  let k = 0
  for (const p of parsed) {
    if (p.midi !== null) {
      out.push({ beat, beats: p.beats, midi: p.midi, lyric: k < sung.length ? sung[k] : '+', lang })
      k++
    }
    beat += p.beats
  }
  return { notes: out, beats: total }
}

const VOWELS = /[aeiouáéíóúü]/
const endsInVowel = (w: string): boolean => VOWELS.test(w.at(-1) ?? '') || w.endsWith('y')
const startsWithVowel = (w: string): boolean =>
  VOWELS.test(w[0] ?? '') || (w[0] === 'h' && VOWELS.test(w[1] ?? '')) || w === 'y'

/**
 * Cuántas sílabas se pueden unir al cantar: entre palabras (sinalefa: "sobre el" →
 * so-brel) y dentro de una palabra en hiato (sinéresis: "cae" → cae).
 */
export function vowelJoins(words: { word: string; syllables: string[] }[]): number {
  let joins = 0
  words.forEach((w, i) => {
    const next = words[i + 1]
    if (next && endsInVowel(w.word) && startsWithVowel(next.word)) joins++
    for (let k = 0; k + 1 < w.syllables.length; k++) {
      if (endsInVowel(w.syllables[k]) && startsWithVowel(w.syllables[k + 1])) joins++
    }
  })
  return joins
}

function noteText(p: ParsedNote): string {
  if (p.midi === null) return `R:${p.beats}`
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  return `${names[p.midi % 12]}${Math.floor(p.midi / 12) - 1}:${p.beats}`
}

/**
 * Coloca las frases de varias secciones: cada sección empieza en su compás y sus
 * frases van seguidas. Falla si una sección se pasa de su longitud o si hay notas
 * fuera del registro del cantante.
 */
export function placeMelody(
  sections: { name: string; startBar: number; bars: number; melody?: MelodyLine[] }[],
  beatsPerBar: number,
  opts: { strict: boolean; range?: [number, number]; language?: string }
): SungNote[] {
  const notes: SungNote[] = []
  for (const s of sections) {
    if (!s.melody?.length) continue
    let beat = (s.startBar - 1) * beatsPerBar
    const end = beat + s.bars * beatsPerBar
    for (const line of s.melody) {
      const placed = alignLine(line, beat, opts)
      beat += placed.beats
      notes.push(...placed.notes)
    }
    if (beat > end + 1e-6) {
      throw new Error(
        `La melodía de "${s.name}" dura ${round(beat - (end - s.bars * beatsPerBar))} pulsos y la sección tiene ${s.bars * beatsPerBar} (${s.bars} compases): acórtala`
      )
    }
  }
  if (opts.range) {
    const [lo, hi] = opts.range
    const out = notes.find((n) => n.midi < lo || n.midi > hi)
    if (out) {
      throw new Error(
        `La nota ${noteText({ midi: out.midi, beats: out.beats }).split(':')[0]} está fuera del registro del cantante (${noteText({ midi: lo, beats: 1 }).split(':')[0]}–${noteText({ midi: hi, beats: 1 }).split(':')[0]})`
      )
    }
  }
  return notes
}

const round = (n: number): number => Math.round(n * 100) / 100

/**
 * La melodía de una sección con su letra actual: cada línea de la letra se canta con
 * las notas de la frase de la melodía en la misma posición (si hay más líneas que
 * frases, repite las notas de la última). Así, editar la letra a mano no obliga a
 * reescribir la melodía. null si la sección no tiene letra o melodía.
 */
export function melodyForLyrics(
  lyrics: string | undefined,
  melody: MelodyLine[] | undefined
): MelodyLine[] | null {
  const lines = (lyrics ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  if (!lines.length || !melody?.length) return null
  return lines.map((text, i) => {
    const line = melody[i] ?? melody[melody.length - 1]
    // El idioma indicado vale mientras la frase no cambie; si se editó, se adivina.
    return { text, notes: line.notes, ...(line.lang && line.text === text && { lang: line.lang }) }
  })
}

// --- Proyecto de OpenUtau (.ustx) -------------------------------------------------

const RESOLUTION = 480
const PHONEMIZERS: Record<string, string> = {
  es: 'OpenUtau.Core.DiffSinger.DiffSingerSpanishPhonemizer',
  en: 'OpenUtau.Core.DiffSinger.DiffSingerEnglishPhonemizer',
  ja: 'OpenUtau.Core.DiffSinger.DiffSingerJapanesePhonemizer',
  de: 'OpenUtau.Core.DiffSinger.DiffSingerGermanPhonemizer',
  ko: 'OpenUtau.Core.DiffSinger.DiffSingerKoreanPhonemizer',
  zh: 'OpenUtau.Core.DiffSinger.DiffSingerChinesePhonemizer'
}

/** Idiomas que sabe cantar el cantante local. */
export const SINGER_LANGUAGES = Object.keys(PHONEMIZERS)

const yamlString = (s: string): string => `'${s.replace(/'/g, "''")}'`

/**
 * Proyecto .ustx que renderiza OpenUtau: una pista de voz por idioma (el fonemizador
 * es de la pista), todas con el mismo cantante. OpenUtau las mezcla al renderizar,
 * así que las frases en inglés de una canción en español se pronuncian en inglés.
 */
export function buildUstx(opts: {
  singer: string
  language: string
  bpm: number
  beatsPerBar: number
  notes: SungNote[]
}): string {
  const main = PHONEMIZERS[opts.language] ? opts.language : 'es'
  const langOf = (n: SungNote): string => (n.lang && PHONEMIZERS[n.lang] ? n.lang : main)
  const langs = [main, ...new Set(opts.notes.map(langOf).filter((l) => l !== main))]
  const name = (lang: string): string => (lang === main ? 'Voz' : `Voz (${lang})`)
  const lines = [
    'name: VibeMusic',
    "ustx_version: '0.6'",
    `resolution: ${RESOLUTION}`,
    `bpm: ${opts.bpm}`,
    `beat_per_bar: ${opts.beatsPerBar}`,
    'beat_unit: 4',
    'time_signatures:',
    '- bar_position: 0',
    `  beat_per_bar: ${opts.beatsPerBar}`,
    '  beat_unit: 4',
    'tempos:',
    '- position: 0',
    `  bpm: ${opts.bpm}`,
    'tracks:'
  ]
  for (const lang of langs) {
    lines.push(
      `- singer: ${yamlString(opts.singer)}`,
      `  phonemizer: ${PHONEMIZERS[lang]}`,
      '  renderer_settings:',
      '    renderer: DIFFSINGER',
      `  track_name: ${name(lang)}`,
      '  volume: 0',
      '  pan: 0'
    )
  }
  lines.push('voice_parts:')
  langs.forEach((lang, trackNo) => {
    lines.push(`- name: ${name(lang)}`, `  track_no: ${trackNo}`, '  position: 0', '  notes:')
    for (const n of opts.notes.filter((n) => langOf(n) === lang)) {
      lines.push(
        `  - position: ${Math.round(n.beat * RESOLUTION)}`,
        `    duration: ${Math.max(1, Math.round(n.beats * RESOLUTION))}`,
        `    tone: ${n.midi}`,
        `    lyric: ${yamlString(n.lyric)}`,
        '    pitch:',
        '      data:',
        '      - {x: -40, y: 0, shape: io}',
        '      - {x: 40, y: 0, shape: io}',
        '      snap_first: true',
        '    vibrato: {length: 0, period: 175, depth: 25, in: 10, out: 10, shift: 0, drift: 0, vol_link: 0}',
        '    phoneme_expressions: []',
        '    phoneme_overrides: []'
      )
    }
  })
  return lines.join('\n') + '\n'
}

/** Pulso donde termina la última nota (para saber cuánto dura la voz). */
export function melodyEndBeat(notes: SungNote[]): number {
  return notes.reduce((end, n) => Math.max(end, n.beat + n.beats), 0)
}
