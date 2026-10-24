import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { GenerationSpec } from '@shared/project'
import {
  ACE_STEP_ENDPOINT,
  ACE_STEP_SPACE,
  createHuggingFaceProvider,
  explainSpaceError,
  verifyHfToken,
  type GradioConnect,
  type GradioMessage
} from './huggingface'
import { CancelledError } from './types'

const spec: GenerationSpec = {
  prompt: 'romantic cumbia, warm male vocal',
  bpm: 96,
  key: 'A minor',
  durationSec: 80,
  role: 'full',
  mode: 'text',
  seed: 7,
  lyrics: '[Verse]\nCaminando por la playa',
  lyricsLanguage: 'es'
}

/** Cliente de Gradio falso: devuelve los mensajes indicados y registra la llamada. */
function fakeGradio(messages: GradioMessage[], opts: { hang?: boolean } = {}) {
  const calls: {
    space: string
    token: string | null
    endpoint: string
    data: Record<string, unknown>
  }[] = []
  let cancelled = false
  const connect: GradioConnect = async (space, token) => ({
    submit(endpoint, data) {
      calls.push({ space, token, endpoint, data })
      return {
        cancel: async () => {
          cancelled = true
        },
        async *[Symbol.asyncIterator]() {
          for (const m of messages) yield m
          // Simula una generación larga que solo termina si se cancela.
          while (opts.hang && !cancelled) await new Promise((r) => setTimeout(r, 5))
        }
      }
    }
  })
  return { connect, calls, wasCancelled: () => cancelled }
}

const audioFetch = (async () => new Response(new Uint8Array([1, 2, 3]))) as unknown as typeof fetch

describe('Hugging Face provider (ACE-Step)', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'vibe-hf-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const ctx = (signal = new AbortController().signal, stages: string[] = []) => ({
    signal,
    outBase: join(dir, 'out'),
    onProgress: (_p: number | null, stage: string) => void stages.push(stage)
  })

  it('pide la canción con letra, informa del progreso y guarda el audio', async () => {
    const g = fakeGradio([
      { type: 'status', stage: 'pending', position: 2 },
      {
        type: 'status',
        stage: 'pending',
        progress_data: [{ progress: 0.5, desc: 'Generating music…' }]
      },
      { type: 'data', data: [{ url: 'https://x.hf.space/file=song.flac', orig_name: 'song.flac' }] }
    ])
    const stages: string[] = []
    const provider = createHuggingFaceProvider(async () => 'hf_abc', g.connect, audioFetch)
    const res = await provider.generate(spec, ctx(undefined, stages))

    expect(res.path).toBe(join(dir, 'out.flac'))
    expect([...(await readFile(res.path))]).toEqual([1, 2, 3])
    expect(g.calls).toHaveLength(1)
    const { space, token, endpoint, data } = g.calls[0]
    expect([space, token, endpoint]).toEqual([ACE_STEP_SPACE, 'hf_abc', ACE_STEP_ENDPOINT])
    expect(data).toMatchObject({
      generation_mode: 'custom',
      param_5: spec.lyrics,
      param_6: 96,
      param_7: 'A minor',
      param_9: 'es',
      param_12: false,
      param_13: '7',
      param_15: 80,
      param_16: 1
    })
    expect(data.param_4).toContain('romantic cumbia')
    expect(stages).toContain('En cola en Hugging Face (posición 2)')
    expect(stages).toContain('Generating music…')
  })

  it('sin letra no gasta cuota: falla antes de conectar', async () => {
    const g = fakeGradio([])
    const provider = createHuggingFaceProvider(async () => null, g.connect, audioFetch)
    await expect(provider.generate({ ...spec, lyrics: undefined }, ctx())).rejects.toThrow(
      /necesita la letra/
    )
    expect(g.calls).toHaveLength(0)
  })

  it('explica la cuota agotada', async () => {
    const g = fakeGradio([
      {
        type: 'status',
        stage: 'error',
        message:
          'You have exceeded your ZeroGPU quota (180s requested vs. 0s left). Try again in 23:54:55.'
      }
    ])
    const provider = createHuggingFaceProvider(async () => null, g.connect, audioFetch)
    await expect(provider.generate(spec, ctx())).rejects.toThrow(
      /cuota gratuita.*23:54:55.*token gratuito/
    )
  })

  it('cancela la tarea en el Space al cancelar', async () => {
    const g = fakeGradio([{ type: 'status', stage: 'pending' }], { hang: true })
    const provider = createHuggingFaceProvider(async () => null, g.connect, audioFetch)
    const ac = new AbortController()
    const running = provider.generate(spec, ctx(ac.signal))
    setTimeout(() => ac.abort(), 20)
    await expect(running).rejects.toBeInstanceOf(CancelledError)
    expect(g.wasCancelled()).toBe(true)
  })

  it('traduce los errores conocidos del Space', () => {
    expect(explainSpaceError('GPU task aborted', false)).toMatch(/Prueba otra vez/)
    expect(explainSpaceError('ZeroGPU quota exceeded', true)).toMatch(/PRO/)
    expect(explainSpaceError('boom', false)).toBe('El Space de ACE-Step falló: boom')
  })

  it('verifica el token con whoami', async () => {
    const ok = (async () => Response.json({ name: 'ahiram' })) as unknown as typeof fetch
    expect(await verifyHfToken('hf_abc123', ok)).toBe('ahiram')
    const bad = (async () => new Response('', { status: 401 })) as unknown as typeof fetch
    await expect(verifyHfToken('hf_abc123', bad)).rejects.toThrow(/no es válido/)
    await expect(verifyHfToken('r8_abc', ok)).rejects.toThrow(/empieza por "hf_"/)
  })
})
