// Batería programada en el proyecto abierto: genera el plan de golpes (shared/drums.ts),
// lo sintetiza sección a sección (shared/drum-synth.ts) en segundos, guarda un WAV por
// sección y pone la pista con la cama automatizada (shared/production.ts).

import { renderDrums } from '@shared/drum-synth'
import { drumPlan, findPattern, kickBeats } from '@shared/drums'
import { withDrumTrack, withoutDrums } from '@shared/production'
import { newId, type Clip } from '@shared/project'
import { sectionsOf } from '@shared/sections'
import { encodeWav } from '@shared/wav'
import { engine, SAMPLE_RATE } from '../audio/engine'
import { useProject } from './project'

export interface DrumsResult {
  trackId: string
  pattern: string
  sections: number
}

/**
 * Pone o rehace la batería de toda la canción con `pattern` e `intensity` (−2…+2), y el
 * sidechain de `bedTrackId` (la pista de la cama) a su bombo.
 */
export async function applyDrums(opts: {
  pattern: string
  intensity?: number
  bedTrackId: string | null
  message: string
}): Promise<DrumsResult> {
  const { dir, project } = useProject.getState()
  if (!dir || !project) throw new Error('No hay ningún proyecto abierto')
  const pattern = findPattern(opts.pattern)
  if (!pattern) throw new Error(`No existe el patrón de batería "${opts.pattern}"`)
  const sections = sectionsOf(project)
  if (sections.length === 0)
    throw new Error('La canción no tiene secciones: crea la estructura antes')
  const intensity = Math.max(-2, Math.min(2, Math.round(opts.intensity ?? 0)))
  const perBar = project.timeSignature[0]
  const hits = drumPlan(sections, perBar, pattern, { intensity })

  const clips: Clip[] = []
  for (const s of sections) {
    const channels = renderDrums(hits, {
      sampleRate: SAMPLE_RATE,
      bpm: project.bpm,
      fromBeat: (s.startBar - 1) * perBar,
      lengthBeats: s.bars * perBar
    })
    const id = newId('clp')
    const file = `clips/${id}.wav`
    await window.vibe.clips.write(dir, file, encodeWav(channels, SAMPLE_RATE))
    const buffer = engine.ctx.createBuffer(2, channels[0].length, SAMPLE_RATE)
    channels.forEach((ch, i) => buffer.copyToChannel(ch as Float32Array<ArrayBuffer>, i))
    engine.buffers.set(id, buffer)
    clips.push({ id, file, durationSec: buffer.duration, spec: null, provider: 'drums' })
  }

  // Se lee el proyecto de nuevo tras escribir los archivos: pudo cambiar mientras tanto.
  const now = useProject.getState().project!
  const next = withDrumTrack(now, {
    pattern: pattern.id,
    intensity,
    sections,
    clips,
    kicks: kickBeats(hits),
    bedTrackId: opts.bedTrackId
  })
  await useProject.getState().commit(next, opts.message)
  useProject.setState((s) => ({ clipsLoaded: s.clipsLoaded + 1 }))
  const track = next.tracks.find((t) => t.drums)!
  return { trackId: track.id, pattern: pattern.id, sections: sections.length }
}

/** Quita la batería programada (y el sidechain que provocaba en la cama). */
export async function removeDrums(message: string): Promise<void> {
  const { project } = useProject.getState()
  if (!project) throw new Error('No hay ningún proyecto abierto')
  await useProject.getState().commit(withoutDrums(project), message)
}
