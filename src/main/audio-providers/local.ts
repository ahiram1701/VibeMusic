import { writeFile } from 'node:fs/promises'
import type { LocalEngineStatus } from '@shared/local-engine'
import { buildMusicPrompt } from '@shared/prompt'
import { CancelledError, sleep, throwIfAborted, type AudioProvider } from './types'

// Proveedor "Local": genera en este equipo a través del sidecar Python (MusicGen).
// Arranca el servidor la primera vez que se usa y le envía trabajos por HTTP.

export interface LocalEngineHost {
  status(): Promise<LocalEngineStatus>
  ensureRunning(): Promise<void>
  readonly baseUrl: string
}

interface RemoteJob {
  id: string
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled'
  progress: number | null
  stage: string
  error: string | null
}

const MAX_SEC = 30

export function createLocalProvider(
  engine: LocalEngineHost,
  getModel: () => Promise<string>,
  fetchImpl: typeof fetch = fetch,
  pollMs = 700
): AudioProvider {
  const call = async (path: string, init?: RequestInit): Promise<Response> => {
    const res = await fetchImpl(`${engine.baseUrl}${path}`, init)
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { detail?: unknown }
      const detail =
        typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail ?? '')
      throw new Error(`El motor local respondió ${res.status}: ${detail}`)
    }
    return res
  }

  return {
    id: 'local',
    label: 'Local · MusicGen (tu equipo)',
    description:
      'Genera en tu propio equipo: gratis, privado y sin internet. Con GPU NVIDIA es rápido; solo con CPU tarda varios minutos por clip.',
    capabilities: {
      maxDurationSec: MAX_SEC,
      supportsSeed: true,
      supportsContinue: false,
      supportsMelody: false
    },

    async status() {
      const s = await engine.status()
      if (s.state === 'not-installed')
        return { ready: false, reason: 'El motor local no está instalado (Ajustes)' }
      if (s.state === 'installing')
        return { ready: false, reason: 'El motor local se está instalando' }
      if (s.state === 'checking') return { ready: false, reason: 'Comprobando el motor local' }
      // stopped / starting / running / error: se (re)intenta arrancar al generar.
      return { ready: true }
    },

    async generate(spec, ctx) {
      ctx.onProgress(null, 'Arrancando el motor local…')
      await engine.ensureRunning()
      throwIfAborted(ctx.signal)

      let job = (await (
        await call('/jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: buildMusicPrompt(spec),
            seconds: Math.min(MAX_SEC, Math.ceil(spec.durationSec * 10) / 10),
            seed: spec.seed === undefined ? null : spec.seed % 2 ** 31,
            model: await getModel()
          })
        })
      ).json()) as RemoteJob

      const cancelRemote = (): void => {
        call(`/jobs/${job.id}`, { method: 'DELETE' }).catch(() => undefined)
      }
      ctx.signal.addEventListener('abort', cancelRemote, { once: true })
      try {
        while (job.status === 'queued' || job.status === 'running') {
          ctx.onProgress(
            job.progress,
            job.status === 'queued' ? 'En cola en el motor local' : job.stage
          )
          await sleep(pollMs, ctx.signal)
          job = (await (await call(`/jobs/${job.id}`)).json()) as RemoteJob
        }
        if (job.status === 'cancelled') throw new CancelledError()
        if (job.status === 'error')
          throw new Error(`El motor local falló: ${job.error ?? 'error desconocido'}`)

        ctx.onProgress(1, 'Recibiendo audio…')
        const audio = await call(`/jobs/${job.id}/audio`)
        const path = `${ctx.outBase}.wav`
        await writeFile(path, new Uint8Array(await audio.arrayBuffer()))
        return path
      } finally {
        ctx.signal.removeEventListener('abort', cancelRemote)
      }
    }
  }
}
