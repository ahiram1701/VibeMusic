import { create } from 'zustand'
import { createTrack, newId, type Clip } from '@shared/project'
import { SINGER_PROVIDER, SINGER_VOICE, type SingerEngineStatus } from '@shared/singer'
import { withDefaultMix } from '@shared/mixer'
import { engine } from '../audio/engine'
import { useProject } from './project'
import { useUi } from './ui'

// Cantante local (DiffSinger): estado del motor y la acción que canta una melodía y la
// coloca en el timeline como pista de voz.

interface SingerState {
  status: SingerEngineStatus
  log: string[]
  init(): Promise<void>
  refresh(): Promise<void>
}

let subscribed = false

export const useSinger = create<SingerState>((set, get) => ({
  status: { state: 'checking' },
  log: [],

  async init() {
    if (!subscribed) {
      subscribed = true
      window.vibe.singer.onStatus((status) => set({ status }))
      window.vibe.singer.onLog((line) => set((s) => ({ log: [...s.log, line].slice(-200) })))
    }
    await get().refresh()
  },

  async refresh() {
    set({ status: await window.vibe.singer.status() })
  }
}))

/** Nombre de la pista de la voz del cantante local. */
export const SINGER_TRACK = `Voz · ${SINGER_VOICE.name}`

/**
 * Canta el proyecto `ustx` (toda la melodía, desde el compás 1) y lo pone en la pista
 * del cantante, sustituyendo lo que tuviera. Si no existe, la crea.
 */
export async function renderSungVocal(
  ustx: string,
  opts: { messagePrefix?: string; message: string; signal?: AbortSignal }
): Promise<{ trackId: string; regionId: string }> {
  const { dir } = useProject.getState()
  if (!dir) throw new Error('No hay ningún proyecto abierto')
  const requestId = newId('sng')
  const ui = useUi.getState()
  const cancel = (): void => void window.vibe.singer.cancel(requestId)
  const taskId = ui.startTask(`Cantando con ${SINGER_VOICE.name}`, cancel)
  const off = window.vibe.singer.onProgress((id, stage) => {
    if (id === requestId) useUi.getState().updateTask(taskId, { progress: null, stage })
  })
  opts.signal?.addEventListener('abort', cancel, { once: true })
  let file: string
  try {
    ;({ file } = await window.vibe.singer.render(requestId, dir, ustx))
  } finally {
    off()
    opts.signal?.removeEventListener('abort', cancel)
    useUi.getState().endTask(taskId)
  }

  const clipId = newId('clp')
  const clip: Clip = { id: clipId, file, durationSec: 0, spec: null, provider: SINGER_PROVIDER }
  const buffer = await engine.loadClip(dir, clip)
  // Se lee el proyecto ahora: pudo cambiar mientras cantaba.
  const project = useProject.getState().project!
  const region = {
    id: newId('rgn'),
    clipId,
    startBeat: 0,
    offsetSec: 0,
    lengthSec: buffer.duration,
    fadeInSec: 0,
    fadeOutSec: 0.05
  }
  const existing = project.tracks.find((t) => t.name === SINGER_TRACK)
  const track = existing
    ? { ...existing, regions: [region] }
    : { ...withDefaultMix(createTrack(SINGER_TRACK, 'vocal')), regions: [region] }
  await useProject.getState().commit(
    {
      ...project,
      clips: { ...project.clips, [clipId]: { ...clip, durationSec: buffer.duration } },
      tracks: existing
        ? project.tracks.map((t) => (t.id === existing.id ? track : t))
        : [...project.tracks, track]
    },
    `${opts.messagePrefix ?? ''}${opts.message}`
  )
  useProject.setState((s) => ({ clipsLoaded: s.clipsLoaded + 1 }))
  return { trackId: track.id, regionId: region.id }
}
