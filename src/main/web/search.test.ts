import { describe, expect, it, vi } from 'vitest'
import {
  checkPublicUrl,
  createWebSearch,
  htmlToText,
  isPrivateAddress,
  MAX_PAGE_CHARS,
  parseDuckDuckGo
} from './search'

// Copia reducida de la página de resultados de html.duckduckgo.com.
const DDG = `
<div class="serp__results">
  <div class="result results_links results_links_deep web-result ">
    <div class="links_main links_deep result__body">
      <h2 class="result__title">
        <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fsongbpm.com%2Fcorridos&amp;rut=85e4">BPM of <b>Corridos</b> &amp; key</a>
      </h2>
      <div class="result__extras"><div class="result__extras__url">songbpm.com</div></div>
      <a class="result__snippet" href="//duckduckgo.com/l/?uddg=x">It has a tempo of <b>110 BPM</b>.</a>
    </div>
  </div>
  <div class="result results_links results_links_deep result--ad ">
    <a rel="nofollow" class="result__a" href="https://duckduckgo.com/y.js?ad_domain=x">Anuncio</a>
  </div>
  <div class="result results_links results_links_deep web-result ">
    <a rel="nofollow" class="result__a" href="https://example.org/a">Otro</a>
  </div>
</div>`

const publicDns = async (): Promise<string[]> => ['93.184.216.34']

const response = (body: string, init: ResponseInit = {}): Response =>
  new Response(body, { headers: { 'content-type': 'text/html' }, ...init })

describe('búsqueda web del productor', () => {
  it('lee los resultados de DuckDuckGo con la URL real y sin anuncios', () => {
    expect(parseDuckDuckGo(DDG)).toEqual([
      {
        title: 'BPM of Corridos & key',
        url: 'https://songbpm.com/corridos',
        snippet: 'It has a tempo of 110 BPM .'
      },
      { title: 'Otro', url: 'https://example.org/a', snippet: '' }
    ])
  })

  it('saca el texto de una página sin scripts ni menús', () => {
    const page = htmlToText(
      '<html><head><title>Guía &amp; más</title><style>a{}</style></head><body><nav>Menú</nav><h1>Reggaeton</h1><p>Va a 95&nbsp;BPM.</p><script>x()</script></body></html>'
    )
    expect(page).toEqual({ title: 'Guía & más', text: 'Reggaeton\nVa a 95 BPM.' })
  })

  it.each([
    ['127.0.0.1', true],
    ['10.1.2.3', true],
    ['192.168.1.20', true],
    ['172.20.0.1', true],
    ['169.254.169.254', true],
    ['::1', true],
    ['::ffff:127.0.0.1', true],
    ['fd00::1', true],
    ['93.184.216.34', false],
    ['2606:4700::1111', false]
  ])('%s es privada: %s', (ip, priv) => {
    expect(isPrivateAddress(ip)).toBe(priv)
  })

  it('no deja leer este equipo ni la red local', async () => {
    await expect(checkPublicUrl('http://localhost:11434/api/tags', publicDns)).rejects.toThrow(
      /red local/
    )
    await expect(checkPublicUrl('http://192.168.1.1/', publicDns)).rejects.toThrow(/red local/)
    await expect(
      checkPublicUrl('https://router.example', async () => ['10.0.0.1'])
    ).rejects.toThrow(/red local/)
    await expect(checkPublicUrl('file:///C:/secreto.txt', publicDns)).rejects.toThrow(/http/)
    await expect(checkPublicUrl('https://example.org/x', publicDns)).resolves.toBeInstanceOf(URL)
  })

  it('sin clave busca en DuckDuckGo y avisa si le pide un reto', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => response(DDG))
    const web = createWebSearch({ getOllamaKey: async () => null, fetchImpl, resolve: publicDns })
    expect(await web.search('corridos bpm')).toHaveLength(2)
    expect(String(fetchImpl.mock.calls[0][0])).toBe(
      'https://html.duckduckgo.com/html/?q=corridos%20bpm'
    )

    fetchImpl.mockResolvedValueOnce(response('<form id="challenge-form"></form>'))
    await expect(web.search('x')).rejects.toThrow(/clave gratuita de Ollama/)
  })

  it('con clave usa la API de Ollama', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer k')
      return String(url).endsWith('web_search')
        ? Response.json({ results: [{ title: 'T', url: 'https://a.b', content: 'texto  largo' }] })
        : Response.json({ title: 'Página', content: 'x'.repeat(MAX_PAGE_CHARS * 2) })
    })
    const web = createWebSearch({ getOllamaKey: async () => 'k', fetchImpl, resolve: publicDns })
    expect(await web.search('q')).toEqual([
      { title: 'T', url: 'https://a.b', snippet: 'texto largo' }
    ])
    const page = await web.read('https://example.org/')
    expect(page.title).toBe('Página')
    expect(page.text.length).toBeLessThanOrEqual(MAX_PAGE_CHARS + 1)
  })

  it('lee una página recortada y comprueba también adónde redirige', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) =>
      String(url) === 'https://example.org/'
        ? response('', { status: 301, headers: { location: '/guia' } })
        : response(`<title>Guía</title><p>${'palabra '.repeat(2000)}</p>`)
    )
    const web = createWebSearch({ getOllamaKey: async () => null, fetchImpl, resolve: publicDns })
    const page = await web.read('https://example.org/')
    expect(page.url).toBe('https://example.org/guia')
    expect(page.text.length).toBeLessThanOrEqual(MAX_PAGE_CHARS + 1)

    fetchImpl.mockResolvedValueOnce(
      response('', { status: 302, headers: { location: 'http://127.0.0.1/admin' } })
    )
    await expect(web.read('https://example.org/')).rejects.toThrow(/red local/)
  })
})
