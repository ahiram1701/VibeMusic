import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createProject, createTrack } from '@shared/project'
import {
  folderName,
  initProjectDir,
  listVersions,
  loadProject,
  loadVersion,
  newProjectDir,
  openProjectDir,
  saveProject
} from './store'

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

  it('guardados simultáneos no se pisan (cada uno recibe su propio número)', async () => {
    const p = createProject('Demo')
    await initProjectDir(dir, p)
    await Promise.all([
      saveProject(dir, { ...p, bpm: 90 }, 'A'),
      saveProject(dir, { ...p, bpm: 100 }, 'B'),
      saveProject(dir, { ...p, bpm: 110 }, 'C')
    ])
    const versions = await listVersions(dir)
    expect(versions.map((v) => v.id)).toEqual([1, 2, 3, 4])
    expect((await loadVersion(dir, 4)).bpm).toBe(110)
  })

  it('da a cada proyecto nuevo su carpeta, sin pisar nunca otra', async () => {
    expect(folderName('Mi canción: "prueba"?')).toBe('Mi canción prueba')
    expect(folderName('  ...  ')).toBe('Nueva canción')
    expect(newProjectDir(dir, 'Balada')).toBe(join(dir, 'Balada'))
    await initProjectDir(join(dir, 'Balada'), createProject('Balada'))
    await mkdir(join(dir, 'Balada (2)'))
    expect(newProjectDir(dir, 'Balada')).toBe(join(dir, 'Balada (3)'))
  })

  it('al abrir explica si la carpeta no es un proyecto o está dañado', async () => {
    await expect(openProjectDir(dir)).rejects.toThrow(/no es un proyecto de VibeMusic/)
    await writeFile(join(dir, 'project.json'), '{roto')
    await expect(openProjectDir(dir)).rejects.toThrow(/está dañado/)
    await initProjectDir(dir, createProject('Bien'))
    expect((await openProjectDir(dir)).name).toBe('Bien')
  })
})
