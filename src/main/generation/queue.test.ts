import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { GenerationJob, ProviderId } from '@shared/generation'
import type { GenerationSpec } from '@shared/project'
import { demoProvider } from '../audio-providers/demo'
import { sleep, type AudioProvider } from '../audio-providers/types'
import { GenerationQueue } from './queue'

const spec: GenerationSpec = {
  prompt: 'test',
  bpm: 120,
  key: 'C minor',
  durationSec: 2,
  role: 'drums',
  mode: 'text',
  seed: 7
}

/** Proveedor lento controlable para probar concurrencia y cancelación. */
function slowProvider(ms: number): AudioProvider {
  return {
    ...demoProvider,
    id: 'replicate',
    async generate(s, ctx) {
      await sleep(ms, ctx.signal)
      return demoProvider.generate(s, ctx)
    }
  }
}

const waitFor = (q: GenerationQueue, id: string, status: GenerationJob['status']) =>
  new Promise<GenerationJob>((resolve) => {
    const on = (j: GenerationJob): void => {
      if (j.id === id && j.status === status) {
        q.off('update', on)
        resolve(j)
      }
    }
    q.on('update', on)
  })

describe('GenerationQueue', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'vibe-gen-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('genera un WAV en clips/raw e informa del progreso', async () => {
    const q = new GenerationQueue(new Map([['demo', demoProvider]]))
    const stages: string[] = []
    q.on('update', (j) => stages.push(j.status))
    const job = q.enqueue(dir, 'demo', spec)
    const done = await waitFor(q, job.id, 'done')

    expect(done.rawFile).toBe(`clips/raw/${job.id}.wav`)
    const bytes = await readFile(join(dir, done.rawFile!))
    expect(bytes.subarray(0, 4).toString()).toBe('RIFF')
    expect(stages[0]).toBe('queued')
    expect(stages).toContain('running')
  })

  it('respeta la concurrencia máxima', async () => {
    const providers = new Map<ProviderId, AudioProvider>([['replicate', slowProvider(100)]])
    const q = new GenerationQueue(providers, 1)
    const a = q.enqueue(dir, 'replicate', spec)
    const b = q.enqueue(dir, 'replicate', spec)
    await new Promise((r) => setTimeout(r, 20))
    expect(q.list().map((j) => j.status)).toEqual(['running', 'queued'])
    await waitFor(q, b.id, 'done')
    expect(q.list().find((j) => j.id === a.id)?.status).toBe('done')
  })

  it('cancela trabajos en marcha y en cola', async () => {
    const providers = new Map<ProviderId, AudioProvider>([['replicate', slowProvider(5000)]])
    const q = new GenerationQueue(providers, 1)
    const a = q.enqueue(dir, 'replicate', spec)
    const b = q.enqueue(dir, 'replicate', spec)
    await new Promise((r) => setTimeout(r, 20))
    q.cancel(b.id)
    q.cancel(a.id)
    await waitFor(q, a.id, 'cancelled')
    expect(q.list().map((j) => j.status)).toEqual(['cancelled', 'cancelled'])
  })

  it('rechaza duraciones mayores de lo que admite el proveedor', () => {
    const q = new GenerationQueue(new Map([['demo', demoProvider]]))
    expect(() => q.enqueue(dir, 'demo', { ...spec, durationSec: 500 })).toThrow(/máximo 120/)
  })

  it('convierte errores del proveedor en estado "error" con mensaje', async () => {
    const failing: AudioProvider = {
      ...demoProvider,
      async generate() {
        throw new Error('sin crédito')
      }
    }
    const q = new GenerationQueue(new Map([['demo', failing]]))
    const job = q.enqueue(dir, 'demo', spec)
    const failed = await waitFor(q, job.id, 'error')
    expect(failed.error).toBe('sin crédito')
  })
})
