// Cuándo y qué parte del clip suena de una región, contando su pre-roll (leadInSec):
// el audio que entra en fundido justo antes de la región para que un tramo que
// continúa a otro se funda con su final en vez de empezar en seco. Puro para probarlo.

import { beatsToSeconds, type Region } from './project'

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
