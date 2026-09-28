import { encodeWav } from '@shared/wav'

/** Frecuencia de los fragmentos de partida (la nativa de MusicGen). */
export const EXCERPT_SAMPLE_RATE = 32000
/** Duración máxima del fragmento: MusicGen no usa más contexto y así pesa < 1 MB. */
export const MAX_EXCERPT_SEC = 8

/**
 * Extrae [startSec, endSec) de un buffer como WAV mono a 32 kHz. Es el "audio de
 * partida" que se envía al motor para que continúe desde ahí.
 * Usa OfflineAudioContext, que remuestrea y mezcla a mono por nosotros.
 */
export async function makeExcerpt(
  buffer: AudioBuffer,
  startSec: number,
  endSec: number
): Promise<{ wav: Uint8Array; seconds: number }> {
  const seconds = Math.max(0.1, endSec - startSec)
  const ctx = new OfflineAudioContext(
    1,
    Math.ceil(seconds * EXCERPT_SAMPLE_RATE),
    EXCERPT_SAMPLE_RATE
  )
  const src = ctx.createBufferSource()
  src.buffer = buffer
  src.connect(ctx.destination)
  src.start(0, startSec, seconds)
  const rendered = await ctx.startRendering()
  return { wav: encodeWav([rendered.getChannelData(0)], EXCERPT_SAMPLE_RATE), seconds }
}
