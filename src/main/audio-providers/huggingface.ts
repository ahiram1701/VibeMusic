import { writeFile } from 'node:fs/promises'
import { buildMusicPrompt, requestSeconds } from '@shared/prompt'
import { CancelledError, throwIfAborted, type AudioProvider } from './types'

// Proveedor "Hugging Face · ACE-Step": canciones completas CON VOZ que cantan la
// letra, generadas en el Space público de ACE-Step 1.5 con la GPU gratuita de
// Hugging Face (ZeroGPU). Se habla con él a través de su API de Gradio.
// La cuota gratuita es diaria y por usuario: con token dura más que sin él.

/** Space oficial de ACE-Step 1.5 y su función de generación. */
export const ACE_STEP_SPACE = 'ACE-Step/Ace-Step-v1.5'
export const ACE_STEP_ENDPOINT = '/generation_wrapper'
const ACE_STEP_MODEL = 'acestep-v15-xl-turbo'
/** ACE-Step genera canciones de hasta ~4 min de una vez. */
const MAX_SEC = 240

/** Idiomas de letra que acepta el Space (el resto se deja en "unknown": lo adivina). */
const LANGUAGES = new Set(
  'ar az bg bn ca cs da de el en es fa fi fr he hi hr ht hu id is it ja ko la lt ms ne nl no pa pl pt ro ru sa sk sr sv sw ta te th tl tr uk ur vi yue zh'.split(
    ' '
  )
)

// Lo mínimo del cliente de Gradio que se usa (así se puede sustituir en los tests).
export interface GradioFile {
  url?: string
  path?: string
  orig_name?: string
}
export type GradioMessage =
  | {
      type: 'status'
      stage: 'pending' | 'error' | 'complete' | 'generating' | 'streaming'
      position?: number
      message?: unknown
      progress_data?: { progress: number | null; desc: string | null }[]
    }
  | { type: 'data'; data: unknown[] }
export interface GradioJob extends AsyncIterable<GradioMessage> {
  cancel(): Promise<void>
}
export type GradioConnect = (
  space: string,
  token: string | null
) => Promise<{ submit(endpoint: string, data: Record<string, unknown>): GradioJob }>

/** Conexión real con `@gradio/client` (se carga solo al usarla). */
export const gradioConnect: GradioConnect = async (space, token) => {
  const { Client } = await import('@gradio/client')
  const client = await Client.connect(space, {
    events: ['data', 'status'],
    ...(token && { token: token as `hf_${string}` })
  })
  return { submit: (endpoint, data) => client.submit(endpoint, data) as unknown as GradioJob }
}

export class HuggingFaceError extends Error {}

/** Traduce los errores del Space a algo que el usuario (y el productor) entiendan. */
export function explainSpaceError(raw: string, hasToken: boolean): string {
  if (/ZeroGPU quota/i.test(raw)) {
    const wait = /Try again in ([\d:]+)/i.exec(raw)?.[1]
    return [
      'Se acabó la cuota gratuita de GPU de Hugging Face para hoy',
      wait ? ` (se renueva en ${wait})` : '',
      '.',
      hasToken
        ? ' Con una cuenta PRO de Hugging Face la cuota es mucho mayor.'
        : ' Añade tu token gratuito de Hugging Face en Ajustes para tener más cuota.'
    ].join('')
  }
  if (/GPU task aborted/i.test(raw)) {
    return 'Hugging Face interrumpió la tarea en la GPU (suele pasar si el Space se estaba despertando). Prueba otra vez en un momento.'
  }
  return `El Space de ACE-Step falló: ${raw || 'error desconocido'}`
}

const messageText = (m: unknown): string =>
  typeof m === 'string' ? m : m === undefined || m === null ? '' : JSON.stringify(m)

export function createHuggingFaceProvider(
  getToken: () => Promise<string | null>,
  connect: GradioConnect = gradioConnect,
  fetchImpl: typeof fetch = fetch
): AudioProvider {
  return {
    id: 'huggingface',
    label: 'Hugging Face · ACE-Step (con voz)',
    description:
      'Canciones completas que cantan la letra, con la GPU gratuita de Hugging Face. La cuota es de pocos minutos al día: con tu token gratuito de HF dura más.',
    capabilities: {
      maxDurationSec: MAX_SEC,
      supportsSeed: true,
      supportsContinue: false,
      supportsMelody: false,
      supportsLyrics: true
    },

    // Sin token también funciona (con menos cuota): siempre está listo.
    async status() {
      return { ready: true }
    },

    async generate(spec, ctx) {
      if (!spec.lyrics?.trim()) {
        throw new HuggingFaceError('ACE-Step necesita la letra de la canción para cantarla.')
      }
      const token = await getToken()
      ctx.onProgress(null, 'Conectando con Hugging Face…')
      let app: Awaited<ReturnType<GradioConnect>>
      try {
        app = await connect(ACE_STEP_SPACE, token)
      } catch (err) {
        throw new HuggingFaceError(
          `No se pudo conectar con el Space de ACE-Step en Hugging Face (puede estar caído o en mantenimiento). ${err instanceof Error ? err.message : ''}`.trim()
        )
      }
      throwIfAborted(ctx.signal)

      const language = spec.lyricsLanguage && LANGUAGES.has(spec.lyricsLanguage)
      const job = app.submit(ACE_STEP_ENDPOINT, {
        selected_model: ACE_STEP_MODEL,
        generation_mode: 'custom',
        simple_query_input: '',
        simple_vocal_language: 'unknown',
        param_4: buildMusicPrompt(spec), // descripción del sonido
        param_5: spec.lyrics, // letra con etiquetas [Verse], [Chorus]…
        param_6: Math.round(spec.bpm),
        param_7: spec.key,
        param_8: '4',
        param_9: language ? spec.lyricsLanguage : 'unknown',
        param_12: spec.seed === undefined, // semilla aleatoria solo si no hay una
        param_13: String(spec.seed ?? -1),
        param_14: null, // audio de referencia
        param_15: requestSeconds(spec.durationSec, MAX_SEC),
        param_16: 1, // una sola toma: la cuota es poca
        param_17: null, // audio de partida (cover/repaint)
        param_18: '',
        param_30: 'flac',
        param_47: null
      })

      const cancelRemote = (): void => void job.cancel().catch(() => undefined)
      ctx.signal.addEventListener('abort', cancelRemote, { once: true })
      try {
        let file: GradioFile | undefined
        for await (const msg of job) {
          throwIfAborted(ctx.signal)
          if (msg.type === 'data') {
            file = msg.data[0] as GradioFile | undefined
            break
          }
          if (msg.stage === 'error') {
            throw new HuggingFaceError(explainSpaceError(messageText(msg.message), !!token))
          }
          const step = msg.progress_data?.at(-1)
          if (step) ctx.onProgress(step.progress, step.desc ?? 'Generando…')
          else if (msg.stage === 'pending') {
            ctx.onProgress(
              null,
              msg.position ? `En cola en Hugging Face (posición ${msg.position})` : 'En cola…'
            )
          }
        }
        throwIfAborted(ctx.signal)
        const url = file?.url
        if (!url) throw new HuggingFaceError('El Space de ACE-Step no devolvió audio.')

        ctx.onProgress(1, 'Descargando…')
        const audio = await fetchImpl(url, {
          signal: ctx.signal,
          ...(token && { headers: { Authorization: `Bearer ${token}` } })
        })
        if (!audio.ok) {
          throw new HuggingFaceError(`No se pudo descargar el audio (${audio.status}).`)
        }
        const ext = /\.(flac|mp3|wav)$/i.exec(file?.orig_name ?? file?.path ?? url)?.[1] ?? 'flac'
        const path = `${ctx.outBase}.${ext.toLowerCase()}`
        await writeFile(path, new Uint8Array(await audio.arrayBuffer()))
        return { path }
      } catch (err) {
        if (ctx.signal.aborted) throw new CancelledError()
        throw err
      } finally {
        ctx.signal.removeEventListener('abort', cancelRemote)
      }
    }
  }
}

/** Comprueba un token de Hugging Face. Devuelve el nombre de usuario o lanza un error. */
export async function verifyHfToken(
  token: string,
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  if (!/^hf_\w+$/.test(token)) throw new Error('Un token de Hugging Face empieza por "hf_".')
  const res = await fetchImpl('https://huggingface.co/api/whoami-v2', {
    headers: { Authorization: `Bearer ${token}` }
  })
  if (res.status === 401) throw new Error('El token de Hugging Face no es válido.')
  if (!res.ok) throw new Error(`Hugging Face respondió ${res.status}.`)
  const body = (await res.json()) as { name?: string }
  return body.name ?? 'desconocido'
}
