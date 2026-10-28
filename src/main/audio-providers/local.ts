import { readFile, writeFile } from 'node:fs/promises'
import type { LocalEngineStatus } from '@shared/local-engine'
import { buildMusicPrompt } from '@shared/prompt'
import type { GenerationSpec } from '@shared/project'
import { CancelledError, sleep, StallWatch, throwIfAborted, type AudioProvider } from './types'

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
  /** Segundos de la partida devueltos delante del audio nuevo (si se pidieron). */
  lead_in_sec?: number
}

const MAX_SEC = 30

/**
 * Segundos que se piden: la duración más el margen para alinear al pulso, sin pasar
 * del máximo del motor contando el audio de partida (nunca menos que la duración).
 */
export function requestedSeconds(spec: GenerationSpec): number {
  const room = MAX_SEC - (spec.conditioning?.seconds ?? 0)
  const wanted = Math.min(room, spec.durationSec + (spec.marginSec ?? 0))
  return Math.min(MAX_SEC, Math.ceil(Math.max(spec.durationSec, wanted) * 10) / 10)
}

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
      supportsContinue: true,
      supportsMelody: false,
      supportsLyrics: false
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
            seconds: requestedSeconds(spec),
            seed: spec.seed === undefined ? null : spec.seed % 2 ** 31,
            model: await getModel(),
            // Continuar: el servidor recibe el fragmento de partida y devuelve lo nuevo,
            // con delante el final de la partida si se pide para fundir.
            audio_b64:
              spec.conditioning && ctx.conditioningPath
                ? (await readFile(ctx.conditioningPath)).toString('base64')
                : null,
            ...(spec.conditioning && spec.crossfadeSec && { keep_lead_sec: spec.crossfadeSec })
          })
        })
      ).json()) as RemoteJob

      const cancelRemote = (): void => {
        call(`/jobs/${job.id}`, { method: 'DELETE' }).catch(() => undefined)
      }
      ctx.signal.addEventListener('abort', cancelRemote, { once: true })
      try {
        const watch = new StallWatch()
        while (job.status === 'queued' || job.status === 'running') {
          try {
            watch.check(job.status, job.progress, job.stage)
          } catch (err) {
            cancelRemote() // que el motor no siga ocupado con un trabajo abandonado
            throw err
          }
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
        return { path, ...(job.lead_in_sec && { leadInSec: job.lead_in_sec }) }
      } finally {
        ctx.signal.removeEventListener('abort', cancelRemote)
      }
    }
  }
}
