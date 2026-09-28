// "Conformar" el audio que devuelve un modelo para que encaje en el timeline:
//   1. recortar (o rellenar con silencio) a la duración musical exacta en compases
//   2. normalizar el pico a un nivel común, para que todas las pistas generadas
//      entren con un volumen parecido
//   3. fundidos muy cortos al inicio y al final, para evitar clics
// Trabaja con muestras en bruto, así se puede probar sin Web Audio.

export interface ConformOptions {
  targetSec: number
  sampleRate: number
  /** Pico objetivo en dBFS (por defecto -1 dB). */
  peakDb?: number
  /** Duración de los fundidos anti-clic en segundos (por defecto 10 ms). */
  fadeSec?: number
}

export function conformAudio(channels: Float32Array[], opts: ConformOptions): Float32Array[] {
  const { targetSec, sampleRate, peakDb = -1, fadeSec = 0.01 } = opts
  const length = Math.max(1, Math.round(targetSec * sampleRate))

  // 1. Recortar / rellenar
  const out = channels.map((ch) => {
    const buf = new Float32Array(length)
    buf.set(ch.subarray(0, Math.min(ch.length, length)))
    return buf
  })

  // 2. Normalizar pico (sin amplificar el silencio puro)
  let peak = 0
  for (const ch of out) for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]))
  if (peak > 1e-4) {
    const gain = Math.pow(10, peakDb / 20) / peak
    for (const ch of out) for (let i = 0; i < ch.length; i++) ch[i] *= gain
  }

  // 3. Fundidos lineales
  const fade = Math.min(Math.floor(fadeSec * sampleRate), Math.floor(length / 2))
  for (const ch of out) {
    for (let i = 0; i < fade; i++) {
      const g = i / fade
      ch[i] *= g
      ch[length - 1 - i] *= g
    }
  }
  return out
}
