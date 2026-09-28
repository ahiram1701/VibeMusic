import { Mp3Encoder } from '@breezystack/lamejs'

// Codificación MP3 con LAME (vía @breezystack/lamejs, licencia LGPL-3.0).
// En la app se ejecuta dentro de un Web Worker (audio/mp3.worker.ts) para no
// congelar la interfaz; aquí está la lógica pura, testeable en Node.

export const MP3_BITRATES = [128, 192, 320] as const
export type Mp3Bitrate = (typeof MP3_BITRATES)[number]

/** Frecuencias que admite MP3 (MPEG-1/2/2.5). */
const MP3_RATES = [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000]

/** LAME trabaja en bloques de 1152 muestras por canal. */
const BLOCK = 1152

function toInt16(src: Float32Array, from: number, to: number): Int16Array {
  const out = new Int16Array(to - from)
  for (let i = from; i < to; i++) {
    const s = Math.max(-1, Math.min(1, src[i]))
    out[i - from] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out
}

/**
 * Codifica audio (1 o 2 canales, float en [-1, 1]) a MP3.
 * `onProgress` recibe la fracción 0..1 cada cierto número de bloques.
 */
export function encodeMp3(
  channels: Float32Array[],
  sampleRate: number,
  kbps: Mp3Bitrate,
  onProgress?: (fraction: number) => void
): Uint8Array {
  if (!MP3_RATES.includes(sampleRate)) {
    throw new Error(`MP3 no admite ${sampleRate} Hz`)
  }
  const stereo = channels.length >= 2
  const left = channels[0]
  const right = stereo ? channels[1] : undefined
  const encoder = new Mp3Encoder(stereo ? 2 : 1, sampleRate, kbps)
  const parts: Uint8Array[] = []
  const total = left.length

  for (let i = 0, n = 0; i < total; i += BLOCK, n++) {
    const end = Math.min(total, i + BLOCK)
    const chunk = right
      ? encoder.encodeBuffer(toInt16(left, i, end), toInt16(right, i, end))
      : encoder.encodeBuffer(toInt16(left, i, end))
    if (chunk.length > 0) parts.push(chunk.slice())
    if (onProgress && n % 200 === 0) onProgress(end / total)
  }
  const tail = encoder.flush()
  if (tail.length > 0) parts.push(tail.slice())
  onProgress?.(1)

  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0))
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}
