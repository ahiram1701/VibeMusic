import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { folderName, type Project, type VersionMeta } from '@shared/project'

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

export { folderName }

export const isProjectDir = (dir: string): boolean => existsSync(join(dir, 'project.json'))

/**
 * Carpeta para un proyecto nuevo dentro de `parent`: "<nombre>", o "<nombre> (2)"… si ya
 * existe. Nunca devuelve una carpeta ocupada, así que crear no pisa nada.
 */
export function newProjectDir(parent: string, name: string): string {
  const base = folderName(name)
  let dir = join(parent, base)
  for (let n = 2; existsSync(dir); n++) dir = join(parent, `${base} (${n})`)
  return dir
}

/** Abre un proyecto o explica por qué esa carpeta no lo es. */
export async function openProjectDir(dir: string): Promise<Project> {
  if (!isProjectDir(dir)) {
    throw new Error(
      `"${basename(dir)}" no es un proyecto de VibeMusic (no tiene project.json). Elige la carpeta del proyecto, la que se creó con "Nuevo proyecto".`
    )
  }
  try {
    return await loadProject(dir)
  } catch {
    throw new Error(`El proyecto "${basename(dir)}" está dañado: no se pudo leer su project.json.`)
  }
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

// Una cola de guardados por proyecto. Sin ella, dos guardados simultáneos leen
// la misma "última versión", calculan el mismo id y el segundo pisa al primero.
const saveQueues = new Map<string, Promise<unknown>>()

export function saveProject(dir: string, project: Project, message: string): Promise<VersionMeta> {
  const previous = saveQueues.get(dir) ?? Promise.resolve()
  const next = previous.catch(() => undefined).then(() => writeVersion(dir, project, message))
  saveQueues.set(dir, next)
  return next
}

async function writeVersion(dir: string, project: Project, message: string): Promise<VersionMeta> {
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
