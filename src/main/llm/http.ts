import { Agent, fetch as undiciFetch } from 'undici'
import { LlmError } from './types'

// El fetch de Node abandona la petición si la respuesta tarda más de 5 minutos en
// empezar ("fetch failed"). Un modelo local en CPU puede tardar más que eso solo en
// leer las instrucciones del productor, así que para el LLM se usa un límite amplio.
// El usuario siempre puede cancelar desde el chat.
const LLM_TIMEOUT_MS = 30 * 60_000

const agent = new Agent({ headersTimeout: LLM_TIMEOUT_MS, bodyTimeout: LLM_TIMEOUT_MS })

/** fetch para llamadas al LLM, sin el límite de 5 minutos de Node. */
export const llmFetch = ((input: string, init?: RequestInit) =>
  undiciFetch(input, {
    ...(init as Parameters<typeof undiciFetch>[1]),
    dispatcher: agent
  })) as unknown as typeof fetch

// Node solo dice "fetch failed": el motivo real (conexión rechazada, cortada, sin
// respuesta…) viaja en `err.cause`. Se traduce para que el aviso del chat sirva de algo.
const NETWORK_HINTS: Record<string, string> = {
  ECONNREFUSED: 'el servidor no acepta conexiones: ¿está apagado o reiniciando?',
  ECONNRESET: 'la conexión se cortó',
  EPIPE: 'la conexión se cortó',
  UND_ERR_SOCKET: 'la conexión se cortó',
  ETIMEDOUT: 'el equipo no responde: ¿está apagado, dormido o sin red?',
  EHOSTUNREACH: 'no se llega al equipo: ¿está apagado, dormido o sin red?',
  ENETUNREACH: 'sin red',
  ENOTFOUND: 'no se encuentra el servidor: revisa la URL',
  UND_ERR_CONNECT_TIMEOUT: 'el equipo no responde: ¿está apagado, dormido o sin red?',
  UND_ERR_HEADERS_TIMEOUT: `no respondió en ${LLM_TIMEOUT_MS / 60_000} min`,
  UND_ERR_BODY_TIMEOUT: `la respuesta se quedó a medias más de ${LLM_TIMEOUT_MS / 60_000} min`
}

/** Explica en castellano un fallo de red de fetch (incluye el código técnico). */
export function describeFetchError(err: unknown): string {
  const e = err as { message?: string; cause?: { code?: string; message?: string } } | undefined
  const code = e?.cause?.code
  if (code) return NETWORK_HINTS[code] ? `${NETWORK_HINTS[code]} · ${code}` : code
  return e?.cause?.message ?? e?.message ?? String(err)
}

/** Lee el JSON de la respuesta; si la conexión se corta a mitad, es un fallo de red. */
export async function readJson<T>(res: Response, label: string, signal: AbortSignal): Promise<T> {
  try {
    return (await res.json()) as T
  } catch (err) {
    if (signal.aborted) throw new LlmError('Cancelado', 'cancelled')
    if (err instanceof SyntaxError) throw new LlmError(`${label} devolvió una respuesta no válida.`)
    throw new LlmError(`Se cortó la respuesta de ${label} (${describeFetchError(err)}).`, 'network')
  }
}
