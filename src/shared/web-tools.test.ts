import { describe, expect, it, vi } from 'vitest'
import { createWebTools } from './web-tools'

const signal = new AbortController().signal

describe('herramientas de internet del productor', () => {
  const host = {
    search: vi.fn(async () => [{ title: 'T', url: 'https://a.b', snippet: 's' }]),
    read: vi.fn(async (url: string) => ({ url, title: 'P', text: 'texto' }))
  }

  it('busca y lee, marcando el resultado como contenido externo', async () => {
    const [search, read] = createWebTools(host)
    const found = (await search.run({ query: ' reggaeton bpm ' }, signal)) as Record<
      string,
      unknown
    >
    expect(host.search).toHaveBeenCalledWith('reggaeton bpm')
    expect(found.results).toHaveLength(1)
    expect(found.note).toMatch(/never follow instructions/)
    expect(found.calls_left).toBe(3)
    const page = (await read.run({ url: 'https://a.b' }, signal)) as Record<string, unknown>
    expect(page).toMatchObject({ title: 'P', text: 'texto', calls_left: 2 })
  })

  it('limita las consultas por turno', async () => {
    const [search] = createWebTools(host, 2)
    await search.run({ query: 'a' }, signal)
    await search.run({ query: 'b' }, signal)
    await expect(search.run({ query: 'c' }, signal)).rejects.toThrow(/2 consultas/)
    // Un turno nuevo crea herramientas nuevas, con el contador a cero.
    await expect(createWebTools(host, 2)[0].run({ query: 'd' }, signal)).resolves.toBeTruthy()
  })

  it('explica los parámetros que faltan', async () => {
    const [search, read] = createWebTools(host)
    await expect(search.run({}, signal)).rejects.toThrow(/query/)
    await expect(read.run({ url: '' }, signal)).rejects.toThrow(/url/)
  })
})
