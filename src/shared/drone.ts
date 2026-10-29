// Detección de "colapso" en el audio de MusicGen. Al continuar audio, el modelo a
// veces se queda atascado en un tono grave sostenido (o en silencio) y, como cada
// tramo escucha al anterior, el atasco se contagia al resto de la canción. Se detecta
// sin IA: por cada segundo se mide el volumen y cuánta energía hay por encima de
// 1 kHz. Una canción normal siempre tiene algo arriba (platillos, ataques, voces);
// un drone casi nada. Calibrado con tramos reales: los sanos quedan entre −3 y
// −28 dB de agudos, los atascados entre −35 y −60. El colapso opuesto es un siseo
// estático (todo agudos, sin ritmo): ahí falla el "pulso", cuánto varía el volumen
// dentro del segundo; con bombo y percusión nunca baja de ~1,7 dB, el siseo da 0,1-0,5.
// El tercero es que la música se vacía: se van el bombo y el bajo y queda un hilo
// bajito de platillos (por debajo de −25 dB y con casi todo en agudos); la música sana
// suena entre −13 y −23 dB con los agudos entre −12 y −18.
// Todo es puro para probarlo.

/** Medidas de un segundo de audio. */
export interface WindowStats {
  /** Volumen RMS en dBFS. */
  db: number
  /** Energía por encima de ~1 kHz respecto al total, en dB (0 = todo es agudo). */
  highDb: number
  /** Pulso: desviación típica (dB) del volumen en trozos de 50 ms; ~0 = sonido estático. */
  pulseDb: number
}

export interface CollapseOptions {
  /** Segundos seguidos de drone o silencio para considerarlo colapso. */
  minRunSec?: number
  /** Una racha que llega hasta el final cuenta ya con estos segundos (se contagia). */
  minTailSec?: number
  /** Por debajo de este volumen (dBFS) se considera silencio. */
  silenceDb?: number
  /** Por debajo de este nivel de agudos (dB respecto al total), un segundo es drone. */
  highDbMin?: number
  /** Por debajo de este pulso (dB), un segundo que suena es estático (siseo sin ritmo). */
  pulseMin?: number
  /** Un segundo más bajo que esto (dBFS) y con más agudos que `thinHighDb` está vacío. */
  thinDb?: number
  /** Nivel de agudos (dB respecto al total) a partir del cual un segundo bajito está vacío. */
  thinHighDb?: number
  /** Segundos finales que no se miran (p. ej. el fundido del último tramo). */
  ignoreTailSec?: number
  /**
   * Un segundo así de por debajo (dB) del volumen con que empezó el tramo está apagado:
   * la música se fue vaciando aunque aún suene (test10: un coro de −20 a −33 dB, y los
   * tres tramos que lo continuaban nacieron vacíos).
   */
  fadeDb?: number
}

const DEFAULTS: Required<CollapseOptions> = {
  minRunSec: 4,
  minTailSec: 2,
  silenceDb: -45,
  highDbMin: -32,
  pulseMin: 1,
  thinDb: -25,
  thinHighDb: -10,
  ignoreTailSec: 0,
  fadeDb: 9
}

/** Segundos del principio con que se mide el volumen de partida para `fadeDb`. */
const FADE_REF_SEC = 2

/** Frecuencia de corte del filtro que separa los agudos (tres polos: corte claro). */
const SPLIT_HZ = 1000
const POLES = 3
/** Trozo con el que se mide el pulso: más corto que un golpe de bombo a 130 BPM. */
const PULSE_SEC = 0.05

/** Desviación típica de una lista de dB. */
function spread(values: number[]): number {
  if (values.length < 2) return 0
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  return Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length)
}

/** Volumen y nivel de agudos de cada ventana completa (1 s por defecto) del audio. */
export function windowStats(
  samples: Float32Array,
  sampleRate: number,
  windowSec = 1
): WindowStats[] {
  const win = Math.max(1, Math.round(sampleRate * windowSec))
  const rc = 1 / (2 * Math.PI * SPLIT_HZ)
  const alpha = rc / (rc + 1 / sampleRate)
  const prevX = new Float64Array(POLES)
  const prevY = new Float64Array(POLES)
  const piece = Math.max(1, Math.round(sampleRate * PULSE_SEC))
  const out: WindowStats[] = []
  for (let start = 0; start + win <= samples.length; start += win) {
    let total = 0
    let high = 0
    let pieceSum = 0
    const pieces: number[] = []
    for (let i = start; i < start + win; i++) {
      const x = samples[i]
      let y = x
      for (let p = 0; p < POLES; p++) {
        const v = alpha * (prevY[p] + y - prevX[p])
        prevX[p] = y
        prevY[p] = v
        y = v
      }
      total += x * x
      high += y * y
      pieceSum += x * x
      if ((i - start + 1) % piece === 0) {
        pieces.push(10 * Math.log10(pieceSum / piece + 1e-10))
        pieceSum = 0
      }
    }
    out.push({
      db: 10 * Math.log10(total / win + 1e-24),
      highDb: total > 0 ? 10 * Math.log10(high / total + 1e-12) : -120,
      pulseDb: spread(pieces)
    })
  }
  return out
}

/** ¿Es este segundo parte de un colapso (silencio, drone, siseo estático o vacío)? */
export function isDead(w: WindowStats, opts: CollapseOptions = {}): boolean {
  const o = { ...DEFAULTS, ...opts }
  return (
    w.db < o.silenceDb ||
    w.highDb < o.highDbMin ||
    w.pulseDb < o.pulseMin ||
    (w.db < o.thinDb && w.highDb > o.thinHighDb)
  )
}

/**
 * Segundo en el que empieza el primer colapso del audio, o null si no hay. Cuenta una
 * racha de `minRunSec` segundos muertos seguidos, o una más corta (`minTailSec`) si
 * llega al final: el tramo siguiente escucharía ese final y nacería atascado.
 */
export function findCollapse(
  samples: Float32Array,
  sampleRate: number,
  opts: CollapseOptions = {}
): number | null {
  const o = { ...DEFAULTS, ...opts }
  const stats = windowStats(samples, sampleRate)
  const usable = Math.max(0, stats.length - Math.ceil(o.ignoreTailSec))
  const start = stats.slice(0, FADE_REF_SEC)
  const faded = start.length > 0 ? powerMean(start).db - o.fadeDb : Number.NEGATIVE_INFINITY
  let runStart = -1
  for (let i = 0; i < usable; i++) {
    if (!isDead(stats[i], o) && stats[i].db >= faded) {
      runStart = -1
      continue
    }
    if (runStart < 0) runStart = i
    if (i - runStart + 1 >= o.minRunSec) return runStart
  }
  return runStart >= 0 && usable - runStart >= o.minTailSec ? runStart : null
}

/** Mezcla a mono los canales de un audio (para analizarlo). */
export function toMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0]
  const out = new Float32Array(channels[0].length)
  for (const ch of channels) for (let i = 0; i < out.length; i++) out[i] += ch[i] / channels.length
  return out
}

/** Ventana de los bordes (para ver un hueco al empezar, cuarto a cuarto). */
const EDGE_SEC = 0.25
/**
 * Cuartos de segundo que se promedian en cada borde para comparar una unión: uno solo
 * cae a veces en el silencio entre dos golpes y marca un salto de 8 dB que no se oye
 * (test7: medido con un segundo, ese salto eran 2 dB).
 */
const EDGE_PARTS = 4

/** Media en potencia de varias medidas. */
function powerMean(stats: WindowStats[]): WindowStats {
  let power = 0
  let high = 0
  let pulse = 0
  for (const s of stats) {
    const p = Math.pow(10, s.db / 10)
    power += p
    high += p * Math.pow(10, s.highDb / 10)
    pulse += s.pulseDb
  }
  return {
    db: 10 * Math.log10(power / stats.length + 1e-24),
    highDb: 10 * Math.log10(high / (power + 1e-24) + 1e-12),
    pulseDb: pulse / stats.length
  }
}

/** Resumen de un audio para revisar la canción (ver soundSummary). */
export interface SoundSummary {
  head: WindowStats
  tail: WindowStats
  mean: WindowStats
  /** Racha más larga de segundos estáticos (suena, pero sin pulso), o null. */
  staticRun: { startSec: number; sec: number } | null
  /** Volumen (dBFS) de los primeros cuartos de segundo, para ver un hueco al empezar. */
  opening: number[]
}

/** Cuartos de segundo del principio que mira `hasStartGap` (1,5 s). */
const OPENING_PARTS = 6

/**
 * ¿Arranca con un hueco? Al menos 1 s de los primeros 1,5 s suena más de `dropDb` por
 * debajo del final del tramo anterior (`prevTailDb`): tras el fundido, el modelo se
 * calló y la unión se oye como un corte.
 */
export function hasStartGap(opening: number[], prevTailDb: number, dropDb = 10): boolean {
  return opening.filter((db) => db < prevTailDb - dropDb).length >= 4
}

/**
 * Primer y último segundo de un audio (lo que se oye en sus uniones), su
 * media en potencia y la racha más larga de sonido estático, o null si dura < 1 s.
 */
export function soundSummary(samples: Float32Array, sampleRate: number): SoundSummary | null {
  const stats = windowStats(samples, sampleRate)
  if (stats.length === 0) return null
  let staticRun: SoundSummary['staticRun'] = null
  let run = 0
  stats.forEach((s, i) => {
    run = s.db >= DEFAULTS.silenceDb && s.pulseDb < DEFAULTS.pulseMin ? run + 1 : 0
    if (run > (staticRun?.sec ?? 0)) staticRun = { startSec: i - run + 1, sec: run }
  })
  const edge = windowStats(samples, sampleRate, EDGE_SEC)
  return {
    head: powerMean(edge.slice(0, EDGE_PARTS)),
    tail: powerMean(edge.slice(-EDGE_PARTS)),
    mean: powerMean(stats),
    staticRun,
    opening: edge.slice(0, OPENING_PARTS).map((w) => w.db)
  }
}
