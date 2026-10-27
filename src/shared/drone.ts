// Detección de "colapso" en el audio de MusicGen. Al continuar audio, el modelo a
// veces se queda atascado en un tono grave sostenido (o en silencio) y, como cada
// tramo escucha al anterior, el atasco se contagia al resto de la canción. Se detecta
// sin IA: por cada segundo se mide el volumen y cuánta energía hay por encima de
// 1 kHz. Una canción normal siempre tiene algo arriba (platillos, ataques, voces);
// un drone casi nada. Calibrado con tramos reales: los sanos quedan entre −3 y
// −28 dB de agudos, los atascados entre −35 y −60. Todo es puro para probarlo.

/** Medidas de un segundo de audio. */
export interface WindowStats {
  /** Volumen RMS en dBFS. */
  db: number
  /** Energía por encima de ~1 kHz respecto al total, en dB (0 = todo es agudo). */
  highDb: number
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
  /** Segundos finales que no se miran (p. ej. el fundido del último tramo). */
  ignoreTailSec?: number
}

const DEFAULTS: Required<CollapseOptions> = {
  minRunSec: 4,
  minTailSec: 2,
  silenceDb: -45,
  highDbMin: -32,
  ignoreTailSec: 0
}

/** Frecuencia de corte del filtro que separa los agudos (tres polos: corte claro). */
const SPLIT_HZ = 1000
const POLES = 3

/** Volumen y nivel de agudos de cada segundo completo del audio. */
export function windowStats(samples: Float32Array, sampleRate: number): WindowStats[] {
  const win = Math.max(1, Math.round(sampleRate))
  const rc = 1 / (2 * Math.PI * SPLIT_HZ)
  const alpha = rc / (rc + 1 / sampleRate)
  const prevX = new Float64Array(POLES)
  const prevY = new Float64Array(POLES)
  const out: WindowStats[] = []
  for (let start = 0; start + win <= samples.length; start += win) {
    let total = 0
    let high = 0
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
    }
    out.push({
      db: 10 * Math.log10(total / win + 1e-24),
      highDb: total > 0 ? 10 * Math.log10(high / total + 1e-12) : -120
    })
  }
  return out
}

/** ¿Es este segundo parte de un colapso (silencio, o suena pero sin agudos)? */
export function isDead(w: WindowStats, opts: CollapseOptions = {}): boolean {
  const o = { ...DEFAULTS, ...opts }
  return w.db < o.silenceDb || w.highDb < o.highDbMin
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
  let runStart = -1
  for (let i = 0; i < usable; i++) {
    if (!isDead(stats[i], o)) {
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

/**
 * Brillo de los últimos `tailSec` segundos: la mediana del nivel de agudos (dB respecto
 * al total) de los segundos que suenan, o null si todo es silencio. Al continuar, cada
 * tramo de MusicGen sale algo más apagado que el que escucha (en una canción real se
 * midió −13 → −19 → −27 → −33 → −40), y ese final es lo que oye el siguiente.
 */
export function tailBrightness(
  samples: Float32Array,
  sampleRate: number,
  tailSec: number,
  silenceDb = DEFAULTS.silenceDb
): number | null {
  const stats = windowStats(samples, sampleRate)
  const tail = stats
    .slice(Math.max(0, stats.length - Math.ceil(tailSec)))
    .filter((w) => w.db >= silenceDb)
    .map((w) => w.highDb)
    .sort((a, b) => a - b)
  return tail.length > 0 ? tail[Math.floor(tail.length / 2)] : null
}
