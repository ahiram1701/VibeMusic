import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import type { WebPage, WebResult } from '@shared/web'

// Internet para el productor: buscar en la web y leer páginas, gratis. Con una clave
// de Ollama (gratuita en ollama.com) usa su API de búsqueda, que es más estable; sin
// clave, la versión HTML de DuckDuckGo. Lo que devuelve va al LLM, que tiene poco
// contexto en un equipo sin GPU: resultados cortos y páginas recortadas.

export interface WebSearch {
  search(query: string): Promise<WebResult[]>
  read(url: string): Promise<WebPage>
}

const MAX_RESULTS = 5
const MAX_SNIPPET = 300
/** Caracteres de una página que llegan al LLM (~1000 tokens). */
export const MAX_PAGE_CHARS = 4000
const TIMEOUT_MS = 20_000
const MAX_REDIRECTS = 3
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
const OLLAMA_API = 'https://ollama.com/api'

export class WebError extends Error {}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  '#39': "'",
  '#x27': "'"
}

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e: string) => {
    const lower = e.toLowerCase()
    if (ENTITIES[lower]) return ENTITIES[lower]
    if (lower.startsWith('#x')) return String.fromCodePoint(parseInt(lower.slice(2), 16))
    if (lower.startsWith('#')) return String.fromCodePoint(Number(lower.slice(1)))
    return m
  })
}

const clip = (s: string, max: number): string =>
  s.length > max ? s.slice(0, max).replace(/\s+\S*$/, '') + '…' : s

const stripTags = (html: string): string =>
  decodeEntities(html.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()

/** Texto legible de una página HTML, sin scripts, estilos ni menús. */
export function htmlToText(html: string): { title: string; text: string } {
  const title = stripTags(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '')
  const body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(
      /<(head|title|script|style|noscript|svg|nav|footer|header|form|iframe)\b[\s\S]*?<\/\1>/gi,
      ' '
    )
    // Los bloques se separan con saltos de línea para que el texto se pueda leer.
    .replace(/<\/?(p|div|br|li|h[1-6]|tr|section|article|blockquote)\b[^>]*>/gi, '\n')
  const text = decodeEntities(body.replace(/<[^>]+>/g, ' '))
    .split('\n')
    .map((l) => l.replace(/[ \t\r\f\v]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
  return { title, text }
}

/** Resultados de la página HTML de DuckDuckGo. */
export function parseDuckDuckGo(html: string): WebResult[] {
  const results: WebResult[] = []
  const blocks = html.split(/<div[^>]+class="[^"]*\bresult\b[^"]*"/).slice(1)
  for (const block of blocks) {
    const link = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(
      block
    )
    if (!link) continue
    let url = decodeEntities(link[1])
    // Los enlaces pasan por la redirección de DuckDuckGo: la URL real va en "uddg".
    const uddg = /[?&]uddg=([^&]+)/.exec(url)?.[1]
    if (uddg) url = decodeURIComponent(uddg)
    if (url.startsWith('//')) url = `https:${url}`
    if (!/^https?:\/\//.test(url) || /duckduckgo\.com\/y\.js/.test(url)) continue // anuncios
    const snippet = /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(a|div|td)>/.exec(block)
    results.push({
      title: stripTags(link[2]),
      url,
      snippet: clip(stripTags(snippet?.[1] ?? ''), MAX_SNIPPET)
    })
    if (results.length >= MAX_RESULTS) break
  }
  return results
}

/** ¿Es una dirección de este equipo o de la red local? (no se dejan leer). */
export function isPrivateAddress(ip: string): boolean {
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip
  if (isIP(v4) === 4) {
    const [a, b] = v4.split('.').map(Number)
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    )
  }
  const v6 = ip.toLowerCase()
  return v6 === '::' || v6 === '::1' || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6)
}

type Resolve = (host: string) => Promise<string[]>
const resolveHost: Resolve = async (host) =>
  (await lookup(host, { all: true })).map((a) => a.address)

/** Comprueba que la URL es pública (http/https y fuera de la red local). */
export async function checkPublicUrl(raw: string, resolve: Resolve = resolveHost): Promise<URL> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new WebError(`"${raw}" no es una URL`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new WebError('Solo se pueden leer páginas http:// o https://')
  }
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const local = /^localhost$|\.localhost$|\.local$|\.internal$/i.test(host)
  const addresses = isIP(host) ? [host] : local ? [] : await resolve(host).catch(() => [])
  if (local || addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new WebError(
      local || addresses.length > 0
        ? 'No se pueden leer páginas de este equipo ni de la red local'
        : `No se encuentra ${host}`
    )
  }
  return url
}

export function createWebSearch(opts: {
  /** Clave de la API de Ollama, o null para usar DuckDuckGo. */
  getOllamaKey: () => Promise<string | null>
  fetchImpl?: typeof fetch
  resolve?: Resolve
}): WebSearch {
  const fetchImpl = opts.fetchImpl ?? fetch

  const get = async (url: string, init: RequestInit = {}): Promise<Response> => {
    try {
      return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) })
    } catch (err) {
      const reason = err instanceof Error && err.name === 'TimeoutError' ? 'no respondió' : 'falló'
      throw new WebError(`La conexión con ${new URL(url).hostname} ${reason}`)
    }
  }

  const ollama = async <T>(key: string, path: string, body: unknown): Promise<T> => {
    const res = await get(`${OLLAMA_API}/${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
    if (res.status === 401 || res.status === 403) {
      throw new WebError('La clave de Ollama no es válida. Revísala en Ajustes → Productor.')
    }
    if (!res.ok) throw new WebError(`La búsqueda de Ollama falló (${res.status})`)
    return (await res.json()) as T
  }

  return {
    async search(query) {
      const q = query.trim()
      if (!q) throw new WebError('La búsqueda está vacía')
      const key = await opts.getOllamaKey()
      if (key) {
        const r = await ollama<{ results?: { title?: string; url?: string; content?: string }[] }>(
          key,
          'web_search',
          { query: q, max_results: MAX_RESULTS }
        )
        return (r.results ?? []).slice(0, MAX_RESULTS).map((x) => ({
          title: x.title ?? '',
          url: x.url ?? '',
          snippet: clip((x.content ?? '').replace(/\s+/g, ' ').trim(), MAX_SNIPPET)
        }))
      }
      const res = await get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, {
        headers: { 'user-agent': USER_AGENT, 'accept-language': 'es,en;q=0.8' }
      })
      const html = res.ok ? await res.text() : ''
      // Si DuckDuckGo sospecha de un robot, devuelve un reto en vez de resultados.
      if (!res.ok || /anomaly-modal|challenge-form/.test(html)) {
        throw new WebError(
          'DuckDuckGo no dejó buscar ahora. Prueba más tarde o añade una clave gratuita de Ollama en Ajustes → Productor.'
        )
      }
      return parseDuckDuckGo(html)
    },

    async read(raw) {
      let url = await checkPublicUrl(raw, opts.resolve)
      const key = await opts.getOllamaKey()
      if (key) {
        const r = await ollama<{ title?: string; content?: string }>(key, 'web_fetch', {
          url: url.href
        })
        return {
          url: url.href,
          title: r.title ?? '',
          text: clip(r.content ?? '', MAX_PAGE_CHARS)
        }
      }
      // Las redirecciones se siguen a mano para comprobar también su destino.
      let res: Response | undefined
      for (let i = 0; i <= MAX_REDIRECTS; i++) {
        res = await get(url.href, {
          redirect: 'manual',
          headers: { 'user-agent': USER_AGENT, accept: 'text/html,text/plain' }
        })
        const location = res.status >= 300 && res.status < 400 && res.headers.get('location')
        if (!location) break
        url = await checkPublicUrl(new URL(location, url).href, opts.resolve)
        res = undefined
      }
      if (!res) throw new WebError('La página redirige demasiadas veces')
      if (!res.ok) throw new WebError(`La página respondió con un error (${res.status})`)
      const type = res.headers.get('content-type') ?? ''
      if (type && !/text\/html|text\/plain|xhtml/.test(type)) {
        throw new WebError(`No es una página de texto (${type.split(';')[0]})`)
      }
      const body = await res.text()
      const page = /text\/plain/.test(type) ? { title: '', text: body } : htmlToText(body)
      return { url: url.href, title: page.title, text: clip(page.text, MAX_PAGE_CHARS) }
    }
  }
}
