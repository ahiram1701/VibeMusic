import { describe, expect, it } from 'vitest'
import { createProject, createTrack, type Clip, type Project, type Region } from './project'
import { planRetempo } from './retempo'

function clip(id: string, bpm: number | null, durationSec: number): Clip {
  return {
    id,
    file: `clips/${id}.wav`,
    durationSec,
    spec:
      bpm === null
        ? null
        : { prompt: id, bpm, key: 'C minor', durationSec, role: 'drums', mode: 'text' },
    provider: bpm === null ? 'import' : 'demo'
  }
}

const region = (id: string, clipId: string, startBeat: number, lengthSec: number): Region => ({
  id,
  clipId,
  startBeat,
  offsetSec: 0,
  lengthSec,
  fadeInSec: 0,
  fadeOutSec: 0
})

/** 120 BPM: un clip generado de 2 compases (4 s) repetido, y un audio importado. */
function song(): Project {
  const p = createProject('t')
  return {
    ...p,
    bpm: 120,
    clips: { gen: clip('gen', 120, 4), imp: clip('imp', null, 3) },
    tracks: [
      {
        ...createTrack('Drums', 'drums'),
        regions: [region('r1', 'gen', 0, 4), region('r2', 'gen', 8, 4)]
      },
      { ...createTrack('Voz', 'vocal'), regions: [region('r3', 'imp', 0, 3)] }
    ]
  }
}

describe('planRetempo', () => {
  it('estira los clips generados para que ocupen los mismos compases', () => {
    const plan = planRetempo(song(), 90)
    expect(plan.project.bpm).toBe(90)
    expect(plan.jobs).toHaveLength(1) // un clip usado por dos regiones: se estira una vez
    expect(plan.jobs[0]).toMatchObject({ sourceClipId: 'gen', ratio: 120 / 90, bpm: 90 })

    const [r1, r2] = plan.project.tracks[0].regions
    expect(r1.clipId).toBe(plan.jobs[0].newClipId)
    expect(r2.clipId).toBe(r1.clipId)
    expect(r1.lengthSec).toBeCloseTo(4 * (120 / 90)) // 2 compases a 90 BPM
    expect(r2.startBeat).toBe(8) // mismo compás

    const stretched = plan.project.clips[r1.clipId]
    expect(stretched.spec?.bpm).toBe(90)
    expect(stretched.original).toEqual({ clipId: 'gen', bpm: 120 })
  })

  it('no toca el audio importado (no se sabe su tempo) y lo informa', () => {
    const original = song()
    const plan = planRetempo(original, 90)
    expect(plan.project.tracks[1].regions[0]).toEqual(original.tracks[1].regions[0])
    expect(plan.skipped).toEqual(['imp'])
  })

  it('siempre parte del original y al volver al tempo original lo reutiliza intacto', () => {
    const at90 = planRetempo(song(), 90).project
    const at110 = planRetempo(at90, 110)
    expect(at110.jobs[0]).toMatchObject({ sourceClipId: 'gen', ratio: 120 / 110 })

    const back = planRetempo(at110.project, 120)
    expect(back.jobs).toHaveLength(0)
    expect(back.project.tracks[0].regions.map((r) => r.clipId)).toEqual(['gen', 'gen'])
    expect(back.project.tracks[0].regions[0].lengthSec).toBeCloseTo(4)
  })

  it('sin cambio de tempo no hace nada', () => {
    const original = song()
    const plan = planRetempo(original, 120)
    expect(plan.jobs).toHaveLength(0)
    expect(plan.project.tracks).toEqual(original.tracks)
  })
})
