import { contextLift, CONTEXT_SEC } from '@shared/arrange'
import { powerMean, windowStats } from '@shared/drone'
import { BRIGHT_SHELF_HZ } from '@shared/mixer'
import { encodeWav } from '@shared/wav'

/** Frecuencia de los fragmentos de partida (la nativa de MusicGen). */
export const EXCERPT_SAMPLE_RATE = 32000
/**
 * Duración máxima del fragmento: MusicGen no usa más contexto y así pesa < 1 MB. El
 * productor cuenta con ella para calcular cuánto cabe en cada tramo.
 */
export const MAX_EXCERPT_SEC = CONTEXT_SEC

async function render(
  buffer: AudioBuffer,
  startSec: number,
  seconds: number,
  brightDb: number
): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(
    1,
    Math.ceil(seconds * EXCERPT_SAMPLE_RATE),
    EXCERPT_SAMPLE_RATE
  )
  const src = ctx.createBufferSource()
  src.buffer = buffer
  if (brightDb > 0) {
    const shelf = ctx.createBiquadFilter()
    shelf.type = 'highshelf'
    shelf.frequency.value = BRIGHT_SHELF_HZ
    shelf.gain.value = brightDb
    src.connect(shelf).connect(ctx.destination)
  } else {
    src.connect(ctx.destination)
  }
  src.start(0, startSec, seconds)
  return (await ctx.startRendering()).getChannelData(0)
}

/**
 * Extrae [startSec, endSec) de un buffer como WAV mono a 32 kHz. Es el "audio de
 * partida" que se envía al motor para que continúe desde ahí.
 * Usa OfflineAudioContext, que remuestrea y mezcla a mono por nosotros. Con
 * `brightenTo` (agudos de referencia, ver contextLift), si la partida ha perdido
 * agudos se realza: el modelo la imita y si no saldría aún más apagado.
 */
export async function makeExcerpt(
  buffer: AudioBuffer,
  startSec: number,
  endSec: number,
  brightenTo?: number
): Promise<{ wav: Uint8Array; seconds: number; brightDb: number }> {
  const seconds = Math.max(0.1, endSec - startSec)
  let data = await render(buffer, startSec, seconds, 0)
  let brightDb = 0
  if (brightenTo !== undefined) {
    const stats = windowStats(data, EXCERPT_SAMPLE_RATE)
    if (stats.length > 0) brightDb = contextLift(brightenTo, powerMean(stats).highDb)
    if (brightDb > 0) data = await render(buffer, startSec, seconds, brightDb)
  }
  return { wav: encodeWav([data], EXCERPT_SAMPLE_RATE), seconds, brightDb }
}
