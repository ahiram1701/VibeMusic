import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Project, VersionMeta } from '@shared/project'

// Layout en disco de un proyecto:
//   <dir>/project.json          estado actual
//   <dir>/versions/<n>.json     snapshot + meta de cada versión
//   <dir>/clips/<clipId>.wav    audio generado o importado

interface VersionFile {
  meta: VersionMeta
  project: Project
}

const versionsDir = (dir: string): string => join(dir, 'versions')

export async function initProjectDir(dir: string, project: Project): Promise<VersionMeta> {
  await mkdir(join(dir, 'clips'), { recursive: true })
  await mkdir(versionsDir(dir), { recursive: true })
  return saveProject(dir, project, 'Proyecto creado')
}

export async function loadProject(dir: string): Promise<Project> {
  const raw = await readFile(join(dir, 'project.json'), 'utf8')
  return JSON.parse(raw) as Project
}

export async function listVersions(dir: string): Promise<VersionMeta[]> {
  const files = await readdir(versionsDir(dir)).catch(() => [] as string[])
  const metas = await Promise.all(
    files
      .filter((f) => f.endsWith('.json'))
      .map(async (f) => {
        const v = JSON.parse(await readFile(join(versionsDir(dir), f), 'utf8')) as VersionFile
        return v.meta
      })
  )
  return metas.sort((a, b) => a.id - b.id)
}

export async function saveProject(
  dir: string,
  project: Project,
  message: string
): Promise<VersionMeta> {
  const versions = await listVersions(dir)
  const meta: VersionMeta = {
    id: (versions.at(-1)?.id ?? 0) + 1,
    createdAt: new Date().toISOString(),
    message
  }
  const file: VersionFile = { meta, project }
  await writeFile(join(versionsDir(dir), `${meta.id}.json`), JSON.stringify(file, null, 2))
  await writeFile(join(dir, 'project.json'), JSON.stringify(project, null, 2))
  return meta
}

export async function loadVersion(dir: string, versionId: number): Promise<Project> {
  const raw = await readFile(join(versionsDir(dir), `${versionId}.json`), 'utf8')
  return (JSON.parse(raw) as VersionFile).project
}
