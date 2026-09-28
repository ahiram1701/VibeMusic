import { create } from 'zustand'
import type { Mp3Bitrate } from '@shared/mp3'
import type { Project } from '@shared/project'
import { sectionRangeSec, sectionsOf } from '@shared/sections'
import { encodeWav } from '@shared/wav'
import { renderOffline, type RenderOptions } from '../audio/engine'
import type { Mp3Message, Mp3Request } from '../audio/mp3.worker'
import { useProject } from './project'

export type ExportFormat = 'wav' | 'mp3'

export interface ExportOptions {
  format: ExportFormat
  kbps: Mp3Bitrate
  /** 'mix' = un archivo con la mezcla; 'stems' = un archivo por pista. */
  target: 'mix' | 'stems'
  /** null = canción entera; o el id de una sección. */
  sectionId: string | null
}

interface ExportState {
  /** Últimas opciones elegidas: el diálogo se abre con ellas. */
  last: Omit<ExportOptions, 'sectionId'>
  busy: boolean
  /** Texto de progreso, p. ej. "Codificando Batería (2/4) · 40 %". */
  status: string
  run(opts: ExportOptions): Promise<string | null>
}

/** Codifica a MP3 en un Web Worker (no congela la interfaz). */
function mp3InWorker(req: Mp3Request, onProgress: (f: number) => void): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../audio/mp3.worker.ts', import.meta.url), {
      type: 'module'
    })
    worker.onmessage = (e: MessageEvent<Mp3Message>) => {
      const msg = e.data
      if (msg.type === 'progress') onProgress(msg.fraction)
      else {
        worker.terminate()
        if (msg.type === 'done') resolve(msg.mp3)
        else reject(new Error(`No se pudo codificar el MP3: ${msg.message}`))
      }
    }
    worker.onerror = (e) => {
      worker.terminate()
      reject(new Error(`No se pudo codificar el MP3: ${e.message}`))
    }
    worker.postMessage(req)
  })
}

async function encode(
  buffer: AudioBuffer,
  opts: ExportOptions,
  onProgress: (f: number) => void
): Promise<Uint8Array> {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) =>
    buffer.getChannelData(i)
  )
  if (opts.format === 'wav') return encodeWav(channels, buffer.sampleRate)
  // Copias: los datos se envían al worker y el AudioBuffer debe seguir siendo válido.
  return mp3InWorker(
    { channels: channels.map((c) => c.slice()), sampleRate: buffer.sampleRate, kbps: opts.kbps },
    onProgress
  )
}

function rangeOf(project: Project, sectionId: string | null): RenderOptions['range'] {
  if (!sectionId) return undefined
  const section = sectionsOf(project).find((s) => s.id === sectionId)
  if (!section) throw new Error('La sección ya no existe')
  return sectionRangeSec(project, section)
}

export const useExport = create<ExportState>((set) => ({
  last: { format: 'mp3', kbps: 320, target: 'mix' },
  busy: false,
  status: '',

  async run(opts) {
    const project = useProject.getState().project
    if (!project) return null
    set({
      busy: true,
      status: 'Preparando…',
      last: { format: opts.format, kbps: opts.kbps, target: opts.target }
    })
    try {
      const range = rangeOf(project, opts.sectionId)
      const sectionName = opts.sectionId
        ? sectionsOf(project).find((s) => s.id === opts.sectionId)?.name
        : undefined
      const baseName = sectionName ? `${project.name} - ${sectionName}` : project.name
      const pct = (f: number): string => `${Math.round(f * 100)} %`

      if (opts.target === 'mix') {
        set({ status: 'Mezclando…' })
        const buffer = await renderOffline(project, { range })
        const bytes = await encode(buffer, opts, (f) =>
          set({ status: `Codificando MP3 · ${pct(f)}` })
        )
        set({ status: 'Guardando…' })
        return await window.vibe.export.saveFile(bytes, baseName, opts.format)
      }

      // Stems: un archivo por pista (sin las silenciadas ni las vacías).
      const tracks = project.tracks.filter((t) => !t.mute && t.regions.length > 0)
      if (tracks.length === 0) throw new Error('No hay pistas con audio para exportar')
      const folder = await window.vibe.export.chooseFolder()
      if (!folder) return null
      const used = new Set<string>()
      for (const [i, track] of tracks.entries()) {
        const label = `${track.name} (${i + 1}/${tracks.length})`
        set({ status: `Mezclando ${label}…` })
        const buffer = await renderOffline(project, { range, trackId: track.id })
        const bytes = await encode(buffer, opts, (f) =>
          set({ status: `Codificando ${label} · ${pct(f)}` })
        )
        // Dos pistas con el mismo nombre no deben pisarse.
        let name = `${baseName} - ${String(i + 1).padStart(2, '0')} ${track.name}`
        while (used.has(name)) name += ' (2)'
        used.add(name)
        await window.vibe.export.writeInFolder(folder.token, `${name}.${opts.format}`, bytes)
      }
      return folder.path
    } finally {
      set({ busy: false, status: '' })
    }
  }
}))
