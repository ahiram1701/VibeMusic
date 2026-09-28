// Cambio de duración sin cambiar el tono (time-stretch) con WSOLA
// (Waveform Similarity Overlap-Add):
//   1. se trocea la salida en ventanas de ~50 ms que se solapan a la mitad
//   2. para cada ventana se toma el trozo de la entrada que "toca" según la nueva
//      velocidad, pero se desplaza unos milisegundos hasta el punto donde la onda
//      encaja mejor con la ventana anterior (así no hay saltos de fase ni "chasquidos")
//   3. se suman las ventanas con un fundido (Hann)
// Funciona bien para loops y cambios de tempo moderados (±30 %).

export interface StretchOptions {
  /** Tamaño de ventana en segundos (por defecto 50 ms). */
  frameSec?: number
  /** Margen de búsqueda del mejor encaje en segundos (por defecto 12 ms). */
  searchSec?: number
}

/**
 * @param channels  audio de entrada (uno o más canales de igual longitud)
 * @param ratio     duración de salida / duración de entrada (1.25 = 25 % más largo)
 */
export function timeStretch(
  channels: Float32Array[],
  sampleRate: number,
  ratio: number,
  opts: StretchOptions = {}
): Float32Array[] {
  if (!(ratio > 0)) throw new Error('ratio debe ser > 0')
  const inLen = channels[0]?.length ?? 0
  const outLen = Math.max(1, Math.round(inLen * ratio))
  if (Math.abs(ratio - 1) < 1e-4 || inLen === 0) {
    return channels.map((ch) => {
      const out = new Float32Array(outLen)
      out.set(ch.subarray(0, outLen))
      return out
    })
  }

  const frame = Math.max(64, 2 * Math.round(((opts.frameSec ?? 0.05) * sampleRate) / 2))
  const hop = frame / 2 // salto de síntesis (salida)
  const analysisHop = hop / ratio // salto de análisis (entrada)
  const search = Math.round((opts.searchSec ?? 0.012) * sampleRate)
  const window = hann(frame)

  // Mezcla mono para decidir los desplazamientos; se aplican igual a todos los
  // canales para que el estéreo no se desalinee.
  const mono = new Float32Array(inLen)
  for (const ch of channels) for (let i = 0; i < inLen; i++) mono[i] += ch[i] / channels.length
  const at = (i: number): number => (i >= 0 && i < inLen ? mono[i] : 0)

  const out = channels.map(() => new Float32Array(outLen + frame))
  const norm = new Float32Array(outLen + frame)
  let prevPos = 0

  for (let k = 0; k * hop < outLen; k++) {
    const nominal = Math.round(k * analysisHop)
    let best = nominal
    if (k > 0) {
      // Lo que "debería" seguir a la ventana anterior si no hubiera cambio de velocidad.
      const target = prevPos + hop
      best = bestOffset(at, target, nominal, search, hop)
    }
    const outPos = k * hop
    for (let c = 0; c < channels.length; c++) {
      const src = channels[c]
      const dst = out[c]
      for (let i = 0; i < frame; i++) {
        const j = best + i
        if (j >= 0 && j < inLen) dst[outPos + i] += src[j] * window[i]
      }
    }
    for (let i = 0; i < frame; i++) norm[outPos + i] += window[i]
    prevPos = best
  }

  return out.map((ch) => {
    const result = new Float32Array(outLen)
    for (let i = 0; i < outLen; i++) result[i] = norm[i] > 1e-3 ? ch[i] / norm[i] : 0
    return result
  })
}

/**
 * Desplazamiento (dentro de ±search alrededor de `nominal`) cuya forma de onda más se
 * parece a la de `target`. Primero busca con paso grueso y luego afina, para que sea
 * rápido incluso con clips largos.
 */
function bestOffset(
  at: (i: number) => number,
  target: number,
  nominal: number,
  search: number,
  length: number
): number {
  const correlate = (start: number, step: number): number => {
    let sum = 0
    for (let i = 0; i < length; i += step) sum += at(start + i) * at(target + i)
    return sum
  }
  const coarse = 4
  let best = nominal
  let bestScore = -Infinity
  for (let d = -search; d <= search; d += coarse) {
    const score = correlate(nominal + d, coarse)
    if (score > bestScore) {
      bestScore = score
      best = nominal + d
    }
  }
  const center = best
  bestScore = -Infinity
  for (let d = -coarse; d <= coarse; d++) {
    const score = correlate(center + d, 2)
    if (score > bestScore) {
      bestScore = score
      best = center + d
    }
  }
  return best
}

function hann(n: number): Float32Array {
  const w = new Float32Array(n)
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n)
  return w
}
