// Lo que hace un productor con la mezcla para que la canción respire, aparte de las
// notas: la intro se abre (filtro de graves que sube), antes de cada coro la cama se
// adelgaza (filtro de agudos que sube con el redoble) y en el coro vuelve entera, el
// break suena apagado, el outro se cierra, y en todo momento la cama "bombea" con el
// bombo (sidechain). Todo en pulsos de la canción, así sigue al tempo. Puro.

import { isBreak, type DrumSection } from './drums'
import { withDefaultMix } from './mixer'
import { createTrack, newId, type Clip, type Project, type SweepPoint, type Track } from './project'

/** Corte abierto (no se oye el filtro). */
const OPEN_LOW = 20000
const OPEN_HIGH = 20
/** La intro empieza con el paso bajo aquí y se abre a lo largo de la sección. */
const INTRO_HZ = 500
/** El break suena con este paso bajo. */
const BREAK_HZ = 1200
/** Hasta dónde sube el paso alto en la subida antes de un coro. */
const BUILD_HZ = 600
/** El outro se cierra hasta aquí en sus últimos compases. */
const OUTRO_HZ = 700
const BUILD_BARS = 2
const OUTRO_BARS = 4

/** Sidechain de la cama: cuánto baja con cada bombo y cuánto tarda en volver. */
export const DUCK_DB = 5
export const DUCK_RELEASE_SEC = 0.18

/**
 * Automatización de la pista de la cama según la estructura. `kicks`: pulsos donde suena
 * el bombo (vacío = sin sidechain).
 */
export function bedAutomation(
  sections: DrumSection[],
  beatsPerBar: number,
  kicks: number[]
): Pick<Track, 'sweeps' | 'duck'> {
  const sorted = [...sections].sort((a, b) => a.startBar - b.startBar)
  const low: SweepPoint[] = []
  const high: SweepPoint[] = []
  const beatOf = (bar: number): number => (bar - 1) * beatsPerBar
  const energy = (s: DrumSection | undefined): number => s?.energy ?? 3
  // Un punto en el mismo pulso que otro lo pisaría: el corte es "justo antes".
  const before = (beat: number): number => beat - 0.01

  sorted.forEach((s, i) => {
    const start = beatOf(s.startBar)
    const end = beatOf(s.startBar + s.bars)
    const next = sorted[i + 1]
    if (i === 0) low.push({ beat: start, hz: INTRO_HZ }, { beat: before(end), hz: OPEN_LOW })
    if (isBreak(s.name) && i > 0) {
      low.push(
        { beat: start, hz: OPEN_LOW },
        { beat: start + 0.25, hz: BREAK_HZ },
        { beat: before(end - BUILD_BARS * beatsPerBar), hz: BREAK_HZ },
        { beat: before(end), hz: OPEN_LOW }
      )
    }
    if (next && energy(next) >= energy(s) + 2 && s.bars >= BUILD_BARS + 2) {
      const from = end - BUILD_BARS * beatsPerBar
      high.push(
        { beat: from, hz: OPEN_HIGH },
        { beat: before(end), hz: BUILD_HZ },
        { beat: end, hz: OPEN_HIGH }
      )
    }
    if (!next && i > 0 && s.bars >= OUTRO_BARS) {
      low.push({ beat: end - OUTRO_BARS * beatsPerBar, hz: OPEN_LOW }, { beat: end, hz: OUTRO_HZ })
    }
  })
  return {
    sweeps: {
      ...(low.length > 0 && { lowpass: low }),
      ...(high.length > 0 && { highpass: high })
    },
    ...(kicks.length > 0 && {
      duck: { beats: kicks, depthDb: DUCK_DB, releaseSec: DUCK_RELEASE_SEC }
    })
  }
}

/**
 * Volumen de la pista de batería: sus golpes salen a −1 dB de pico, más fuertes que la
 * cama (normalizada al mismo pico pero mucho más densa), así que se bajan para que el
 * bombo mande sin tapar el resto.
 */
export const DRUMS_GAIN_DB = -6

/**
 * Pone (o rehace) la pista de batería con un clip por sección (`clips`, en el orden de
 * `sections`) y automatiza la cama (`bedTrackId`) con sidechain al bombo. Si ya había
 * batería, conserva su pista (volumen, mute…) y cambia solo sus regiones.
 */
export function withDrumTrack(
  p: Project,
  opts: {
    pattern: string
    intensity: number
    sections: DrumSection[]
    clips: Clip[]
    kicks: number[]
    bedTrackId: string | null
  }
): Project {
  const perBar = p.timeSignature[0]
  const old = p.tracks.find((t) => t.drums)
  const track: Track = {
    ...(old ?? { ...withDefaultMix(createTrack('Batería', 'drums')), gainDb: DRUMS_GAIN_DB }),
    drums: { pattern: opts.pattern, intensity: opts.intensity },
    regions: opts.sections.map((s, i) => ({
      id: newId('rgn'),
      clipId: opts.clips[i].id,
      startBeat: (s.startBar - 1) * perBar,
      offsetSec: 0,
      lengthSec: opts.clips[i].durationSec,
      fadeInSec: 0,
      fadeOutSec: 0
    }))
  }
  const auto = bedAutomation(opts.sections, perBar, opts.kicks)
  const tracks = p.tracks
    .filter((t) => t !== old)
    .map((t) => (t.id === opts.bedTrackId ? { ...t, ...auto } : t))
  return {
    ...p,
    clips: { ...p.clips, ...Object.fromEntries(opts.clips.map((c) => [c.id, c])) },
    tracks: [...tracks, track]
  }
}

/** Quita la batería programada y el sidechain de la cama (los filtros se quedan). */
export function withoutDrums(p: Project): Project {
  return {
    ...p,
    tracks: p.tracks.filter((t) => !t.drums).map((t) => (t.duck ? { ...t, duck: undefined } : t))
  }
}
