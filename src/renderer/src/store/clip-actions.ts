import type { ProviderId } from '@shared/generation'
import {
  newId,
  secondsToBeats,
  updateTrack,
  type Clip,
  type Project,
  type Region,
  type Track
} from '@shared/project'
import { barsToSeconds } from '@shared/prompt'
import { engine } from '../audio/engine'
import { makeExcerpt, MAX_EXCERPT_SEC } from '../audio/excerpt'
import { useGeneration } from './generation'
import { useProject } from './project'

// Acciones sobre una región existente: variación, continuación y duplicado.
// Las usan el menú contextual del timeline y el agente productor.

interface Found {
  project: Project
  dir: string
  track: Track
  region: Region
  clip: Clip
}

function find(regionId: string): Found {
  const { project, dir } = useProject.getState()
  if (!project || !dir) throw new Error('No hay ningún proyecto abierto')
  for (const track of project.tracks) {
    const region = track.regions.find((r) => r.id === regionId)
    if (region) {
      const clip = project.clips[region.clipId]
      if (!clip) throw new Error('La región no tiene audio')
      return { project, dir, track, region, clip }
    }
  }
  throw new Error(`No existe la región "${regionId}"`)
}

function pickProvider(providerId?: ProviderId): {
  id: ProviderId
  label: string
  max: number
  continues: boolean
} {
  const { providers, settings } = useGeneration.getState()
  const p =
    providers.find((x) => x.id === (providerId ?? settings?.defaultProvider)) ?? providers[0]
  if (!p) throw new Error('No hay ningún motor de audio')
  if (!p.ready) throw new Error(`${p.label} no está listo: ${p.notReadyReason ?? 'revisa Ajustes'}`)
  return {
    id: p.id,
    label: p.label,
    max: p.capabilities.maxDurationSec,
    continues: p.capabilities.supportsContinue
  }
}

const barsOf = (p: Project, sec: number): number =>
  Math.max(1, Math.round(secondsToBeats(sec, p.bpm) / p.timeSignature[0]))

export interface ActionOptions {
  /** Indicaciones extra, p. ej. "más enérgico", "sin platillos". */
  instructions?: string
  providerId?: ProviderId
  /** Prefijo en el historial (🤖 cuando lo hace el productor). */
  messagePrefix?: string
}

/**
 * Genera otra versión de una región con la misma descripción (y otra semilla),
 * opcionalmente con indicaciones extra. La nueva sustituye a la antigua en el mismo
 * sitio; con Ctrl+Z se recupera la anterior.
 */
export async function varyRegion(regionId: string, opts: ActionOptions = {}): Promise<string> {
  const { project, track, region, clip } = find(regionId)
  const extra = opts.instructions?.trim()
  const base = clip.spec?.prompt ?? extra
  if (!base) throw new Error('Este audio es importado: indica cómo quieres la variación')
  const provider = pickProvider(opts.providerId)
  return useGeneration.getState().generate({
    prompt: clip.spec && extra ? `${base}, ${extra}` : base,
    role: clip.spec?.role ?? track.role,
    bars: barsOf(project, region.lengthSec),
    providerId: provider.id,
    atBeat: region.startBeat,
    trackId: track.id,
    replaceRegionId: region.id,
    parentClipId: clip.id,
    mode: 'variation',
    messagePrefix: opts.messagePrefix,
    message: `Variación de ${track.name}${extra ? `: "${extra}"` : ''}`
  })
}

/**
 * Alarga una región con audio nuevo que continúa desde su final. Se envía al motor el
 * final de la región (hasta 8 s) para que siga tocando desde ahí; el resultado se
 * coloca justo después, en la misma pista.
 */
export async function continueRegion(
  regionId: string,
  bars: number,
  opts: ActionOptions = {}
): Promise<string> {
  const { project, dir, track, region, clip } = find(regionId)
  const provider = pickProvider(opts.providerId)
  if (!provider.continues) throw new Error(`${provider.label} no sabe continuar clips`)

  const end = region.offsetSec + region.lengthSec
  const start = Math.max(region.offsetSec, end - MAX_EXCERPT_SEC)
  const newSec = barsToSeconds(bars, project)
  if (end - start + newSec > provider.max) {
    const maxBars = Math.floor((provider.max - (end - start)) / barsToSeconds(1, project))
    throw new Error(
      `${provider.label} solo puede continuar hasta ${Math.max(0, maxBars)} compases de una vez`
    )
  }

  const buffer = engine.buffers.get(clip.id) ?? (await engine.loadClip(dir, clip))
  const excerpt = await makeExcerpt(buffer, start, end)
  const file = `clips/raw/partida-${newId('cnd')}.wav`
  await window.vibe.clips.write(dir, file, excerpt.wav)

  const extra = opts.instructions?.trim()
  const base = clip.spec?.prompt ?? `continuation of this ${track.role} part`
  return useGeneration.getState().generate({
    prompt: extra ? `${base}, ${extra}` : base,
    role: clip.spec?.role ?? track.role,
    bars,
    providerId: provider.id,
    atBeat: region.startBeat + secondsToBeats(region.lengthSec, project.bpm),
    trackId: track.id,
    parentClipId: clip.id,
    mode: 'continue',
    conditioning: { clipId: clip.id, file, seconds: excerpt.seconds },
    messagePrefix: opts.messagePrefix,
    message: `Continuación de ${track.name} (+${bars} ${bars === 1 ? 'compás' : 'compases'})`
  })
}

/** Copia la región justo a continuación (sin IA). */
export async function duplicateRegionAfter(regionId: string): Promise<void> {
  const { project, track, region } = find(regionId)
  const copy: Region = {
    ...region,
    id: newId('rgn'),
    startBeat: region.startBeat + secondsToBeats(region.lengthSec, project.bpm)
  }
  await useProject
    .getState()
    .commit(
      updateTrack(project, track.id, { regions: [...track.regions, copy] }),
      `${track.name}: región duplicada`
    )
}
