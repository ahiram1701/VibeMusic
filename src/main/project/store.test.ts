import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createProject, createTrack } from '@shared/project'
import { initProjectDir, listVersions, loadProject, loadVersion, saveProject } from './store'

describe('project store', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'vibe-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('crea el proyecto con una primera versión', async () => {
    const p = createProject('Demo')
    const meta = await initProjectDir(dir, p)
    expect(meta.id).toBe(1)
    expect(await loadProject(dir)).toEqual(p)
  })

  it('versiona cada guardado y permite volver atrás', async () => {
    const p = createProject('Demo')
    await initProjectDir(dir, p)
    const withBass = { ...p, tracks: [createTrack('Bass', 'bass')] }
    await saveProject(dir, withBass, 'Añadida pista Bass')

    const versions = await listVersions(dir)
    expect(versions.map((v) => v.message)).toEqual(['Proyecto creado', 'Añadida pista Bass'])
    expect((await loadVersion(dir, 1)).tracks).toHaveLength(0)
    expect((await loadProject(dir)).tracks).toHaveLength(1)
  })
})
