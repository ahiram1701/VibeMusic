import type { AgentTool } from './agent'
import {
  chunkBars,
  CONTEXT_SEC,
  fillSections,
  hasLyrics,
  lastRegionIn,
  parseMelodyLines,
  layerPrompt,
  loopBars,
  parseSongSpec,
  planChunks,
  polishSong,
  reviewProject,
  sameName,
  sectionCoverage,
  trackBusy,
  trimRegion,
  vocalSongRequest,
  type ChunkStep
} from './arrange'
import { hasStartGap, type CollapseOptions, type SoundSummary } from './drone'
import { DRUM_PATTERNS, findPattern } from './drums'
import { findGenre, GENRES, PROMPT_EXAMPLES, type GenreGuide } from './genres'
import type { ProviderInfo, SingingEngine } from './generation'
import { buildUstx, melodyForLyrics, placeMelody } from './melody'
import { SINGER_PROVIDER, SINGER_VOICE } from './singer'
import {
  beatsToSeconds,
  createTrack,
  newId,
  ROLE_LABELS,
  removeRegion,
  removeTrack,
  secondsToBeats,
  updateTrack,
  type Project,
  type Region,
  type Section,
  type Track,
  type TrackRole
} from './project'
import { barsToSeconds } from './prompt'
import { MAX_GAIN_DB, MIN_GAIN_DB, withDefaultMix } from './mixer'
import { copySection, copySectionInto, sectionsOf, setSections, updateSection } from './sections'
import { projectEndSec } from './timeline'
import { reviewSong, type RegionSound, type SongReview } from './review'

// Herramientas del agente productor. Hablan con la app a través de `ProducerHost`,
// así se pueden probar sin interfaz. Trabajan en compases (1 = primer compás),
// que es como piensa un músico, y validan cada parámetro: si el LLM se equivoca,
// recibe un error claro y puede corregirse.

export interface ProducerHost {
  getProject(): Project
  /**
   * Lo que ha escrito el usuario en el chat, del mensaje más reciente al más antiguo.
   * El género de la canción sale de sus palabras, no de la consulta que haga el LLM.
   */
  userMessages?(): string[]
  /**
   * Batería programada (drums.ts) en toda la canción, con el sidechain de la cama
   * (`bedTrackId`) a su bombo. Rehace la que hubiera. Tarda segundos.
   */
  applyDrums?(opts: {
    pattern: string
    intensity?: number
    bedTrackId: string | null
    message: string
  }): Promise<{ trackId: string }>
  /** Quita la batería programada. */
  removeDrums?(message: string): Promise<void>
  commit(next: Project, message: string): Promise<void>
  /** Cambia tempo/tonalidad estirando el audio generado; devuelve cuántos clips se ajustaron. */
  setTempo(
    bpm: number,
    key: string | undefined,
    messagePrefix: string
  ): Promise<{ adjusted: number; skipped: number }>
  /** Motor de audio que se usará para generar (el predeterminado). */
  audioProvider(): ProviderInfo | undefined
  /** Motor que canta letra en la nube (canciones completas con voz), si hay alguno. */
  vocalProvider(): ProviderInfo | undefined
  /** ¿Está instalado el cantante local (DiffSinger en este equipo)? */
  localSingerReady(): boolean
  /** Quién prefiere el usuario que cante (Ajustes). */
  singingPreference(): SingingEngine
  /**
   * Canta un proyecto de OpenUtau (.ustx) con el cantante local y lo pone en su pista de
   * voz, desde el compás 1, sustituyendo la toma anterior.
   */
  singMelody(ustx: string, message: string): Promise<{ trackId: string; regionId: string }>
  /** Con `lyrics`, la genera el motor que canta (`vocalProvider`). */
  generate(input: {
    prompt: string
    role: TrackRole
    bars: number
    atBeat: number
    trackId: string | null
    trackName?: string
    lyrics?: string
    lyricsLanguage?: string
  }): Promise<{ trackId: string; regionId: string }>
  /** Otra toma de una región (misma descripción, otra semilla); la sustituye. */
  vary(regionId: string, instructions?: string): Promise<{ trackId: string; regionId: string }>
  /**
   * Continúa una región `bars` compases a partir de su final (el motor escucha sus
   * últimos segundos). Por defecto va justo después y con la descripción del clip;
   * `prompt` la sustituye y `atBeat` lo coloca en otro sitio de la misma pista.
   */
  extend(
    regionId: string,
    bars: number,
    opts?: {
      instructions?: string
      prompt?: string
      atBeat?: number
      message?: string
      /** Fundirse con el final de la región (por defecto sí). */
      crossfade?: boolean
    }
  ): Promise<{ trackId: string; regionId: string }>
  /**
   * Escucha una región: segundo (desde su inicio) en el que se atasca (drone grave,
   * silencio, siseo o se vacía), o null si suena bien. Ver drone.ts.
   */
  inspectRegion(
    regionId: string,
    opts?: CollapseOptions
  ): Promise<{
    collapseAtSec: number | null
    /** Primer y último segundo y media de la región (para revisar la canción). */
    sound?: SoundSummary | null
  }>
  /** Separa una región en pistas (voz, batería, bajo, otros) con el motor local. */
  separate(regionId: string): Promise<{ trackIds: string[]; stems: string[]; skipped: string[] }>
  /** "Mi voz": modelos de voz del usuario (RVC) y si el motor que los usa está instalado. */
  myVoices(): { ready: boolean; voices: { id: string; name: string }[] }
  /** Convierte una región de voz al timbre de un modelo del usuario (pista nueva debajo). */
  convertVoice(
    regionId: string,
    opts: { voiceId: string; voiceName: string; pitch: number }
  ): Promise<{ trackId: string; regionId: string }>
  playheadSec(): number
  play(fromSec: number): void
}

const ROLES: TrackRole[] = ['drums', 'bass', 'chords', 'melody', 'vocal', 'fx', 'full']

/** Idioma de una frase de la melodía (el cantante local pronuncia cada frase en el suyo). */
const LINE_LANG_SCHEMA = {
  type: 'string',
  description:
    'ISO 639-1 code of this phrase when it differs from the song language (e.g. "en" for an English line in a Spanish song). Omit otherwise.'
}
/** Prefijo de los cambios hechos por el agente en el historial. */
export const AGENT_PREFIX = '🤖 '

// --- Validación de entradas --------------------------------------------------

type Input = Record<string, unknown>

function num(input: Input, key: string, min: number, max: number): number
function num(
  input: Input,
  key: string,
  min: number,
  max: number,
  optional: true
): number | undefined
function num(
  input: Input,
  key: string,
  min: number,
  max: number,
  optional = false
): number | undefined {
  const raw = input[key]
  if (raw === undefined || raw === null) {
    if (optional) return undefined
    throw new Error(`Falta el parámetro "${key}"`)
  }
  // Algunos modelos (Llama, modelos locales…) mandan los números como texto: "8".
  const v = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`"${key}" debe ser un número`)
  if (v < min || v > max)
    throw new Error(`"${key}" debe estar entre ${min} y ${max} (recibido ${v})`)
  return v
}

function str(input: Input, key: string): string
function str(input: Input, key: string, optional: true): string | undefined
function str(input: Input, key: string, optional = false): string | undefined {
  const v = input[key]
  if (v === undefined || v === null || v === '') {
    if (optional) return undefined
    throw new Error(`Falta el parámetro "${key}"`)
  }
  if (typeof v !== 'string') throw new Error(`"${key}" debe ser texto`)
  return v
}

function bool(input: Input, key: string): boolean | undefined {
  const v = input[key]
  if (v === undefined || v === null) return undefined
  if (v === 'true' || v === 'false') return v === 'true'
  if (typeof v !== 'boolean') throw new Error(`"${key}" debe ser true o false`)
  return v
}

const SECTIONS_EXAMPLE =
  '[{"name":"Intro","start_bar":1,"bars":4},{"name":"Verso","start_bar":5,"bars":8}]'

/**
 * Normaliza la lista de secciones que manda el LLM. Además del formato correcto,
 * acepta la lista serializada como texto y elementos como "Verse 8"; si falta
 * start_bar, la sección empieza donde acaba la anterior.
 */
export function parseSections(raw: unknown): { name: string; startBar: number; bars: number }[] {
  let value = raw
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      // se queda como texto y da el error de abajo
    }
  }
  if (!Array.isArray(value)) {
    throw new Error(`"sections" debe ser una lista de objetos, p. ej. ${SECTIONS_EXAMPLE}`)
  }
  let nextBar = 1
  return value.map((item, i) => {
    let it: Record<string, unknown>
    if (typeof item === 'string') {
      const m = /^(.*?)\s*(\d+)\s*$/.exec(item.trim())
      if (!m || !m[1]) {
        throw new Error(
          `Sección ${i + 1} ("${item}"): indica su duración. Usa objetos, p. ej. ${SECTIONS_EXAMPLE}`
        )
      }
      it = { name: m[1], bars: Number(m[2]) }
    } else {
      it = (item ?? {}) as Record<string, unknown>
    }
    if (typeof it.name !== 'string' || !it.name.trim()) {
      throw new Error(`Sección ${i + 1}: falta "name". Formato: ${SECTIONS_EXAMPLE}`)
    }
    const startBar = Math.round(num(it, 'start_bar', 1, 1000, true) ?? nextBar)
    const bars = Math.round(num(it, 'bars', 1, 256))
    nextBar = startBar + bars
    return { name: it.name.trim(), startBar, bars }
  })
}

// --- Utilidades de compases --------------------------------------------------

const perBar = (p: Project): number => p.timeSignature[0]
const beatOfBar = (p: Project, bar: number): number => (bar - 1) * perBar(p)
const barOfBeat = (p: Project, beat: number): number => beat / perBar(p) + 1
const round2 = (n: number): number => Math.round(n * 100) / 100

function findTrack(p: Project, id: string): Track {
  const t = p.tracks.find((x) => x.id === id)
  if (!t) throw new Error(`No existe la pista "${id}". Usa get_project_state para ver los ids.`)
  return t
}

function findRegion(p: Project, id: string): { track: Track; region: Region } {
  for (const track of p.tracks) {
    const region = track.regions.find((r) => r.id === id)
    if (region) return { track, region }
  }
  throw new Error(`No existe la región "${id}". Usa get_project_state para ver los ids.`)
}

/**
 * Quién canta las canciones con letra: el cantante local (melodía nota a nota, en este
 * equipo) o la nube (ACE-Step canta la canción entera). null si no hay ninguno.
 */
export function whoSings(host: ProducerHost): 'local' | 'cloud' | null {
  const pref = host.singingPreference()
  const cloud = host.vocalProvider()
  if (pref === 'local') return 'local'
  if (pref === 'cloud') return cloud ? 'cloud' : null
  return host.localSingerReady() ? 'local' : cloud ? 'cloud' : null
}

/**
 * Canta con el cantante local la melodía de todas las secciones. `strict` (el productor)
 * exige una nota por sílaba; desde el editor de letra se adapta la melodía a la letra.
 */
export async function singLocally(
  host: ProducerHost,
  opts: { strict: boolean; message: string }
): Promise<{ trackId: string; regionId: string; notes: number }> {
  if (!host.localSingerReady()) {
    throw new Error(
      'El cantante local no está instalado. Pide al usuario que lo instale en Ajustes → Cantante local.'
    )
  }
  const p = host.getProject()
  const sections = sectionsOf(p).map((s) => ({
    ...s,
    melody: (opts.strict ? s.melody : melodyForLyrics(s.lyrics, s.melody)) ?? undefined
  }))
  const notes = placeMelody(sections, perBar(p), {
    strict: opts.strict,
    range: SINGER_VOICE.range,
    language: p.lyricsLanguage ?? 'es'
  })
  if (notes.length === 0) {
    throw new Error(
      'Ninguna sección tiene melodía. El productor la escribe al componer la canción con letra (o con sing_melody).'
    )
  }
  const ustx = buildUstx({
    singer: SINGER_VOICE.singerId,
    language: p.lyricsLanguage ?? 'es',
    bpm: p.bpm,
    beatsPerBar: perBar(p),
    notes
  })
  const r = await host.singMelody(ustx, opts.message)
  return { ...r, notes: notes.length }
}

export function maxBarsPerClip(p: Project, provider: ProviderInfo | undefined): number {
  if (!provider) return 0
  return Math.max(1, Math.floor(provider.capabilities.maxDurationSec / barsToSeconds(1, p)))
}

/** Resumen del proyecto pensado para el LLM (compacto, en compases). */
export function describeProject(p: Project, host: ProducerHost): unknown {
  const provider = host.audioProvider()
  const vocal = host.vocalProvider()
  return {
    name: p.name,
    ...(p.style && { style: p.style }),
    bpm: p.bpm,
    key: p.key,
    time_signature: p.timeSignature.join('/'),
    song_length_bars: round2(secondsToBeats(projectEndSec(p), p.bpm) / perBar(p)),
    playhead_bar: round2(barOfBeat(p, secondsToBeats(host.playheadSec(), p.bpm))),
    audio_engine: provider
      ? {
          name: provider.label,
          ready: provider.ready,
          ...(provider.notReadyReason && { problem: provider.notReadyReason }),
          max_bars_per_clip: maxBarsPerClip(p, provider)
        }
      : null,
    // Quién canta las canciones con letra ('local': hay que escribir la melodía).
    singing: (() => {
      const who = whoSings(host)
      if (who === 'local') {
        return {
          engine: 'local',
          ready: host.localSingerReady(),
          voice: `${SINGER_VOICE.name}: ${SINGER_VOICE.description}`,
          comfortable_range: SINGER_VOICE.comfortable
        }
      }
      return who === 'cloud' ? { engine: 'cloud' } : null
    })(),
    // Sin motor que cante, las canciones son instrumentales.
    vocal_engine: vocal
      ? {
          name: vocal.label,
          ready: vocal.ready,
          ...(vocal.notReadyReason && { problem: vocal.notReadyReason }),
          max_song_seconds: vocal.capabilities.maxDurationSec
        }
      : null,
    ...(p.vocals && { vocals: p.vocals }),
    // Solo si el usuario configuró "Mi voz": así el productor no lo ofrece sin más.
    ...(() => {
      const mine = host.myVoices()
      return mine.ready || mine.voices.length > 0
        ? { my_voice: { ready: mine.ready, voices: mine.voices.map((v) => v.name) } }
        : {}
    })(),
    // Qué suena en cada sección: así el productor ve los huecos antes de dar nada por hecho.
    sections: sectionCoverage(p).map(({ section: s, layers, partial, thin }) => ({
      id: s.id,
      name: s.name,
      start_bar: s.startBar,
      bars: s.bars,
      ...(s.lyrics && { lyrics: s.lyrics }),
      ...(s.melody && { melody: s.melody }),
      playing: layers.map((l) => l.track),
      status:
        layers.length === 0
          ? 'EMPTY'
          : thin
            ? 'only one layer'
            : partial.length > 0
              ? `gaps in: ${partial.join(', ')}`
              : 'ok'
    })),
    tracks: p.tracks.map((t) => ({
      id: t.id,
      name: t.name,
      role: t.role,
      gain_db: t.gainDb,
      pan: t.pan,
      mute: t.mute,
      solo: t.solo,
      regions: t.regions
        .map((r) => ({
          id: r.id,
          start_bar: round2(barOfBeat(p, r.startBeat)),
          length_bars: round2(secondsToBeats(r.lengthSec, p.bpm) / perBar(p)),
          source: p.clips[r.clipId]?.spec?.prompt ?? 'audio importado'
        }))
        .sort((a, b) => a.start_bar - b.start_bar)
    }))
  }
}

// --- Herramientas ------------------------------------------------------------

/** Tramos a grabar en una pista (ver recordChunks). */
interface ChunkRun {
  steps: ChunkStep[]
  /** Secciones a las que apuntan los pasos (`step.section` es su índice). */
  sections: Section[]
  trackId: string
  /** Compases de la canción: el último tramo puede terminar en fundido. */
  totalBars: number
  signal: AbortSignal
  progress?: (text: string) => void
}

interface ChunkReport {
  generated: number
  failed: { section: string; start_bar: number; error: string }[]
  repaired: { section: string; start_bar: number; bars: number }[]
  drone: { section: string; start_bar: number }[]
}

/** Pista de la canción: la de tipo "full" con más audio generado. */
function songTrackOf(p: Project): Track | undefined {
  return p.tracks
    .filter((t) => t.role === 'full' && t.regions.some((r) => p.clips[r.clipId]?.spec))
    .sort((a, b) => b.regions.length - a.regions.length)[0]
}

/** Región de la pista que termina en `beat` (la que suena justo antes de ahí). */
function regionEndingAt(p: Project, trackId: string, beat: number): Region | undefined {
  return p.tracks
    .find((t) => t.id === trackId)
    ?.regions.find((r) => Math.abs(r.startBeat + secondsToBeats(r.lengthSec, p.bpm) - beat) < 0.05)
}

/**
 * Con batería programada, la revisión mide solo la cama: que el coro no suba ahí no
 * significa nada (la energía la pone la batería, con más capas y un platillo).
 */
function drumsReview<T extends SongReview & { note: string }>(review: T): T {
  return { ...review, issues: review.issues.filter((i) => i.type !== 'flat_energy') }
}

export function createProducerTools(host: ProducerHost): AgentTool[] {
  const commit = (next: Project, message: string): Promise<void> =>
    host.commit(next, AGENT_PREFIX + message)
  // Última guía de género consultada: el LLM copia la estructura pero a menudo se
  // inventa el tempo (108 BPM para un tech house), así que compose_song lo ajusta.
  let guide: GenreGuide | null = null

  /**
   * Graba tramos en orden. Cada uno continúa la región que suena justo antes (el
   * motor escucha sus últimos segundos y se funde con ella), así que no puede ir en
   * paralelo; cada tramo se guarda al terminar. Tras cada uno se escucha: si se atasca
   * (drone grave, siseo estático o un hueco al empezar) se recorta o se quita, y lo
   * que falta se regenera una vez.
   */
  const recordChunks = async (run: ChunkRun): Promise<ChunkReport> => {
    const { sections, trackId, signal } = run
    const secPerBar = barsToSeconds(1, host.getProject())
    const failed: ChunkReport['failed'] = []
    const repaired: ChunkReport['repaired'] = []
    const drone: ChunkReport['drone'] = []
    let generated = 0
    let last: string | null = null
    // Final de cada región: su volumen (para ver un hueco tras la unión) y si está sana
    // (sin atasco), que es lo que oye el tramo que la continúa.
    type Tail = { db: number | null; ok: boolean }
    const tails = new Map<string, Tail>()
    const tailOf = async (id: string): Promise<Tail> => {
      if (!tails.has(id)) {
        const r = await host.inspectRegion(id)
        tails.set(id, { db: r.sound?.tail.db ?? null, ok: r.collapseAtSec === null })
      }
      return tails.get(id)!
    }
    // Para reparar: escuchar un final atascado volvería a atascarse, así que se parte de
    // la última región sana de antes. Solo aquí: en un tramo normal sería un corte.
    const repairContext = async (from: string | null, atBeat: number): Promise<string | null> => {
      if (!from || (await tailOf(from)).ok) return from
      const regions = host.getProject().tracks.flatMap((t) => t.regions)
      let best = from
      let bestBeat = -1
      for (const [id, t] of tails) {
        const beat = regions.find((r) => r.id === id)?.startBeat ?? -1
        if (t.ok && beat < atBeat && beat > bestBeat) [best, bestBeat] = [id, beat]
      }
      return best
    }
    const queue: (ChunkStep & { repair?: boolean })[] = [...run.steps]
    const total = queue.filter((s) => s.kind === 'generate').length
    const started = Date.now()
    let finished = 0
    while (queue.length > 0) {
      const step = queue.shift()!
      if (signal.aborted) throw new Error('Cancelado')
      const section = sections[step.section]
      if (step.kind === 'reuse') {
        const src = sections[step.from]
        await commit(
          copySectionInto(host.getProject(), src.id, section.id),
          `${section.name}: repite ${src.name}`
        )
        last = lastRegionIn(host.getProject(), trackId, section)?.id ?? last
        continue
      }
      const p = host.getProject()
      const atBeat = beatOfBar(p, step.startBar)
      const span = `compases ${step.startBar}–${step.startBar + step.bars - 1}`
      // Lo que suena justo antes (en una canción nueva, el último tramo grabado).
      const before = regionEndingAt(p, trackId, atBeat)?.id ?? last
      const from = step.repair ? await repairContext(before, atBeat) : before
      if (step.repair) {
        run.progress?.(`Reparando ${section.name} (${span})`)
      } else {
        const perPart = finished > 0 ? (Date.now() - started) / finished : 0
        const left = Math.max(1, Math.round((perPart * (total - finished)) / 60_000))
        const eta = finished > 0 ? ` · quedan ~${left} min` : ''
        run.progress?.(`Parte ${finished + 1} de ${total} · ${section.name} (${span})${eta}`)
      }
      // Un tramo que falla se reintenta una vez; si vuelve a fallar, el siguiente
      // continúa desde el último bueno.
      let made: string | null = null
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const r = from
            ? await host.extend(from, step.bars, {
                prompt: step.prompt,
                atBeat,
                message: `${section.name} (${span})`,
                // Fundirse con audio de otra parte de la canción sonaría raro.
                crossfade: from === before
              })
            : await host.generate({
                prompt: step.prompt,
                role: 'full',
                bars: step.bars,
                atBeat,
                trackId
              })
          made = r.regionId
          generated++
          break
        } catch (err) {
          if (signal.aborted) throw err
          if (attempt === 2) {
            failed.push({
              section: section.name,
              start_bar: step.startBar,
              error: err instanceof Error ? err.message : String(err)
            })
          }
        }
      }
      if (!step.repair) finished++
      if (!made) continue

      // ¿Se atascó? El fundido final de la canción no cuenta, ni que un tramo que empieza
      // de cero (la intro) arranque solo con platillos: ahí aún no hay nada que se vacíe.
      const endsSong = step.startBar + step.bars - 1 >= run.totalBars
      const inspected = await host.inspectRegion(made, {
        ignoreTailSec: endsSong ? 2 * secPerBar : 0,
        ...(from ? {} : { thinDb: -Infinity })
      })
      // Un hueco justo tras la unión (el modelo se calla tras el fundido) es un atasco
      // desde el principio.
      const prevDb = from && from === before ? (await tailOf(from)).db : null
      const gap =
        prevDb !== null && !!inspected.sound && hasStartGap(inspected.sound.opening, prevDb)
      const collapseAtSec = gap ? 0 : inspected.collapseAtSec
      tails.set(made, { db: inspected.sound?.tail.db ?? null, ok: collapseAtSec === null })
      if (collapseAtSec === null) {
        last = made
        continue
      }
      if (step.repair) {
        // Ya era la reparación: se queda (mejor que un hueco) y se avisa.
        drone.push({ section: section.name, start_bar: step.startBar })
        last = made
        continue
      }
      // Recortada cambia su final; quitada no debe servir de contexto.
      tails.delete(made)
      const good = Math.min(step.bars - 1, Math.floor(collapseAtSec / secPerBar))
      if (good >= 1) {
        await commit(
          trimRegion(host.getProject(), made, good * secPerBar),
          `${section.name}: recorte de un tramo atascado`
        )
        last = made
      } else {
        await commit(
          removeRegion(host.getProject(), made),
          `${section.name}: fuera un tramo ${gap ? 'que empezaba con un hueco' : 'atascado'}`
        )
      }
      repaired.push({
        section: section.name,
        start_bar: step.startBar + good,
        bars: step.bars - good
      })
      queue.unshift({
        ...step,
        startBar: step.startBar + good,
        bars: step.bars - good,
        repair: true
      })
    }
    return { generated, failed, repaired, drone }
  }

  /** Escucha una pista entera: medidas por sección y por unión (ver review.ts). */
  const reviewTrack = async (trackId: string): Promise<SongReview & { note: string }> => {
    const p = host.getProject()
    const regions: RegionSound[] = []
    for (const r of p.tracks.find((t) => t.id === trackId)?.regions ?? []) {
      const { sound } = await host.inspectRegion(r.id)
      if (sound) {
        regions.push({
          startBeat: r.startBeat,
          endBeat: r.startBeat + secondsToBeats(r.lengthSec, p.bpm),
          lengthSec: r.lengthSec,
          ...sound
        })
      }
    }
    const review = reviewSong(sectionsOf(p), regions, perBar(p))
    return {
      ...review,
      note:
        review.issues.length === 0
          ? 'Listened to the whole song: no abrupt joins, the energy curve is audible and no section sounds dull.'
          : 'Problems a listener would hear. Tell the user about them in plain words and offer the fix (redo_sections with those sections); do not regenerate without asking.'
    }
  }

  const readyProvider = (): ProviderInfo => {
    const provider = host.audioProvider()
    if (!provider?.ready) {
      throw new Error(
        `El motor de audio no está listo: ${provider?.notReadyReason ?? 'no hay ninguno configurado'}. Pide al usuario que lo configure en Ajustes.`
      )
    }
    return provider
  }

  const readyVocalProvider = (): ProviderInfo => {
    const vocal = host.vocalProvider()
    if (!vocal) {
      throw new Error(
        'No hay ningún motor que cante letra. Haz la canción instrumental (sin "lyrics") y díselo al usuario.'
      )
    }
    if (!vocal.ready) {
      throw new Error(
        `El motor de voz no está listo: ${vocal.notReadyReason ?? 'revisa Ajustes'}. Pide al usuario que lo configure en Ajustes.`
      )
    }
    return vocal
  }

  /** Comprueba que la canción cabe en una sola generación del motor que canta. */
  const checkVocalLength = (vocal: ProviderInfo, bars: number, p: Project): void => {
    const sec = barsToSeconds(bars, p)
    if (sec > vocal.capabilities.maxDurationSec) {
      throw new Error(
        `La canción dura ${Math.round(sec)} s y ${vocal.label} canta como mucho ${vocal.capabilities.maxDurationSec} s de una vez. Quita o acorta secciones (a ${p.bpm} BPM caben ${Math.floor(vocal.capabilities.maxDurationSec / barsToSeconds(1, p))} compases) y vuelve a llamar.`
      )
    }
  }

  /**
   * Canta la canción entera de una vez con su letra en la pista `trackId` y la pule.
   * Los motores que cantan generan la canción completa, así que no se encadenan
   * tramos. Lo que tuviera la pista se sustituye solo si la toma nueva sale bien.
   */
  const singSong = async (trackId: string): Promise<string> => {
    const p = host.getProject()
    const req = vocalSongRequest(p)
    checkVocalLength(readyVocalProvider(), req.bars, p)
    const r = await host.generate({
      prompt: req.prompt,
      role: 'full',
      bars: req.bars,
      atBeat: 0,
      trackId,
      lyrics: req.lyrics,
      ...(req.language && { lyricsLanguage: req.language })
    })
    const now = host.getProject()
    const only = {
      ...now,
      tracks: now.tracks.map((t) =>
        t.id === r.trackId ? { ...t, regions: t.regions.filter((x) => x.id === r.regionId) } : t
      )
    }
    await commit(polishSong(only, r.trackId), 'canción cantada: pulido y fundidos')
    return r.regionId
  }

  /**
   * Genera un loop al principio de la primera sección y lo repite hasta llenar todas.
   * Las secciones se vuelven a leer al terminar: el usuario pudo moverlas mientras.
   */
  const loopIntoSections = async (job: {
    prompt: string
    role: TrackRole
    bars: number
    trackId: string | null
    sections: Section[]
  }): Promise<{ trackId: string; filled: Section[] }> => {
    const first = host.getProject()
    const r = await host.generate({
      prompt: job.prompt,
      role: job.role,
      bars: job.bars,
      atBeat: beatOfBar(first, job.sections[0].startBar),
      trackId: job.trackId
    })
    const now = host.getProject()
    const { region } = findRegion(now, r.regionId)
    const ids = new Set(job.sections.map((s) => s.id))
    const filled = sectionsOf(now).filter((s) => ids.has(s.id))
    await commit(
      fillSections(now, r.trackId, region, filled),
      `${ROLE_LABELS[job.role]} en ${filled.map((s) => s.name).join(', ')}`
    )
    return { trackId: r.trackId, filled }
  }

  return [
    {
      def: {
        name: 'get_project_state',
        description:
          'Returns the current song: tempo, key, time signature, length, playhead, the audio engine (and the maximum bars it can generate per clip) and every track with its regions (ids, start bar, length in bars, and the prompt that generated each clip). Call it before making changes that depend on what already exists.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false }
      },
      run: async () => describeProject(host.getProject(), host)
    },
    {
      def: {
        name: 'genre_guide',
        description:
          'Returns how to produce a genre with this audio engine: tempo range, typical structure (sections, bars, energy), a ready "style", example "arrangement" per section type, what to avoid, and example prompts the engine understands. Call it before compose_song. Free and instant (no audio).',
        inputSchema: {
          type: 'object',
          properties: {
            genre: {
              type: 'string',
              description: 'Genre the user wants, e.g. "corridos tumbados", "reggaeton", "house"'
            }
          },
          required: ['genre'],
          additionalProperties: false
        }
      },
      run: async (input) => {
        const genre = str(input, 'genre')
        // Si el usuario pidió una fusión ("house/techno bien tumbado"), manda esa guía
        // aunque el LLM pregunte solo por una parte ("techno"). Decide el mensaje más
        // reciente que nombre algún género.
        const asked = host
          .userMessages?.()
          .map((m) => findGenre(m))
          .find((x) => x !== null)
        const g = asked?.blend ? asked : findGenre(genre)
        guide = g
        if (!g) {
          return {
            found: false,
            known_genres: GENRES.map((x) => x.id),
            example_prompts: PROMPT_EXAMPLES,
            hint: 'Not in the guide: describe it with the closest known genres and concrete instruments, in the same short style as the examples (use web_search if you do not know its sound).'
          }
        }
        return {
          found: true,
          genre: g.id,
          bpm_range: g.bpm,
          style: g.style,
          structure: g.structure.map(([name, bars, energy]) => ({ name, bars, energy })),
          arrangement_examples: g.arrangements,
          avoid: g.avoid,
          example_prompts: PROMPT_EXAMPLES
        }
      }
    },
    {
      def: {
        name: 'compose_song',
        description:
          'Composes a complete NEW song in one call, the way a producer records it from start to end: sets tempo and key, creates the sections and generates the music section by section, each part continuing seamlessly from the previous one, so harmony, groove and sound stay coherent and the music evolves instead of looping. Transitions are added automatically (fills and build-ups between sections, fade in and fade out). You write the arrangement of each section. Replaces previously generated audio and sections (imported audio is kept; the user can undo). Use it for any request for a new song or beat. Takes a long time: it waits until all the audio is ready.',
        inputSchema: {
          type: 'object',
          properties: {
            style: {
              type: 'string',
              description:
                'Shared sound of the whole song IN ENGLISH, 8-15 words: a well-known genre and 3-5 concrete instruments, like the "style" from genre_guide (e.g. "reggaeton, dembow drum pattern, 808 bass, synth plucks, latin percussion"). Turn artist names into descriptions.'
            },
            bpm: { type: 'number', minimum: 40, maximum: 240 },
            key: { type: 'string', description: 'Key such as "E minor"' },
            vocals: {
              type: 'string',
              description:
                'Only for a sung song: the singing voice IN ENGLISH (e.g. "warm male latin vocal, intimate", "powerful female pop vocal with harmonies").'
            },
            language: {
              type: 'string',
              description:
                'Only for a sung song: ISO 639-1 code of the lyrics language (e.g. "es").'
            },
            sections: {
              type: 'array',
              description: 'Song structure in order. Total usually 48-96 bars.',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string', description: "Section name in the user's language" },
                  bars: { type: 'integer', minimum: 1, description: 'Usually 8 or 16' },
                  arrangement: {
                    type: 'string',
                    description:
                      'IN ENGLISH, at most 12 words: which instruments play in this section and what changes (e.g. "full dembow beat, synth hook, claps and shakers"). Always name a rhythm instrument. No tempo, key or vocals.'
                  },
                  energy: {
                    type: 'integer',
                    minimum: 1,
                    maximum: 5,
                    description:
                      '1 = very calm … 5 = peak. Used to shape the transitions (build-ups into higher energy, wind-downs into lower).'
                  },
                  reuse: {
                    type: 'boolean',
                    description:
                      'true to repeat the audio of the previous section with the same name instead of generating it again. Use it for repeated choruses and drops, like real songs do; it also saves several minutes. Ignored when the cloud engine sings the song.'
                  },
                  lyrics: {
                    type: 'string',
                    description:
                      "Lyrics sung in this section, in the user's language, one line per sung phrase (\\n between lines). Omit for instrumental sections. With singing.engine 'cloud' the whole song is sung in one take by the vocal engine."
                  },
                  melody: {
                    type: 'array',
                    description:
                      'Required when singing.engine is \'local\' (replaces lyrics): each sung phrase with its notes, in order from the start of the section. notes: space-separated NOTE:BEATS (e.g. "A4:0.5 C5:1.5"), R:BEATS for rests, exactly one note per syllable.',
                    items: {
                      type: 'object',
                      properties: {
                        text: { type: 'string' },
                        notes: { type: 'string' },
                        lang: LINE_LANG_SCHEMA
                      },
                      required: ['text', 'notes'],
                      additionalProperties: false
                    }
                  }
                },
                required: ['name', 'bars', 'arrangement'],
                additionalProperties: false
              }
            }
          },
          required: ['style', 'sections'],
          additionalProperties: false
        }
      },
      run: async (input, signal, progress) => {
        // Se valida todo antes de tocar nada: si falla, el LLM corrige y vuelve a llamar.
        const parsed = parseSongSpec(input)
        // Igual con el sonido: si el "style" no nombra el género de la guía (un
        // "industrial techno" para un house tumbado), se usa el de la guía.
        const head = guide?.style.split(',')[0].trim().toLowerCase()
        const offStyle = !!head && !parsed.style.toLowerCase().includes(head)
        const styled = offStyle ? { ...parsed, style: guide!.style } : parsed
        // Con batería programada, los coros que se repiten reutilizan el audio del
        // primero (como en el house real): la variación la ponen la batería y los filtros,
        // y se ahorran varios minutos de generación por coro.
        const drums = findPattern(guide?.drums)
        const spec = drums
          ? {
              ...styled,
              sections: styled.sections.map((s, i) =>
                (s.energy ?? 0) >= 4 &&
                styled.sections.slice(0, i).some((o) => sameName(o.name, s.name))
                  ? { ...s, reuse: true }
                  : s
              )
            }
          : styled
        const styleNote = offStyle
          ? `style "${parsed.style}" did not match the ${guide!.id} guide; used "${guide!.style}". Put extra flavour in the sections' arrangement instead.`
          : null
        const asked = num(input, 'bpm', 40, 240, true)
        // Fuera del rango del género, el ritmo deja de ser ese género: se acerca al borde.
        const bpm = guide
          ? Math.min(
              guide.bpm[1],
              Math.max(guide.bpm[0], asked ?? (guide.bpm[0] + guide.bpm[1]) / 2)
            )
          : asked
        const tempoNote =
          guide && asked !== undefined && Math.round(asked) !== Math.round(bpm!)
            ? `bpm ${asked} is outside the ${guide.id} range ${guide.bpm.join('-')}; used ${Math.round(bpm!)}. Use set_tempo_key only if the user asks for another tempo.`
            : null
        const key = str(input, 'key', true)
        const p = host.getProject()
        // Con letra, o la canta entera el motor de la nube (de una vez), o se graba el
        // instrumental por tramos y el cantante local canta la melodía encima.
        const sung = hasLyrics(spec.sections)
        const singer = sung ? whoSings(host) : null
        const local = singer === 'local'
        const cloud = sung && !local
        const provider = cloud ? readyVocalProvider() : readyProvider()
        if (local) {
          if (!host.localSingerReady()) {
            throw new Error(
              'El cantante local no está instalado. Pide al usuario que lo instale (Ajustes → Cantante local) o haz la canción instrumental.'
            )
          }
          const missing = spec.sections.filter((s) => s.lyrics && !s.melody).map((s) => s.name)
          if (missing.length > 0) {
            throw new Error(
              `El cantante local necesita la melodía ("melody") de cada sección cantada; falta en: ${missing.join(', ')}`
            )
          }
          let bar = 1
          placeMelody(
            spec.sections.map((s) => {
              const placed = { name: s.name, startBar: bar, bars: s.bars, melody: s.melody ?? [] }
              bar += s.bars
              return placed
            }),
            perBar(p),
            { strict: true, range: SINGER_VOICE.range, language: spec.language ?? undefined }
          )
        }
        if (cloud) {
          const totalBars = spec.sections.reduce((n, s) => n + s.bars, 0)
          checkVocalLength(provider, totalBars, { ...p, bpm: Math.round(bpm ?? p.bpm) })
        } else if (!provider.capabilities.supportsContinue) {
          throw new Error(
            `${provider.label} no sabe continuar audio, y compose_song lo necesita para que la canción suene como una sola pieza. Pide al usuario que elija otro motor en Ajustes.`
          )
        }

        // Canción nueva: fuera el audio generado antes (el importado se queda) y una
        // pista para la canción. Se limpia antes de cambiar el tempo para no estirar
        // clips que van a desaparecer.
        const kept = p.tracks
          .filter((t) => !t.drums)
          .map((t) => ({ ...t, regions: t.regions.filter((r) => !p.clips[r.clipId]?.spec) }))
          .filter((t) => t.regions.length > 0)
        const song = withDefaultMix(createTrack('Canción', 'full'))
        const sameTempo = bpm === undefined || Math.round(bpm) === p.bpm
        let nextBar = 1
        const planned = setSections(
          {
            ...p,
            tracks: [...kept, song],
            style: spec.style,
            // La voz y el idioma solo tienen sentido en una canción cantada.
            vocals: (sung && spec.vocals) || undefined,
            lyricsLanguage: (sung && spec.language) || undefined,
            ...(sameTempo && key !== undefined && { key })
          },
          spec.sections.map((s) => {
            const startBar = nextBar
            nextBar += s.bars
            return {
              name: s.name,
              startBar,
              bars: s.bars,
              lyrics: s.lyrics,
              melody: s.melody,
              energy: s.energy ?? undefined
            }
          })
        )
        await commit(
          planned,
          `nueva canción${sung ? ' con voz' : ''}: ${spec.sections.map((s) => `${s.name} ${s.bars}`).join(' · ')}`
        )
        if (!sameTempo) await host.setTempo(Math.round(bpm), key, AGENT_PREFIX)
        const sections = sectionsOf(planned)

        if (cloud) {
          let error: string | null = null
          try {
            await singSong(song.id)
          } catch (err) {
            if (signal.aborted) throw err
            error = err instanceof Error ? err.message : String(err)
          }
          const final = host.getProject()
          return {
            ok: error === null,
            sung: true,
            bpm: final.bpm,
            ...(tempoNote && { tempo_note: tempoNote }),
            ...(styleNote && { style_note: styleNote }),
            key: final.key,
            ...(error && { error }),
            sections: sectionsOf(final).map((s) => ({
              id: s.id,
              name: s.name,
              start_bar: s.startBar,
              bars: s.bars,
              sung: !!s.lyrics
            })),
            note: error
              ? 'The structure and lyrics are saved; sing_song retries the vocal take.'
              : 'Sung in one take: the sections are approximate, the singer follows the lyrics. Use sing_song to change lyrics or voice.'
          }
        }

        const secPerBar = barsToSeconds(1, host.getProject())
        const bars = chunkBars(secPerBar, provider.capabilities.maxDurationSec, CONTEXT_SEC)
        // Con cantante local, el instrumental no debe traer voces propias.
        const backing = local ? { ...spec, style: `instrumental, ${spec.style}` } : spec
        const tempo = host.getProject()
        const { generated, failed, repaired, drone } = await recordChunks({
          steps: planChunks(backing, bars, { bpm: tempo.bpm, key: tempo.key }),
          sections,
          trackId: song.id,
          totalBars: spec.sections.reduce((n, s) => n + s.bars, 0),
          signal,
          progress
        })
        if (generated > 0) {
          await commit(
            polishSong(host.getProject(), song.id),
            'pulido: fundidos de entrada y salida'
          )
        }
        // La batería programada y la automatización de la cama: segundos, no minutos.
        let drumsError: string | null = null
        const withDrums = !!drums && generated > 0 && !!host.applyDrums
        if (withDrums) {
          try {
            await host.applyDrums!({
              pattern: drums.id,
              bedTrackId: song.id,
              message: AGENT_PREFIX + `batería programada (${drums.id})`
            })
          } catch (err) {
            if (signal.aborted) throw err
            drumsError = err instanceof Error ? err.message : String(err)
          }
        }

        // La voz va al final, encima del instrumental: si falla, la canción se queda.
        let vocalError: string | null = null
        if (local && generated > 0) {
          try {
            await singLocally(host, { strict: true, message: AGENT_PREFIX + 'voz cantada' })
          } catch (err) {
            if (signal.aborted) throw err
            vocalError = err instanceof Error ? err.message : String(err)
          }
        }

        // Antes de dar la canción por hecha, se escucha el instrumental entero.
        const review = generated > 0 ? await reviewTrack(song.id) : null
        const final = host.getProject()
        const ids = new Set(sections.map((s) => s.id))
        return {
          ok: failed.length === 0 && vocalError === null,
          ...(local && { sung_by: SINGER_VOICE.name }),
          ...(vocalError && {
            vocal_error: vocalError,
            vocal_hint: 'The instrumental is saved; fix the melody and call sing_melody.'
          }),
          bpm: final.bpm,
          ...(tempoNote && { tempo_note: tempoNote }),
          ...(styleNote && { style_note: styleNote }),
          key: final.key,
          bars_per_part: bars,
          parts_generated: generated,
          ...(failed.length > 0 && { failed }),
          ...(repaired.length > 0 && {
            repaired,
            repaired_note:
              'These parts got stuck (a low drone, static hiss or the music thinning out to a faint hi-hat); the stuck audio was cut and regenerated automatically.'
          }),
          ...(drone.length > 0 && {
            drone,
            drone_note:
              'These parts still sound like a low drone after one repair. Tell the user and offer create_variation on them.'
          }),
          sections: sectionCoverage(final)
            .filter((c) => ids.has(c.section.id))
            .map((c) => ({
              id: c.section.id,
              name: c.section.name,
              start_bar: c.section.startBar,
              bars: c.section.bars,
              has_music: c.layers.length > 0
            })),
          ...(withDrums &&
            (drumsError
              ? { drums_error: drumsError }
              : {
                  drums: drums.label,
                  drums_note:
                    'Programmed drums play on top of the generated music, with filter sweeps (intro opening, build-up before each chorus, filtered break) and sidechain pumping. Repeated choruses reuse the first one. Change them with set_drums.'
                })),
          check: reviewProject(final) ?? 'Every section has music.',
          ...(review && { review: withDrums && !drumsError ? drumsReview(review) : review })
        }
      }
    },
    {
      def: {
        name: 'set_drums',
        description:
          'Programmed drums over the whole song (compose_song adds them by itself for house, techno, reggaeton and trap): a tight pattern in tempo whose layers follow the energy of each section, with a snare build-up and riser before each chorus, a break without kick, a crash on the drops, and sidechain pumping of the song track. Use it for "more/less percussion", "another beat", "remove the drums". Takes a few seconds.',
        inputSchema: {
          type: 'object',
          properties: {
            pattern: {
              type: 'string',
              enum: [...DRUM_PATTERNS.map((d) => d.id), 'off'],
              description: `Drum pattern, or "off" to remove the programmed drums. ${DRUM_PATTERNS.map((d) => `${d.id}: ${d.label}`).join('; ')}.`
            },
            intensity: {
              type: 'integer',
              minimum: -2,
              maximum: 2,
              description:
                'Shift the energy of every section: -2 sparse (kick and hats), 0 as planned, +2 every layer everywhere.'
            }
          },
          required: ['pattern'],
          additionalProperties: false
        }
      },
      run: async (input) => {
        const pattern = str(input, 'pattern')
        if (pattern === 'off') {
          if (!host.removeDrums) throw new Error('Esta app no tiene batería programada')
          await host.removeDrums(AGENT_PREFIX + 'sin batería programada')
          return { ok: true, drums: null }
        }
        const found = findPattern(pattern)
        if (!found) {
          throw new Error(
            `No existe el patrón "${pattern}". Usa uno de: ${DRUM_PATTERNS.map((d) => d.id).join(', ')}, u "off".`
          )
        }
        if (!host.applyDrums) throw new Error('Esta app no tiene batería programada')
        const intensity = num(input, 'intensity', -2, 2, true) ?? 0
        const p = host.getProject()
        if (sectionsOf(p).length === 0) {
          throw new Error(
            'La canción no tiene secciones: compón la canción o crea la estructura antes.'
          )
        }
        const { trackId } = await host.applyDrums({
          pattern: found.id,
          intensity,
          bedTrackId: songTrackOf(p)?.id ?? null,
          message:
            AGENT_PREFIX +
            `batería: ${found.id}${intensity ? ` (${intensity > 0 ? '+' : ''}${intensity})` : ''}`
        })
        return { ok: true, track_id: trackId, drums: found.label, intensity }
      }
    },
    {
      def: {
        name: 'review_song',
        description:
          'Listens to the finished instrumental: loudness and brightness of every section, and problems a listener would hear (abrupt joins between parts, a chorus or drop that is not louder than the calmer sections, a dull section). compose_song already includes it; call it after changing parts of a song. Free and fast (no audio is generated).',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false }
      },
      run: async () => {
        const song = songTrackOf(host.getProject())
        if (!song) throw new Error('No hay ninguna canción generada que revisar')
        return reviewTrack(song.id)
      }
    },
    {
      def: {
        name: 'redo_sections',
        description:
          "Records again whole sections of the finished song (typically the ones review_song or compose_song's review flag), keeping the rest. Each new part continues the music right before it and blends into it, with the same automatic repair as compose_song, and the song is reviewed again at the end. Much cheaper than composing the song again, but each part still takes about 6-7 minutes on this computer: tell the user how long before calling it.",
        inputSchema: {
          type: 'object',
          properties: {
            section_ids: {
              type: 'array',
              items: { type: 'string' },
              description: 'Ids of the sections to record again (from get_project_state).'
            }
          },
          required: ['section_ids'],
          additionalProperties: false
        }
      },
      run: async (input, signal, progress) => {
        const ids = input.section_ids
        if (!Array.isArray(ids) || ids.length === 0 || ids.some((x) => typeof x !== 'string')) {
          throw new Error('section_ids debe ser una lista de ids de sección')
        }
        const p = host.getProject()
        const song = songTrackOf(p)
        if (!song) throw new Error('No hay ninguna canción generada que rehacer')
        const provider = readyProvider()
        if (!provider.capabilities.supportsContinue) {
          throw new Error(`${provider.label} no sabe continuar audio; elige otro motor en Ajustes.`)
        }
        const all = sectionsOf(p)
        const targets = all.filter((s) => ids.includes(s.id))
        const unknown = (ids as string[]).filter((id) => !all.some((s) => s.id === id))
        if (unknown.length > 0) throw new Error(`Secciones desconocidas: ${unknown.join(', ')}`)

        const bars = chunkBars(
          barsToSeconds(1, p),
          provider.capabilities.maxDurationSec,
          CONTEXT_SEC
        )
        const steps: ChunkStep[] = []
        const doomed = new Set<string>()
        for (const s of targets) {
          const a = beatOfBar(p, s.startBar)
          const b = beatOfBar(p, s.startBar + s.bars)
          const old = song.regions
            .filter((r) => r.startBeat >= a - 0.01 && r.startBeat < b - 0.01)
            .sort((x, y) => x.startBeat - y.startBeat)
          old.forEach((r) => doomed.add(r.id))
          // Cada parte nueva repite la descripción de la que sustituye.
          const prompts = old.flatMap((r) => p.clips[r.clipId]?.spec?.prompt ?? [])
          const fallback = [p.style, s.name.toLowerCase()].filter(Boolean).join(', ')
          for (let k = 0; k * bars < s.bars; k++) {
            steps.push({
              kind: 'generate',
              section: all.indexOf(s),
              startBar: s.startBar + k * bars,
              bars: Math.min(bars, s.bars - k * bars),
              prompt: prompts[k] ?? prompts.at(-1) ?? fallback
            })
          }
        }

        // Fuera el audio viejo. Una región que sigue a una sección rehecha entraba
        // fundiéndose con ese audio viejo: pierde el pre-roll.
        const ends = targets.map((s) => beatOfBar(p, s.startBar + s.bars))
        let next = p
        for (const id of doomed) next = removeRegion(next, id)
        next = {
          ...next,
          tracks: next.tracks.map((t) =>
            t.id !== song.id
              ? t
              : {
                  ...t,
                  regions: t.regions.map((r) =>
                    r.leadInSec && ends.some((e) => Math.abs(e - r.startBeat) < 0.05)
                      ? { ...r, leadInSec: undefined, fadeInSec: 0.01 }
                      : r
                  )
                }
          )
        }
        await commit(next, `rehacer: ${targets.map((s) => s.name).join(', ')}`)

        const report = await recordChunks({
          steps,
          sections: all,
          trackId: song.id,
          totalBars: Math.max(...all.map((s) => s.startBar + s.bars - 1)),
          signal,
          progress
        })
        if (report.generated > 0) {
          await commit(
            polishSong(host.getProject(), song.id),
            'pulido: fundidos de entrada y salida'
          )
        }
        return {
          ok: report.failed.length === 0,
          redone: targets.map((s) => s.name),
          parts_generated: report.generated,
          ...(report.failed.length > 0 && { failed: report.failed }),
          ...(report.repaired.length > 0 && { repaired: report.repaired }),
          ...(report.drone.length > 0 && {
            drone: report.drone,
            drone_note: 'These parts still sound stuck after one repair. Tell the user.'
          }),
          ...(report.generated > 0 && { review: await reviewTrack(song.id) })
        }
      }
    },
    {
      def: {
        name: 'sing_melody',
        description:
          "Sings the song again with the LOCAL singer (singing.engine 'local'): optionally replaces the melody (and so the lyrics) of some sections first. Use it to change lyrics, fix a melody or add singing to sections. Renders the whole vocal track from bar 1 over the existing instrumental and replaces the previous take. Takes a few minutes.",
        inputSchema: {
          type: 'object',
          properties: {
            sections: {
              type: 'array',
              description:
                'Only the sections whose melody changes. An empty melody makes the section instrumental.',
              items: {
                type: 'object',
                properties: {
                  section_id: { type: 'string' },
                  melody: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        text: { type: 'string' },
                        notes: { type: 'string' },
                        lang: LINE_LANG_SCHEMA
                      },
                      required: ['text', 'notes'],
                      additionalProperties: false
                    }
                  }
                },
                required: ['section_id', 'melody'],
                additionalProperties: false
              }
            }
          },
          additionalProperties: false
        }
      },
      run: async (input) => {
        let p = host.getProject()
        const raw = typeof input.sections === 'string' ? JSON.parse(input.sections) : input.sections
        for (const c of (raw ?? []) as { section_id?: unknown; melody?: unknown }[]) {
          const id = typeof c?.section_id === 'string' ? c.section_id : ''
          const section = sectionsOf(p).find((s) => s.id === id)
          if (!section) {
            throw new Error(`No existe la sección "${id}". Usa get_project_state para ver los ids.`)
          }
          const melody = parseMelodyLines(c.melody, section.name) ?? []
          p = updateSection(p, id, {
            melody: melody.length ? melody : undefined,
            lyrics: melody.map((l) => l.text).join('\n')
          })
        }
        // Se valida antes de guardar: si falla, el LLM corrige la melodía.
        placeMelody(sectionsOf(p), perBar(p), {
          strict: true,
          range: SINGER_VOICE.range,
          language: p.lyricsLanguage ?? undefined
        })
        if (p !== host.getProject()) await commit(p, 'melodía actualizada')
        const r = await singLocally(host, { strict: true, message: AGENT_PREFIX + 'voz cantada' })
        return { ok: true, track_id: r.trackId, region_id: r.regionId, notes: r.notes }
      }
    },
    {
      def: {
        name: 'sing_song',
        description:
          'Sings the current song again in one take with the vocal engine: optionally replaces the lyrics of some sections and/or the singing voice first. Use it for "change the chorus lyrics", "make a man sing it", "another take of the vocals". The structure, style, tempo and key stay. Replaces the song track if the new take succeeds (the user can undo). Takes a while: it waits until the audio is ready.',
        inputSchema: {
          type: 'object',
          properties: {
            lyrics: {
              type: 'array',
              description:
                'New lyrics per section (only the sections that change). Empty text makes the section instrumental.',
              items: {
                type: 'object',
                properties: {
                  section_id: { type: 'string' },
                  text: { type: 'string', description: 'One line per sung phrase' }
                },
                required: ['section_id', 'text'],
                additionalProperties: false
              }
            },
            vocals: {
              type: 'string',
              description: 'New singing voice IN ENGLISH (e.g. "deep male baritone vocal")'
            }
          },
          additionalProperties: false
        }
      },
      run: async (input) => {
        const vocal = readyVocalProvider()
        let p = host.getProject()
        const raw = input.lyrics
        const changes = typeof raw === 'string' ? (JSON.parse(raw) as unknown) : (raw ?? [])
        if (!Array.isArray(changes)) throw new Error('"lyrics" debe ser una lista')
        for (const c of changes as { section_id?: unknown; text?: unknown }[]) {
          const id = typeof c?.section_id === 'string' ? c.section_id : ''
          if (!sectionsOf(p).some((s) => s.id === id)) {
            throw new Error(`No existe la sección "${id}". Usa get_project_state para ver los ids.`)
          }
          p = updateSection(p, id, { lyrics: typeof c.text === 'string' ? c.text.trim() : '' })
        }
        const vocals = str(input, 'vocals', true)
        if (vocals) p = { ...p, vocals: vocals.trim() }
        if (!hasLyrics(sectionsOf(p))) {
          throw new Error('La canción no tiene letra: escribe la de alguna sección en "lyrics".')
        }
        checkVocalLength(vocal, vocalSongRequest(p).bars, p)
        if (p !== host.getProject()) await commit(p, 'letra y voz actualizadas')

        // La canción vive en la pista completa más reciente; si no hay, se crea.
        const songTrack =
          [...p.tracks].reverse().find((t) => t.role === 'full' && t.name === 'Canción') ??
          withDefaultMix(createTrack('Canción', 'full'))
        if (!p.tracks.some((t) => t.id === songTrack.id)) {
          await commit({ ...p, tracks: [...p.tracks, songTrack] }, 'pista para la canción')
        }
        const regionId = await singSong(songTrack.id)
        return { ok: true, region_id: regionId, track_id: songTrack.id }
      }
    },
    {
      def: {
        name: 'sing_with_my_voice',
        description:
          "Makes a vocal track sound like the USER'S OWN voice (voice conversion with their trained voice model). The input must be a region of a VOCAL track: for a sung song, first call separate_stems on the song region and use the region of its vocal track. The result is a new track under it and the original vocal track is muted. Slow on CPU: about 2-3 times the length of the audio.",
        inputSchema: {
          type: 'object',
          properties: {
            region_id: { type: 'string', description: 'Region of a vocal track' },
            voice: {
              type: 'string',
              description: 'Name of the user voice (see my_voice.voices). Default: the first one.'
            },
            pitch: {
              type: 'integer',
              minimum: -24,
              maximum: 24,
              description:
                'Semitones. 0 by default. Use -12 when a female singer is converted to a male voice, +12 for male to female.'
            }
          },
          required: ['region_id'],
          additionalProperties: false
        }
      },
      run: async (input) => {
        const mine = host.myVoices()
        if (!mine.ready) {
          throw new Error(
            '"Mi voz" no está instalado. Pide al usuario que lo instale en Ajustes → Mi voz.'
          )
        }
        if (mine.voices.length === 0) {
          throw new Error(
            'El usuario aún no tiene ninguna voz suya. Dile que entrene una (Ajustes → Mi voz explica cómo, gratis) y la importe.'
          )
        }
        const wanted = str(input, 'voice', true)?.trim().toLowerCase()
        const voice = wanted
          ? (mine.voices.find((v) => v.name.toLowerCase() === wanted) ??
            mine.voices.find((v) => v.name.toLowerCase().includes(wanted)))
          : mine.voices[0]
        if (!voice) {
          throw new Error(
            `No existe la voz "${String(input.voice)}". Voces: ${mine.voices.map((v) => v.name).join(', ')}`
          )
        }
        const regionId = str(input, 'region_id')
        const now = host.getProject()
        const { track, region } = findRegion(now, regionId)
        if (now.clips[region.clipId]?.provider === SINGER_PROVIDER) {
          throw new Error(
            `Esa voz es la del cantante local (${SINGER_VOICE.name}) y sus condiciones de uso no permiten convertirla a otra voz. Para cantar con la voz del usuario, haz la canción con el motor de la nube y separa su voz.`
          )
        }
        if (track.role !== 'vocal') {
          throw new Error(
            `La región está en "${track.name}", que no es una pista de voz. Separa antes la canción con separate_stems y usa la región de su pista de voz.`
          )
        }
        const pitch = Math.round(num(input, 'pitch', -24, 24, true) ?? 0)
        const r = await host.convertVoice(regionId, {
          voiceId: voice.id,
          voiceName: voice.name,
          pitch
        })
        return { ok: true, voice: voice.name, track_id: r.trackId, region_id: r.regionId }
      }
    },
    {
      def: {
        name: 'fill_section',
        description:
          'Generates a loop for one instrument layer and repeats it to fill a whole section from start to end, replacing what that layer had there. Pass a section id, or a section name to fill every section with that name (e.g. all the "Chorus" sections). Use it to add a missing layer ("add bass to the chorus"), redo a layer in a section, or fill gaps. Waits until the audio is ready.',
        inputSchema: {
          type: 'object',
          properties: {
            section: {
              type: 'string',
              description: 'Section id, or a section name to fill all sections with that name'
            },
            role: { type: 'string', enum: ROLES },
            prompt: {
              type: 'string',
              description:
                "IN ENGLISH, describe ONLY this instrument. The song's shared style is added automatically."
            },
            track_id: {
              type: 'string',
              description: 'Track to use (default: the existing track of that role, or a new one)'
            }
          },
          required: ['section', 'role', 'prompt'],
          additionalProperties: false
        }
      },
      run: async (input) => {
        const p = host.getProject()
        const provider = readyProvider()
        const ref = str(input, 'section').trim()
        const all = sectionsOf(p)
        let targets = all.filter((s) => s.id === ref)
        if (targets.length === 0) {
          targets = all.filter((s) => s.name.toLowerCase() === ref.toLowerCase())
        }
        if (targets.length === 0) {
          throw new Error(
            all.length === 0
              ? 'La canción no tiene secciones: créalas con set_sections o usa compose_song.'
              : `No existe la sección "${ref}". Secciones: ${all.map((s) => `${s.name} (${s.id})`).join(', ')}`
          )
        }
        const role = str(input, 'role') as TrackRole
        if (!ROLES.includes(role)) throw new Error(`"role" debe ser uno de: ${ROLES.join(', ')}`)
        const trackId =
          str(input, 'track_id', true) ?? p.tracks.find((t) => t.role === role)?.id ?? null
        if (trackId) findTrack(p, trackId)
        const bars = loopBars(maxBarsPerClip(p, provider), Math.max(...targets.map((t) => t.bars)))
        const { trackId: usedTrack, filled } = await loopIntoSections({
          prompt: layerPrompt(str(input, 'prompt'), p.style),
          role,
          bars,
          trackId,
          sections: targets
        })
        return {
          ok: true,
          track_id: usedTrack,
          filled: filled.map((s) => ({ name: s.name, start_bar: s.startBar, bars: s.bars })),
          loop_bars: bars
        }
      }
    },
    {
      def: {
        name: 'set_tempo_key',
        description:
          'Sets the song tempo (BPM) and/or musical key, e.g. "A minor", "F# major". New clips are generated at this tempo and key. Existing generated clips are automatically time-stretched to keep their length in bars (pitch is not changed, so changing the key does not transpose existing audio). Imported audio is not stretched.',
        inputSchema: {
          type: 'object',
          properties: {
            bpm: { type: 'number', minimum: 40, maximum: 240 },
            key: { type: 'string', description: 'Key such as "C minor" or "E major"' }
          },
          additionalProperties: false
        }
      },
      run: async (input) => {
        const p = host.getProject()
        const bpm = num(input, 'bpm', 40, 240, true)
        const key = str(input, 'key', true)
        if (bpm === undefined && key === undefined) throw new Error('Indica bpm y/o key')
        const newBpm = bpm !== undefined ? Math.round(bpm) : p.bpm
        if (newBpm === p.bpm) {
          const next = { ...p, key: key ?? p.key }
          await commit(next, `tonalidad ${next.key}`)
          return { ok: true, bpm: p.bpm, key: next.key }
        }
        const result = await host.setTempo(newBpm, key, AGENT_PREFIX)
        return {
          ok: true,
          bpm: newBpm,
          key: key ?? p.key,
          clips_time_stretched: result.adjusted,
          ...(result.skipped > 0 && {
            warning: `${result.skipped} imported clip(s) could not be stretched and will not match the new tempo.`
          })
        }
      }
    },
    {
      def: {
        name: 'set_sections',
        description:
          'Defines the song structure as named sections (e.g. Intro, Verse, Chorus, Bridge, Outro), replacing any existing ones. Sections are markers in bars that help organise the song; they do not move audio. Use it to plan the arrangement before generating, then fill each section. Sections must not overlap.',
        inputSchema: {
          type: 'object',
          properties: {
            sections: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string', description: "Section name in the user's language" },
                  start_bar: { type: 'integer', minimum: 1 },
                  bars: { type: 'integer', minimum: 1 }
                },
                required: ['name', 'start_bar', 'bars'],
                additionalProperties: false
              }
            }
          },
          required: ['sections'],
          additionalProperties: false
        }
      },
      run: async (input) => {
        const list = parseSections(input.sections)
        const next = setSections(host.getProject(), list)
        await commit(next, `estructura: ${list.map((s) => `${s.name} ${s.bars}`).join(' · ')}`)
        return {
          ok: true,
          sections: sectionsOf(next).map((s) => ({
            id: s.id,
            name: s.name,
            start_bar: s.startBar,
            bars: s.bars
          }))
        }
      }
    },
    {
      def: {
        name: 'copy_section',
        description:
          'Copies a whole section, with all the audio regions that start inside it on every track. Give to_section_id to copy it into an existing section (e.g. the first chorus into the second one), replacing its audio; or to_bar to create a new section there (default: after the last section). Use it to repeat a finished chorus instead of generating it again.',
        inputSchema: {
          type: 'object',
          properties: {
            section_id: { type: 'string' },
            to_section_id: {
              type: 'string',
              description: 'Existing section to copy the audio into'
            },
            to_bar: {
              type: 'integer',
              minimum: 1,
              description: 'Destination start bar (omit to append at the end)'
            }
          },
          required: ['section_id'],
          additionalProperties: false
        }
      },
      run: async (input) => {
        const p = host.getProject()
        const id = str(input, 'section_id')
        const src = sectionsOf(p).find((s) => s.id === id)
        if (!src)
          throw new Error(`No existe la sección "${id}". Usa get_project_state para ver los ids.`)
        const toBar = num(input, 'to_bar', 1, 1000, true)
        const toSectionId = str(input, 'to_section_id', true)
        // Si el destino es una sección que ya existe (por id, o porque empieza en ese
        // compás), se copia dentro de ella en vez de fallar por solaparse.
        const dst = toSectionId
          ? sectionsOf(p).find((s) => s.id === toSectionId)
          : toBar !== undefined
            ? sectionsOf(p).find((s) => s.id !== id && s.startBar === Math.round(toBar))
            : undefined
        if (toSectionId && !dst) {
          throw new Error(
            `No existe la sección "${toSectionId}". Usa get_project_state para ver los ids.`
          )
        }
        if (dst) {
          await commit(copySectionInto(p, id, dst.id), `sección ${src.name} copiada en ${dst.name}`)
          return { ok: true, section_id: dst.id, start_bar: dst.startBar, bars: dst.bars }
        }
        const next = copySection(p, id, toBar === undefined ? undefined : Math.round(toBar))
        const copy = sectionsOf(next).find((s) => !sectionsOf(p).some((o) => o.id === s.id))!
        await commit(next, `sección ${src.name} copiada al compás ${copy.startBar}`)
        return { ok: true, new_section_id: copy.id, start_bar: copy.startBar, bars: copy.bars }
      }
    },
    {
      def: {
        name: 'generate_clip',
        description:
          'Generates ONE audio clip and places it at a bar. For a whole new song use compose_song, and to fill a section with a layer use fill_section; use this only for a single clip at a precise spot. Waits until the audio is ready. Never longer than max_bars_per_clip from get_project_state.',
        inputSchema: {
          type: 'object',
          properties: {
            prompt: {
              type: 'string',
              description:
                'Concrete description IN ENGLISH of the sound: genre, instruments, timbre, mood, playing style. Do not include tempo or key (added automatically).'
            },
            role: { type: 'string', enum: ROLES, description: 'Instrument layer of the clip' },
            bars: { type: 'integer', minimum: 1, description: 'Length in bars' },
            start_bar: {
              type: 'integer',
              minimum: 1,
              description: 'Bar where it starts (1 = start)'
            },
            track_id: {
              type: 'string',
              description:
                'Existing track to put it on. Omit to use the track of the same role (or create one).'
            },
            track_name: {
              type: 'string',
              description: 'Name for the new track (when track_id is omitted)'
            }
          },
          required: ['prompt', 'role', 'bars', 'start_bar'],
          additionalProperties: false
        }
      },
      run: async (input) => {
        const p = host.getProject()
        const provider = readyProvider()
        const prompt = str(input, 'prompt')
        const role = str(input, 'role') as TrackRole
        if (!ROLES.includes(role)) throw new Error(`"role" debe ser uno de: ${ROLES.join(', ')}`)
        const max = maxBarsPerClip(p, provider)
        const bars = Math.round(num(input, 'bars', 1, max))
        const startBar = Math.round(num(input, 'start_bar', 1, 1000))
        const trackName = str(input, 'track_name', true)
        let trackId = str(input, 'track_id', true) ?? null
        if (trackId) findTrack(p, trackId)
        // Sin pista indicada se usa la del mismo instrumento si está libre ahí, en vez
        // de crear una pista nueva por cada clip.
        if (!trackId && !trackName) {
          const from = beatOfBar(p, startBar)
          const to = beatOfBar(p, startBar + bars)
          trackId = p.tracks.find((t) => t.role === role && !trackBusy(p, t, from, to))?.id ?? null
        }
        const result = await host.generate({
          prompt: layerPrompt(prompt, p.style),
          role,
          bars,
          atBeat: beatOfBar(p, startBar),
          trackId,
          trackName
        })
        return {
          ok: true,
          track_id: result.trackId,
          region_id: result.regionId,
          start_bar: startBar,
          bars
        }
      }
    },
    {
      def: {
        name: 'create_variation',
        description:
          'Replaces a region with a new take of the same idea: same prompt, new random seed, optionally with extra instructions (e.g. "more energetic", "no cymbals"). Use it when the user wants "another version" of a part. Waits until the audio is ready.',
        inputSchema: {
          type: 'object',
          properties: {
            region_id: { type: 'string' },
            instructions: { type: 'string', description: 'Optional extra direction, in English' }
          },
          required: ['region_id'],
          additionalProperties: false
        }
      },
      run: async (input) => {
        const p = host.getProject()
        const { track, region } = findRegion(p, str(input, 'region_id'))
        const result = await host.vary(region.id, str(input, 'instructions', true))
        return { ok: true, track_id: track.id, new_region_id: result.regionId }
      }
    },
    {
      def: {
        name: 'extend_region',
        description:
          'Continues a region with NEW music that follows on from its ending (the audio engine listens to the last seconds and keeps playing), placed right after it on the same track. Unlike repeat_region, the continuation evolves instead of looping. Waits until the audio is ready.',
        inputSchema: {
          type: 'object',
          properties: {
            region_id: { type: 'string' },
            bars: { type: 'integer', minimum: 1, description: 'How many new bars to add' },
            instructions: {
              type: 'string',
              description: 'Optional direction for the continuation, in English'
            }
          },
          required: ['region_id', 'bars'],
          additionalProperties: false
        }
      },
      run: async (input) => {
        const p = host.getProject()
        const { track, region } = findRegion(p, str(input, 'region_id'))
        const bars = Math.round(num(input, 'bars', 1, 64))
        const result = await host.extend(region.id, bars, {
          instructions: str(input, 'instructions', true)
        })
        return {
          ok: true,
          track_id: track.id,
          new_region_id: result.regionId,
          starts_at_bar: round2(
            barOfBeat(p, region.startBeat + secondsToBeats(region.lengthSec, p.bpm))
          )
        }
      }
    },
    {
      def: {
        name: 'separate_stems',
        description:
          'Splits the audio of a region (typically an imported song) into separate tracks: vocals, drums, bass and other instruments, placed under the original, which gets muted. Runs on the local engine and can take several minutes on CPU. Use it when the user wants to isolate or remove the voice, drums, etc.',
        inputSchema: {
          type: 'object',
          properties: { region_id: { type: 'string' } },
          required: ['region_id'],
          additionalProperties: false
        }
      },
      run: async (input) => {
        const p = host.getProject()
        const { region } = findRegion(p, str(input, 'region_id'))
        const r = await host.separate(region.id)
        return {
          ok: true,
          new_track_ids: r.trackIds,
          stems: r.stems,
          empty_stems_skipped: r.skipped
        }
      }
    },
    {
      def: {
        name: 'repeat_region',
        description:
          'Repeats a region back-to-back right after itself on the same track, `times` extra copies. Use it to turn a short loop into a longer section.',
        inputSchema: {
          type: 'object',
          properties: {
            region_id: { type: 'string' },
            times: {
              type: 'integer',
              minimum: 1,
              maximum: 64,
              description: 'Number of extra copies'
            }
          },
          required: ['region_id', 'times'],
          additionalProperties: false
        }
      },
      run: async (input) => {
        const p = host.getProject()
        const { track, region } = findRegion(p, str(input, 'region_id'))
        const times = Math.round(num(input, 'times', 1, 64))
        const lenBeats = secondsToBeats(region.lengthSec, p.bpm)
        const copies: Region[] = Array.from({ length: times }, (_, i) => ({
          ...region,
          id: newId('rgn'),
          startBeat: region.startBeat + lenBeats * (i + 1)
        }))
        await commit(
          updateTrack(p, track.id, { regions: [...track.regions, ...copies] }),
          `${track.name}: repetida ${times} ${times === 1 ? 'vez' : 'veces'}`
        )
        return {
          ok: true,
          new_region_ids: copies.map((c) => c.id),
          ends_at_bar: round2(barOfBeat(p, copies.at(-1)!.startBeat + lenBeats))
        }
      }
    },
    {
      def: {
        name: 'move_region',
        description: 'Moves a region to another start bar and optionally to another track.',
        inputSchema: {
          type: 'object',
          properties: {
            region_id: { type: 'string' },
            start_bar: { type: 'number', minimum: 1 },
            track_id: {
              type: 'string',
              description: 'Destination track (omit to keep the same one)'
            }
          },
          required: ['region_id', 'start_bar'],
          additionalProperties: false
        }
      },
      run: async (input) => {
        const p = host.getProject()
        const { track, region } = findRegion(p, str(input, 'region_id'))
        const startBar = num(input, 'start_bar', 1, 1000)
        const destId = str(input, 'track_id', true) ?? track.id
        findTrack(p, destId)
        const moved = { ...region, startBeat: beatOfBar(p, startBar) }
        const next = {
          ...removeRegion(p, region.id),
          tracks: removeRegion(p, region.id).tracks.map((t) =>
            t.id === destId ? { ...t, regions: [...t.regions, moved] } : t
          )
        }
        await commit(next, `región movida al compás ${startBar}`)
        return { ok: true }
      }
    },
    {
      def: {
        name: 'delete_region',
        description: 'Deletes one region from the timeline.',
        inputSchema: {
          type: 'object',
          properties: { region_id: { type: 'string' } },
          required: ['region_id'],
          additionalProperties: false
        }
      },
      run: async (input) => {
        const p = host.getProject()
        const { track, region } = findRegion(p, str(input, 'region_id'))
        await commit(removeRegion(p, region.id), `${track.name}: región eliminada`)
        return { ok: true }
      }
    },
    {
      def: {
        name: 'set_track',
        description:
          'Changes a track: name, volume in dB (0 = unchanged, negative = quieter), pan (-1 left … 1 right), mute and solo. Only the given fields change.',
        inputSchema: {
          type: 'object',
          properties: {
            track_id: { type: 'string' },
            name: { type: 'string' },
            gain_db: { type: 'number', minimum: MIN_GAIN_DB, maximum: MAX_GAIN_DB },
            pan: { type: 'number', minimum: -1, maximum: 1 },
            mute: { type: 'boolean' },
            solo: { type: 'boolean' }
          },
          required: ['track_id'],
          additionalProperties: false
        }
      },
      run: async (input) => {
        const p = host.getProject()
        const track = findTrack(p, str(input, 'track_id'))
        const patch: Partial<Track> = {}
        const name = str(input, 'name', true)
        const gainDb = num(input, 'gain_db', MIN_GAIN_DB, MAX_GAIN_DB, true)
        const pan = num(input, 'pan', -1, 1, true)
        const mute = bool(input, 'mute')
        const solo = bool(input, 'solo')
        if (name !== undefined) patch.name = name.trim()
        if (gainDb !== undefined) patch.gainDb = Math.round(gainDb * 2) / 2
        if (pan !== undefined) patch.pan = Math.round(pan * 20) / 20
        if (mute !== undefined) patch.mute = mute
        if (solo !== undefined) patch.solo = solo
        if (Object.keys(patch).length === 0) throw new Error('No se indicó ningún cambio')
        const parts = Object.entries(patch).map(([k, v]) => `${k} ${v}`)
        await commit(updateTrack(p, track.id, patch), `${track.name}: ${parts.join(', ')}`)
        return { ok: true, track: { id: track.id, ...patch } }
      }
    },
    {
      def: {
        name: 'delete_track',
        description: 'Deletes a whole track and its regions.',
        inputSchema: {
          type: 'object',
          properties: { track_id: { type: 'string' } },
          required: ['track_id'],
          additionalProperties: false
        }
      },
      run: async (input) => {
        const p = host.getProject()
        const track = findTrack(p, str(input, 'track_id'))
        await commit(removeTrack(p, track.id), `pista ${track.name} eliminada`)
        return { ok: true }
      }
    },
    {
      def: {
        name: 'play',
        description: 'Starts playback so the user can listen, from a bar (default: the start).',
        inputSchema: {
          type: 'object',
          properties: { from_bar: { type: 'number', minimum: 1 } },
          additionalProperties: false
        }
      },
      run: async (input) => {
        const p = host.getProject()
        const fromBar = num(input, 'from_bar', 1, 1000, true) ?? 1
        host.play(beatsToSeconds(beatOfBar(p, fromBar), p.bpm))
        return { ok: true, playing_from_bar: fromBar }
      }
    }
  ]
}
