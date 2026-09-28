import { newId, type Clip, type Project } from './project'

// Cambio de tempo con ajuste del audio.
// Cada clip generado sabe a qué BPM se creó (spec.bpm). Al cambiar el tempo del
// proyecto, se estira o encoge para que siga ocupando los mismos compases.
// Siempre se parte del clip ORIGINAL (no de una copia ya estirada): así, cambiar
// varias veces de tempo no acumula pérdidas, y volver al tempo original recupera
// el audio intacto.

/** Un clip que hay que crear estirando otro. */
export interface StretchJob {
  /** Id del clip nuevo (el estirado). */
  newClipId: string
  /** Clip original desde el que se estira. */
  sourceClipId: string
  /** Duración de salida / duración de entrada. */
  ratio: number
  bpm: number
}

export interface RetempoPlan {
  /** Proyecto resultante (con los clips nuevos ya referenciados). */
  project: Project
  jobs: StretchJob[]
  /** Clips que no se pueden ajustar (audio importado: no se sabe su tempo). */
  skipped: string[]
}

/** BPM "de fábrica" de un clip y el clip original del que viene. */
function origin(clip: Clip): { clipId: string; bpm: number } | null {
  if (clip.original) return clip.original
  if (clip.spec) return { clipId: clip.id, bpm: clip.spec.bpm }
  return null
}

/** BPM al que suena ahora mismo un clip (null si es audio importado). */
function currentBpm(clip: Clip): number | null {
  return clip.spec?.bpm ?? null
}

export function planRetempo(project: Project, bpm: number): RetempoPlan {
  const usedClipIds = new Set(project.tracks.flatMap((t) => t.regions.map((r) => r.clipId)))
  const clips = { ...project.clips }
  const jobs: StretchJob[] = []
  const skipped: string[] = []
  /** Clip actual → clip que lo sustituye al nuevo tempo. */
  const replacement = new Map<string, string>()

  for (const clipId of usedClipIds) {
    const clip = project.clips[clipId]
    if (!clip) continue
    const from = origin(clip)
    const now = currentBpm(clip)
    if (!from || now === null) {
      skipped.push(clipId)
      continue
    }
    if (now === bpm) continue

    if (from.bpm === bpm && project.clips[from.clipId]) {
      // Volvemos al tempo original: se reutiliza el clip original tal cual.
      replacement.set(clipId, from.clipId)
      continue
    }
    const original = project.clips[from.clipId] ?? clip
    const newClipId = newId('clp')
    const ratio = from.bpm / bpm
    jobs.push({ newClipId, sourceClipId: from.clipId, ratio, bpm })
    clips[newClipId] = {
      id: newClipId,
      file: `clips/${newClipId}.wav`,
      durationSec: original.durationSec * ratio,
      spec: original.spec
        ? { ...original.spec, bpm, durationSec: original.durationSec * ratio }
        : null,
      provider: original.provider,
      parentClipId: clip.id,
      original: from
    }
    replacement.set(clipId, newClipId)
  }

  const tracks = project.tracks.map((t) => ({
    ...t,
    regions: t.regions.map((r) => {
      const to = replacement.get(r.clipId)
      if (!to) return r
      // La región sigue en el mismo compás (startBeat no cambia); su duración y
      // desplazamiento en segundos se escalan con el tempo.
      const scale = currentBpm(project.clips[r.clipId])! / bpm
      return {
        ...r,
        clipId: to,
        offsetSec: r.offsetSec * scale,
        lengthSec: r.lengthSec * scale,
        fadeInSec: r.fadeInSec * scale,
        fadeOutSec: r.fadeOutSec * scale
      }
    })
  }))

  return { project: { ...project, bpm, clips, tracks }, jobs, skipped }
}
