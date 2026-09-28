/// <reference lib="webworker" />
import { encodeMp3, type Mp3Bitrate } from '@shared/mp3'

// Hilo aparte para codificar MP3: una canción de varios minutos tarda segundos y,
// en el hilo principal, congelaría la interfaz (y la reproducción).

export interface Mp3Request {
  channels: Float32Array[]
  sampleRate: number
  kbps: Mp3Bitrate
}

export type Mp3Message =
  | { type: 'progress'; fraction: number }
  | { type: 'done'; mp3: Uint8Array }
  | { type: 'error'; message: string }

self.onmessage = (e: MessageEvent<Mp3Request>) => {
  try {
    const { channels, sampleRate, kbps } = e.data
    const mp3 = encodeMp3(channels, sampleRate, kbps, (fraction) =>
      self.postMessage({ type: 'progress', fraction } satisfies Mp3Message)
    )
    self.postMessage({ type: 'done', mp3 } satisfies Mp3Message, [mp3.buffer])
  } catch (err) {
    self.postMessage({ type: 'error', message: (err as Error).message } satisfies Mp3Message)
  }
}
