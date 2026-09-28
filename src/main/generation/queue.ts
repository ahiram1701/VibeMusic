import { EventEmitter } from 'node:events'
import { mkdir } from 'node:fs/promises'
import { join, relative } from 'node:path'
import type { GenerationJob, ProviderId, ProviderInfo } from '@shared/generation'
import { newId, type GenerationSpec } from '@shared/project'
import { CancelledError, type AudioProvider } from '../audio-providers/types'

/**
 * Cola de generaciones. Ejecuta hasta `concurrency` trabajos a la vez, informa del
 * progreso con el evento 'update' (una copia del trabajo) y permite cancelar.
 * El resultado es un archivo en bruto en <proyecto>/clips/raw/<jobId>.*; el renderer
 * lo "conforma" (recorte a compases, volumen, fundidos) y lo añade al proyecto.
 */
export class GenerationQueue extends EventEmitter<{ update: [GenerationJob] }> {
  private jobs = new Map<string, GenerationJob>()
  private controllers = new Map<string, AbortController>()
  private running = 0

  constructor(
    private readonly providers: Map<ProviderId, AudioProvider>,
    private readonly concurrency = 2
  ) {
    super()
  }

  async providerInfo(): Promise<ProviderInfo[]> {
    return Promise.all(
      [...this.providers.values()].map(async (p) => {
        const s = await p.status()
        return {
          id: p.id,
          label: p.label,
          description: p.description,
          capabilities: p.capabilities,
          ready: s.ready,
          notReadyReason: s.reason
        }
      })
    )
  }

  enqueue(dir: string, providerId: ProviderId, spec: GenerationSpec): GenerationJob {
    const provider = this.providers.get(providerId)
    if (!provider) throw new Error(`Proveedor desconocido: ${providerId}`)
    if (spec.durationSec > provider.capabilities.maxDurationSec) {
      throw new Error(
        `${provider.label} admite como máximo ${provider.capabilities.maxDurationSec} s por generación`
      )
    }
    const job: GenerationJob = {
      id: newId('gen'),
      providerId,
      spec,
      dir,
      status: 'queued',
      progress: null,
      stage: 'En cola',
      createdAt: Date.now()
    }
    this.jobs.set(job.id, job)
    this.emitUpdate(job)
    this.pump()
    return { ...job }
  }

  cancel(jobId: string): void {
    const job = this.jobs.get(jobId)
    if (!job) return
    if (job.status === 'queued') {
      this.patch(job, { status: 'cancelled', stage: 'Cancelado' })
    } else if (job.status === 'running') {
      this.controllers.get(jobId)?.abort()
    }
  }

  list(): GenerationJob[] {
    return [...this.jobs.values()].map((j) => ({ ...j }))
  }

  private pump(): void {
    while (this.running < this.concurrency) {
      const next = [...this.jobs.values()].find((j) => j.status === 'queued')
      if (!next) return
      this.running++
      void this.run(next).finally(() => {
        this.running--
        this.pump()
      })
    }
  }

  private async run(job: GenerationJob): Promise<void> {
    const provider = this.providers.get(job.providerId)!
    const controller = new AbortController()
    this.controllers.set(job.id, controller)
    this.patch(job, { status: 'running', stage: 'Empezando…' })
    try {
      const rawDir = join(job.dir, 'clips', 'raw')
      await mkdir(rawDir, { recursive: true })
      const path = await provider.generate(job.spec, {
        signal: controller.signal,
        outBase: join(rawDir, job.id),
        onProgress: (progress, stage) => {
          if (job.status === 'running') this.patch(job, { progress, stage })
        }
      })
      const rawFile = relative(job.dir, path).split('\\').join('/')
      this.patch(job, { status: 'done', progress: 1, stage: 'Listo', rawFile })
    } catch (err) {
      if (err instanceof CancelledError || controller.signal.aborted) {
        this.patch(job, { status: 'cancelled', stage: 'Cancelado' })
      } else {
        const message = err instanceof Error ? err.message : String(err)
        this.patch(job, { status: 'error', stage: 'Error', error: message })
      }
    } finally {
      this.controllers.delete(job.id)
    }
  }

  private patch(job: GenerationJob, changes: Partial<GenerationJob>): void {
    Object.assign(job, changes)
    this.emitUpdate(job)
  }

  private emitUpdate(job: GenerationJob): void {
    this.emit('update', { ...job })
  }
}
