import type { ProviderId } from '@shared/generation'
import { SILENT_RMS, STEM_INFO, STEM_ORDER } from '@shared/stems'
import {
  createTrack,
  newId,
  secondsToBeats,
  updateTrack,
  type Clip,
  type Project,
  type Region,
  type Track
} from '@shared/project'
import { barsToSeconds } from '@shared/prompt'
import { crossfadeSeconds } from '@shared/arrange'
import { engine } from '../audio/engine'
import { makeExcerpt, MAX_EXCERPT_SEC } from '../audio/excerpt'
import { useGeneration } from './generation'
import { useProject } from './project'
import { useUi } from './ui'

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
export interface ContinueOptions extends ActionOptions {
  /** Descripción completa del audio nuevo (sustituye a la del clip original). */
  prompt?: string
  /** Dónde colocarlo (por defecto, justo después de la región). */
  atBeat?: number
  /** Texto del cambio en el historial. */
  message?: string
  /**
   * Fundirse con el final de la región (por defecto sí). No, si el audio nuevo se
   * coloca en otro sitio: se fundiría con algo que no está sonando.
   */
  crossfade?: boolean
}

export async function continueRegion(
  regionId: string,
  bars: number,
  opts: ContinueOptions = {}
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
  const base = opts.prompt?.trim() || clip.spec?.prompt || `continuation of this ${track.role} part`
  return useGeneration.getState().generate({
    prompt: extra ? `${base}, ${extra}` : base,
    role: clip.spec?.role ?? track.role,
    bars,
    providerId: provider.id,
    atBeat: opts.atBeat ?? region.startBeat + secondsToBeats(region.lengthSec, project.bpm),
    trackId: track.id,
    parentClipId: clip.id,
    mode: 'continue',
    conditioning: { clipId: clip.id, file, seconds: excerpt.seconds },
    ...(opts.crossfade !== false && {
      crossfadeSec: Math.min(crossfadeSeconds(project.bpm), excerpt.seconds)
    }),
    messagePrefix: opts.messagePrefix,
    message:
      opts.message ??
      `Continuación de ${track.name} (+${bars} ${bars === 1 ? 'compás' : 'compases'})`
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

/**
 * Separa el audio de una región en pistas (voz, batería, bajo, otros) con el motor
 * local. Las pistas nuevas aparecen debajo de la original, alineadas con ella, y la
 * original se silencia (no se borra). Las pistas vacías (p. ej. sin voz) se omiten.
 */
export async function separateRegion(
  regionId: string,
  opts: Pick<ActionOptions, 'messagePrefix'> = {}
): Promise<{ trackIds: string[]; stems: string[]; skipped: string[] }> {
  const { dir, track, region, clip } = find(regionId)
  const ui = useUi.getState()
  const requestId = newId('sep')
  const taskId = ui.startTask(
    `Separando ${track.name}`,
    () => void window.vibe.stems.cancel(requestId)
  )
  const off = window.vibe.stems.onProgress((id, progress, stage) => {
    if (id === requestId) useUi.getState().updateTask(taskId, { progress, stage })
  })
  let results
  try {
    results = await window.vibe.stems.separate(requestId, dir, clip.file)
  } finally {
    off()
    useUi.getState().endTask(taskId)
  }

  const ordered = STEM_ORDER.map((name) => results.find((r) => r.name === name)).filter(
    (r): r is NonNullable<typeof r> => !!r
  )
  const kept = ordered.filter((r) => r.rms >= SILENT_RMS)
  const skipped = ordered
    .filter((r) => r.rms < SILENT_RMS)
    .map((r) => STEM_INFO[r.name]?.label ?? r.name)
  if (kept.length === 0) throw new Error('No se encontró nada que separar en este audio')

  // Se lee el proyecto ahora: pudo cambiar mientras se separaba.
  const project = useProject.getState().project!
  const clips = { ...project.clips }
  const newTracks = []
  for (const stem of kept) {
    const info = STEM_INFO[stem.name] ?? { label: stem.name, role: track.role }
    const clipId = newId('clp')
    const stemClip: Clip = {
      id: clipId,
      file: stem.file,
      durationSec: 0,
      spec: null,
      provider: 'demucs',
      parentClipId: clip.id
    }
    const buffer = await engine.loadClip(dir, stemClip)
    clips[clipId] = { ...stemClip, durationSec: buffer.duration }
    newTracks.push({
      ...createTrack(`${track.name} · ${info.label}`, info.role),
      regions: [{ ...region, id: newId('rgn'), clipId }]
    })
  }
  const at = project.tracks.findIndex((t) => t.id === track.id)
  const tracks = project.tracks.map((t) => (t.id === track.id ? { ...t, mute: true } : t))
  tracks.splice(at + 1, 0, ...newTracks)
  const labels = kept.map((r) => STEM_INFO[r.name]?.label ?? r.name)
  await useProject
    .getState()
    .commit(
      { ...project, clips, tracks },
      `${opts.messagePrefix ?? ''}Separado ${track.name} en ${kept.length} pistas: ${labels.join(', ')}`
    )
  useProject.setState((s) => ({ clipsLoaded: s.clipsLoaded + 1 }))
  return { trackIds: newTracks.map((t) => t.id), stems: labels, skipped }
}

/**
 * "Cantar con mi voz": convierte la voz de una región (una pista de voz, p. ej. la que
 * sale de separar una canción) al timbre de un modelo RVC del usuario. El resultado va
 * en una pista nueva justo debajo y la original se silencia (se puede comparar).
 */
export async function convertVoiceRegion(
  regionId: string,
  opts: { voiceId: string; voiceName: string; pitch?: number } & Pick<
    ActionOptions,
    'messagePrefix'
  >
): Promise<{ trackId: string; regionId: string }> {
  const { dir, track, region, clip } = find(regionId)
  const ui = useUi.getState()
  const requestId = newId('vox')
  const taskId = ui.startTask(
    `Cantando con ${opts.voiceName}`,
    () => void window.vibe.voice.cancel(requestId)
  )
  const off = window.vibe.voice.onProgress((id, stage) => {
    if (id === requestId) useUi.getState().updateTask(taskId, { progress: null, stage })
  })
  let file: string
  try {
    ;({ file } = await window.vibe.voice.convert(requestId, dir, clip.file, opts.voiceId, {
      pitch: opts.pitch ?? 0
    }))
  } finally {
    off()
    useUi.getState().endTask(taskId)
  }

  const clipId = newId('clp')
  const voiceClip: Clip = {
    id: clipId,
    file,
    durationSec: 0,
    spec: null,
    provider: 'rvc',
    parentClipId: clip.id
  }
  const buffer = await engine.loadClip(dir, voiceClip)
  // Se lee el proyecto ahora: pudo cambiar mientras se convertía.
  const project = useProject.getState().project!
  const newTrack = {
    ...createTrack(`Voz · ${opts.voiceName}`, 'vocal'),
    regions: [{ ...region, id: newId('rgn'), clipId }]
  }
  const at = project.tracks.findIndex((t) => t.id === track.id)
  const tracks = project.tracks.map((t) => (t.id === track.id ? { ...t, mute: true } : t))
  tracks.splice(at + 1, 0, newTrack)
  await useProject.getState().commit(
    {
      ...project,
      clips: { ...project.clips, [clipId]: { ...voiceClip, durationSec: buffer.duration } },
      tracks
    },
    `${opts.messagePrefix ?? ''}${track.name} cantada con ${opts.voiceName}`
  )
  useProject.setState((s) => ({ clipsLoaded: s.clipsLoaded + 1 }))
  return { trackId: newTrack.id, regionId: newTrack.regions[0].id }
}
