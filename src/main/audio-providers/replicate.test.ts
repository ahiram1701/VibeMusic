import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { GenerationSpec } from '@shared/project'
import { createReplicateProvider, MUSICGEN_VERSION, progressFromLogs } from './replicate'

const spec: GenerationSpec = {
  prompt: 'lo-fi drums',
  bpm: 90,
  key: 'A minor',
  durationSec: 10.67,
  role: 'drums',
  mode: 'text',
  seed: 42
}

interface Call {
  url: string
  method: string
  body?: unknown
}

/** fetch falso que responde según una lista de pasos y registra las llamadas. */
function fakeFetch(steps: ((c: Call) => Response)[]): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = []
  const fn = (async (url: string, init?: RequestInit) => {
    const call: Call = {
      url,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(init.body as string) : undefined
    }
    calls.push(call)
    const step = steps.shift()
    if (!step) throw new Error(`llamada inesperada: ${call.method} ${url}`)
    return step(call)
  }) as typeof fetch
  return { fetch: fn, calls }
}

const json = (body: unknown, status = 200): Response => Response.json(body, { status })

describe('Replicate provider', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'vibe-rep-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const ctx = (signal = new AbortController().signal) => ({
    signal,
    outBase: join(dir, 'out'),
    onProgress: () => undefined
  })

  it('crea la predicción, consulta hasta terminar y descarga el audio', async () => {
    const { fetch, calls } = fakeFetch([
      () => json({ id: 'p1', status: 'starting', output: null, error: null, logs: null }),
      () => json({ id: 'p1', status: 'processing', output: null, error: null, logs: ' 50%|###' }),
      () =>
        json({ id: 'p1', status: 'succeeded', output: 'https://x/a.wav', error: null, logs: '' }),
      () => new Response(new Uint8Array([82, 73, 70, 70]))
    ])
    const provider = createReplicateProvider(async () => 'tok', fetch, 1)
    const { path } = await provider.generate(spec, ctx())

    expect(calls[0]).toMatchObject({
      url: 'https://api.replicate.com/v1/predictions',
      method: 'POST',
      body: {
        version: MUSICGEN_VERSION,
        input: { duration: 11, seed: 42, output_format: 'wav', model_version: 'stereo-large' }
      }
    })
    expect((calls[0].body as { input: { prompt: string } }).input.prompt).toContain('90 bpm')
    expect(calls[1].url).toBe('https://api.replicate.com/v1/predictions/p1')
    expect(calls[3].url).toBe('https://x/a.wav')
    expect((await readFile(path)).toString()).toBe('RIFF')
  })

  it('explica una API key inválida', async () => {
    const { fetch } = fakeFetch([() => json({ detail: 'Unauthenticated' }, 401)])
    const provider = createReplicateProvider(async () => 'mala', fetch, 1)
    await expect(provider.generate(spec, ctx())).rejects.toThrow(
      /API key de Replicate no es válida/
    )
  })

  it('al cancelar, cancela también la predicción remota', async () => {
    const controller = new AbortController()
    const { fetch, calls } = fakeFetch([
      () => {
        setTimeout(() => controller.abort(), 5)
        return json({ id: 'p9', status: 'starting', output: null, error: null, logs: null })
      },
      () => json({ id: 'p9', status: 'canceled' })
    ])
    const provider = createReplicateProvider(async () => 'tok', fetch, 1000)
    await expect(provider.generate(spec, ctx(controller.signal))).rejects.toThrow('Cancelado')
    expect(calls[1]).toMatchObject({ url: 'https://api.replicate.com/v1/predictions/p9/cancel' })
  })

  it('no está listo sin token', async () => {
    const provider = createReplicateProvider(async () => null)
    expect(await provider.status()).toMatchObject({ ready: false })
  })

  it('lee el progreso de los logs de MusicGen', () => {
    expect(progressFromLogs(' 10%|#  \n 73%|#######')).toBeCloseTo(0.73)
    expect(progressFromLogs('cargando modelo')).toBeNull()
  })

  it('continuar: envía el audio de partida y pide recortarlo del resultado', async () => {
    const cond = join(dir, 'partida.wav')
    await writeFile(cond, new Uint8Array([82, 73, 70, 70, 1, 2, 3]))
    const { fetch, calls } = fakeFetch([
      () =>
        json({ id: 'p2', status: 'succeeded', output: 'https://x/c.wav', error: null, logs: '' }),
      () => new Response(new Uint8Array([82, 73, 70, 70]))
    ])
    const provider = createReplicateProvider(async () => 'tok', fetch, 1)
    const result = await provider.generate(
      {
        ...spec,
        mode: 'continue',
        durationSec: 8,
        conditioning: { clipId: 'c', file: 'x', seconds: 6.5 }
      },
      { ...ctx(), conditioningPath: cond }
    )
    const input = (calls[0].body as { input: Record<string, unknown> }).input
    expect(input.continuation).toBe(true)
    expect(input.duration).toBe(15) // 6.5 s de partida + 8 s nuevos, redondeado
    expect(String(input.input_audio)).toMatch(/^data:audio\/wav;base64,UklGRg/)
    expect(result.trimStartSec).toBe(6.5)
  })
})
