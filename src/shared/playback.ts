// Cuándo y qué parte del clip suena de una región, contando su pre-roll (leadInSec):
// el audio que entra en fundido justo antes de la región para que un tramo que
// continúa a otro se funda con su final en vez de empezar en seco. Puro para probarlo.

import { beatsToSeconds, type Region, type SweepPoint, type Track } from './project'

export interface RegionPlayback {
  /** Segundo de la canción en el que empieza a sonar (incluido el pre-roll). */
  startSec: number
  /** Segundo del clip desde el que se lee. */
  clipSec: number
  /** Segundos que suenan. */
  durationSec: number
  /** Fundido de entrada; 0 si se empieza a mitad (ya entró). */
  fadeInSec: number
  /** Segundos ya pasados al empezar a mitad (para colocar el fundido de salida). */
  skipSec: number
}

/** Lo que suena de `region` si se reproduce desde `fromSec`; null si ya terminó. */
export function regionPlayback(
  region: Region,
  bpm: number,
  fromSec: number
): RegionPlayback | null {
  const lead = Math.max(0, Math.min(region.leadInSec ?? 0, region.offsetSec))
  const startSec = beatsToSeconds(region.startBeat, bpm) - lead
  const total = lead + region.lengthSec
  if (startSec + total <= fromSec) return null
  const skipSec = Math.max(0, fromSec - startSec)
  return {
    startSec: Math.max(startSec, fromSec),
    clipSec: region.offsetSec - lead + skipSec,
    durationSec: total - skipSec,
    fadeInSec: skipSec > 0 ? 0 : lead > 0 ? lead : region.fadeInSec,
    skipSec
  }
}

/** Un cambio programado de un parámetro de audio (segundos desde que empieza a sonar). */
export interface ParamEvent {
  atSec: number
  value: number
  /** set = salto; linear / exp = rampa que llega a `value` en `atSec`. */
  kind: 'set' | 'linear' | 'exp'
}

/**
 * Eventos de un filtro automatizado reproduciendo desde `fromSec`: el valor que toca en
 * ese momento y las rampas (en curva, como se oye la frecuencia) hasta cada punto.
 */
export function sweepEvents(points: SweepPoint[], bpm: number, fromSec: number): ParamEvent[] {
  const timed = [...points]
    .sort((a, b) => a.beat - b.beat)
    .map((p) => ({ at: beatsToSeconds(p.beat, bpm) - fromSec, hz: Math.max(10, p.hz) }))
  if (timed.length === 0) return []
  const next = timed.findIndex((p) => p.at > 0)
  let start: number
  if (next === -1) start = timed[timed.length - 1].hz
  else if (next === 0) start = timed[0].hz
  else {
    const a = timed[next - 1]
    const b = timed[next]
    start = a.hz * Math.pow(b.hz / a.hz, -a.at / (b.at - a.at))
  }
  const events: ParamEvent[] = [{ atSec: 0, value: start, kind: 'set' }]
  for (const p of timed) if (p.at > 0) events.push({ atSec: p.at, value: p.hz, kind: 'exp' })
  return events
}

/** Lo que tarda en bajar el volumen con cada golpe (evita un clic). */
const DUCK_ATTACK_SEC = 0.005

/** Eventos de ganancia del sidechain de una pista reproduciendo desde `fromSec`. */
export function duckEvents(
  duck: NonNullable<Track['duck']>,
  bpm: number,
  fromSec: number
): ParamEvent[] {
  const low = Math.pow(10, -Math.abs(duck.depthDb) / 20)
  const events: ParamEvent[] = [{ atSec: 0, value: 1, kind: 'set' }]
  for (const beat of [...duck.beats].sort((a, b) => a - b)) {
    const at = beatsToSeconds(beat, bpm) - fromSec
    if (at < DUCK_ATTACK_SEC) continue
    events.push(
      { atSec: at - DUCK_ATTACK_SEC, value: 1, kind: 'set' },
      { atSec: at, value: low, kind: 'linear' },
      { atSec: at + duck.releaseSec, value: 1, kind: 'linear' }
    )
  }
  return events
}
