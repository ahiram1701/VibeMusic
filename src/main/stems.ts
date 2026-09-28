import { join, relative } from 'node:path'
import type { StemResult } from '@shared/stems'
import { newId } from '@shared/project'
import { sleep, CancelledError } from './audio-providers/types'
import type { LocalEngineHost } from './audio-providers/local'
import { projectPath } from './project/clips'

// Separación de pistas (stems) con el motor local. El sidecar lee el clip del
// proyecto y escribe las pistas en <proyecto>/clips/stems/<id>/, todo en este equipo.

interface RemoteJob {
  id: string
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled'
  progress: number | null
  stage: string
  error: string | null
  stems?: { name: string; path: string; rms: number }[]
}

export class StemsService {
  private controllers = new Map<string, AbortController>()

  constructor(
    private readonly engine: LocalEngineHost,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly pollMs = 700
  ) {}

  private async call(path: string, init?: RequestInit): Promise<Response> {
    const res = await this.fetchImpl(`${this.engine.baseUrl}${path}`, init)
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { detail?: unknown }
      throw new Error(
        typeof body.detail === 'string' ? body.detail : `El motor local respondió ${res.status}`
      )
    }
    return res
  }

  async separate(
    requestId: string,
    dir: string,
    clipFile: string,
    onProgress: (progress: number | null, stage: string) => void
  ): Promise<StemResult[]> {
    const status = await this.engine.status()
    if (status.state === 'not-installed') {
      throw new Error(
        'Para separar pistas instala el motor local (Ajustes → Motor de audio: Local).'
      )
    }
    if ('stems' in status && !status.stems) {
      throw new Error('Falta la separación de pistas en el motor local. Añádela en Ajustes.')
    }
    const controller = new AbortController()
    this.controllers.set(requestId, controller)
    const { signal } = controller
    try {
      onProgress(null, 'Arrancando el motor local…')
      await this.engine.ensureRunning()
      const input = projectPath(dir, clipFile) // rechaza rutas fuera del proyecto
      const outRel = `clips/stems/${newId('stm')}`
      let job = (await (
        await this.call('/separations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input_path: input, output_dir: join(dir, outRel) })
        })
      ).json()) as RemoteJob

      const cancelRemote = (): void => {
        this.call(`/jobs/${job.id}`, { method: 'DELETE' }).catch(() => undefined)
      }
      signal.addEventListener('abort', cancelRemote, { once: true })
      try {
        while (job.status === 'queued' || job.status === 'running') {
          onProgress(
            job.progress,
            job.status === 'queued' ? 'En cola en el motor local' : job.stage
          )
          await sleep(this.pollMs, signal)
          job = (await (await this.call(`/jobs/${job.id}`)).json()) as RemoteJob
        }
      } finally {
        signal.removeEventListener('abort', cancelRemote)
      }
      if (job.status === 'cancelled') throw new CancelledError()
      if (job.status === 'error')
        throw new Error(`La separación falló: ${job.error ?? 'error desconocido'}`)
      return (job.stems ?? []).map((s) => ({
        name: s.name,
        file: relative(dir, s.path).split('\\').join('/'),
        rms: s.rms
      }))
    } finally {
      this.controllers.delete(requestId)
    }
  }

  cancel(requestId: string): void {
    this.controllers.get(requestId)?.abort()
  }
}
