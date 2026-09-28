import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { LocalEngineStatus } from '@shared/local-engine'
import { StemsService } from './stems'

// Rutas del sistema en que corre el test (Windows en local, Linux en CI).
const proy = join(tmpdir(), 'proy')

const host = (status: LocalEngineStatus) => ({
  baseUrl: 'http://127.0.0.1:9',
  started: 0,
  async status() {
    return status
  },
  async ensureRunning() {
    this.started++
  }
})

const installed: LocalEngineStatus = { state: 'stopped', variant: 'cpu', stems: true }

describe('StemsService', () => {
  it('envía el clip del proyecto y devuelve las pistas con rutas relativas', async () => {
    const calls: { url: string; body?: Record<string, string> }[] = []
    const replies = [
      Response.json({
        id: 's1',
        status: 'running',
        progress: 0.5,
        stage: 'Separando pistas…',
        error: null
      }),
      Response.json({
        id: 's1',
        status: 'done',
        progress: 1,
        stage: 'Listo',
        error: null,
        stems: [
          { name: 'drums', path: join(proy, 'clips', 'stems', 'x', 'drums.wav'), rms: 0.2 },
          { name: 'vocals', path: join(proy, 'clips', 'stems', 'x', 'vocals.wav'), rms: 0 }
        ]
      })
    ]
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body as string) : undefined })
      return replies.shift()!
    }) as typeof fetch
    const h = host(installed)
    const svc = new StemsService(h, fetchImpl, 1)
    const stages: string[] = []
    const stems = await svc.separate('r1', proy, 'clips/clp_1.wav', (_, s) => stages.push(s))

    expect(h.started).toBe(1)
    expect(calls[0].url).toBe('http://127.0.0.1:9/separations')
    expect(calls[0].body?.input_path).toBe(join(proy, 'clips', 'clp_1.wav'))
    expect(calls[0].body?.output_dir.startsWith(join(proy, 'clips', 'stems', 'stm_'))).toBe(true)
    expect(stems).toEqual([
      { name: 'drums', file: 'clips/stems/x/drums.wav', rms: 0.2 },
      { name: 'vocals', file: 'clips/stems/x/vocals.wav', rms: 0 }
    ])
    expect(stages).toContain('Separando pistas…')
  })

  it('explica qué falta instalar', async () => {
    const notInstalled = new StemsService(host({ state: 'not-installed' }))
    await expect(notInstalled.separate('r', proy, 'clips/a.wav', () => undefined)).rejects.toThrow(
      /instala el motor local/
    )
    const noStems = new StemsService(host({ state: 'stopped', variant: 'cpu', stems: false }))
    await expect(noStems.separate('r', proy, 'clips/a.wav', () => undefined)).rejects.toThrow(
      /Falta la separación/
    )
  })

  it('rechaza clips fuera del proyecto', async () => {
    const svc = new StemsService(
      host(installed),
      (async () => Response.json({})) as typeof fetch,
      1
    )
    await expect(svc.separate('r', proy, '../../fuera/win.ini', () => undefined)).rejects.toThrow(
      /fuera del proyecto/
    )
  })
})
