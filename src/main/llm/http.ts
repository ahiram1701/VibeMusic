import { Agent, fetch as undiciFetch } from 'undici'

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
