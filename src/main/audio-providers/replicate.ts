import { writeFile } from 'node:fs/promises'
import { buildMusicPrompt, requestSeconds } from '@shared/prompt'
import { CancelledError, sleep, throwIfAborted, type AudioProvider } from './types'

// Proveedor en la nube: MusicGen (Meta) alojado en Replicate.
// API: https://replicate.com/docs/reference/http
//   POST /v1/predictions            crea la predicción
//   GET  /v1/predictions/{id}       consulta el estado (starting → processing → succeeded/failed)
//   POST /v1/predictions/{id}/cancel

const API = 'https://api.replicate.com/v1'
/** meta/musicgen (cog-musicgen 22.04). Fijado para que el resultado no cambie sin avisar. */
export const MUSICGEN_VERSION = '671ac645ce5e552cc63a54a2bbff63fcf798043055d2dac5fc9e36a837eedcfb'
const MAX_SEC = 30
const POLL_MS = 1500

interface Prediction {
  id: string
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled'
  output: string | string[] | null
  error: string | null
  logs: string | null
}

type Fetch = typeof fetch

export class ReplicateError extends Error {}

/** Convierte respuestas HTTP de error en mensajes útiles para el usuario. */
async function explain(res: Response): Promise<ReplicateError> {
  let detail = ''
  try {
    const body = (await res.json()) as { detail?: string; title?: string }
    detail = body.detail ?? body.title ?? ''
  } catch {
    // cuerpo no JSON
  }
  const known: Record<number, string> = {
    401: 'La API key de Replicate no es válida. Revísala en Ajustes.',
    402: 'Tu cuenta de Replicate no tiene crédito o método de pago.',
    429: 'Demasiadas peticiones a Replicate. Espera un momento y reinténtalo.'
  }
  return new ReplicateError(
    known[res.status] ?? `Replicate respondió ${res.status}. ${detail}`.trim()
  )
}

/** Último porcentaje de las barras de progreso (tqdm) que imprime MusicGen en los logs. */
export function progressFromLogs(logs: string | null): number | null {
  if (!logs) return null
  const matches = [...logs.matchAll(/(\d{1,3})%\|/g)]
  const last = matches.at(-1)
  return last ? Math.min(1, Number(last[1]) / 100) : null
}

export function createReplicateProvider(
  getToken: () => Promise<string | null>,
  fetchImpl: Fetch = fetch,
  pollMs = POLL_MS
): AudioProvider {
  const call = async (token: string, path: string, init: RequestInit = {}): Promise<Response> => {
    const res = await fetchImpl(`${API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...init.headers
      }
    })
    if (!res.ok) throw await explain(res)
    return res
  }

  return {
    id: 'replicate',
    label: 'Replicate · MusicGen',
    description: 'MusicGen de Meta en la nube. Requiere API key de Replicate (de pago por uso).',
    capabilities: {
      maxDurationSec: MAX_SEC,
      supportsSeed: true,
      supportsContinue: true,
      supportsMelody: true
    },

    async status() {
      return (await getToken())
        ? { ready: true }
        : { ready: false, reason: 'Falta la API key de Replicate (Ajustes)' }
    },

    async generate(spec, ctx) {
      const token = await getToken()
      if (!token) throw new ReplicateError('Falta la API key de Replicate. Añádela en Ajustes.')

      ctx.onProgress(null, 'Enviando a Replicate…')
      const input: Record<string, unknown> = {
        model_version: 'stereo-large',
        prompt: buildMusicPrompt(spec),
        duration: requestSeconds(spec.durationSec, MAX_SEC),
        output_format: 'wav',
        normalization_strategy: 'peak'
      }
      if (spec.seed !== undefined) input.seed = spec.seed

      let pred = (await (
        await call(token, '/predictions', {
          method: 'POST',
          body: JSON.stringify({ version: MUSICGEN_VERSION, input })
        })
      ).json()) as Prediction

      const cancelRemote = (): void => {
        // Si el usuario cancela, también paramos la predicción en Replicate (no se cobra más).
        call(token, `/predictions/${pred.id}/cancel`, { method: 'POST' }).catch(() => undefined)
      }
      ctx.signal.addEventListener('abort', cancelRemote, { once: true })

      try {
        while (pred.status === 'starting' || pred.status === 'processing') {
          ctx.onProgress(
            progressFromLogs(pred.logs),
            pred.status === 'starting'
              ? 'Arrancando el modelo (la primera vez puede tardar ~1 min)…'
              : 'Generando…'
          )
          await sleep(pollMs, ctx.signal)
          pred = (await (await call(token, `/predictions/${pred.id}`)).json()) as Prediction
        }
        if (pred.status === 'canceled') throw new CancelledError()
        if (pred.status === 'failed') {
          throw new ReplicateError(`El modelo falló: ${pred.error ?? 'error desconocido'}`)
        }

        const url = Array.isArray(pred.output) ? pred.output[0] : pred.output
        if (!url) throw new ReplicateError('Replicate no devolvió audio.')
        ctx.onProgress(1, 'Descargando…')
        const audio = await fetchImpl(url, { signal: ctx.signal })
        if (!audio.ok) throw new ReplicateError(`No se pudo descargar el audio (${audio.status}).`)
        throwIfAborted(ctx.signal)
        const path = `${ctx.outBase}.wav`
        await writeFile(path, new Uint8Array(await audio.arrayBuffer()))
        return path
      } finally {
        ctx.signal.removeEventListener('abort', cancelRemote)
      }
    }
  }
}

/** Comprueba un token contra GET /v1/account. Devuelve el usuario o lanza un error explicado. */
export async function verifyReplicateToken(
  token: string,
  fetchImpl: Fetch = fetch
): Promise<string> {
  const res = await fetchImpl(`${API}/account`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw await explain(res)
  const body = (await res.json()) as { username?: string }
  return body.username ?? 'desconocido'
}
