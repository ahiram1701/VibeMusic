import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { LocalEngineStatus } from '@shared/local-engine'
import type { GenerationSpec } from '@shared/project'
import { createLocalProvider, type LocalEngineHost } from './local'

const spec: GenerationSpec = {
  prompt: 'lofi drums',
  bpm: 90,
  key: 'A minor',
  durationSec: 10.666,
  role: 'drums',
  mode: 'text',
  seed: 2 ** 31 + 5
}

function host(
  state: LocalEngineStatus['state'] = 'stopped'
): LocalEngineHost & { started: number } {
  return {
    started: 0,
    baseUrl: 'http://127.0.0.1:9999',
    async status() {
      return { state, variant: 'cpu' } as LocalEngineStatus
    },
    async ensureRunning() {
      this.started++
    }
  }
}

describe('proveedor local', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'vibe-local-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('arranca el motor, crea el trabajo, sigue el progreso y descarga el WAV', async () => {
    const calls: { url: string; method: string; body?: unknown }[] = []
    const replies = [
      Response.json({ id: 'j1', status: 'queued', progress: null, stage: 'En cola', error: null }),
      Response.json({
        id: 'j1',
        status: 'running',
        progress: 0.5,
        stage: 'Generando…',
        error: null
      }),
      Response.json({ id: 'j1', status: 'done', progress: 1, stage: 'Listo', error: null }),
      new Response(new Uint8Array([82, 73, 70, 70]))
    ]
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        method: init?.method ?? 'GET',
        body: init?.body && JSON.parse(init.body as string)
      })
      return replies.shift()!
    }) as typeof fetch
    const h = host()
    const progress: (number | null)[] = []
    const provider = createLocalProvider(h, async () => 'facebook/musicgen-small', fetchImpl, 1)
    const { path } = await provider.generate(spec, {
      signal: new AbortController().signal,
      outBase: join(dir, 'out'),
      onProgress: (p) => progress.push(p)
    })

    expect(h.started).toBe(1)
    expect(calls[0]).toMatchObject({
      url: 'http://127.0.0.1:9999/jobs',
      method: 'POST',
      body: { seconds: 10.7, seed: 5, model: 'facebook/musicgen-small' }
    })
    expect((calls[0].body as { prompt: string }).prompt).toContain('90 bpm')
    expect(calls.at(-1)?.url).toBe('http://127.0.0.1:9999/jobs/j1/audio')
    expect(progress).toContain(0.5)
    expect((await readFile(path)).toString()).toBe('RIFF')
  })

  it('traslada los errores del motor', async () => {
    const replies = [
      Response.json({ id: 'j2', status: 'running', progress: 0, stage: 'x', error: null }),
      Response.json({
        id: 'j2',
        status: 'error',
        progress: 0,
        stage: 'Error',
        error: 'OutOfMemoryError: sin RAM'
      })
    ]
    const provider = createLocalProvider(
      host(),
      async () => 'm',
      (async () => replies.shift()!) as typeof fetch,
      1
    )
    await expect(
      provider.generate(spec, {
        signal: new AbortController().signal,
        outBase: join(dir, 'o'),
        onProgress: () => undefined
      })
    ).rejects.toThrow(/sin RAM/)
  })

  it('no está listo si no está instalado', async () => {
    expect(
      await createLocalProvider(host('not-installed'), async () => 'm').status()
    ).toMatchObject({
      ready: false,
      reason: expect.stringContaining('no está instalado')
    })
    expect(await createLocalProvider(host('stopped'), async () => 'm').status()).toEqual({
      ready: true
    })
  })
})
