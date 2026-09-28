import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { dialog } from 'electron'
import type { ImportedFile } from '@shared/ipc-contract'
import { newId } from '@shared/project'

const AUDIO_EXTENSIONS = ['wav', 'mp3', 'flac', 'ogg', 'm4a']

export async function importAudio(dir: string): Promise<ImportedFile[]> {
  const res = await dialog.showOpenDialog({
    title: 'Importar audio',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Audio', extensions: AUDIO_EXTENSIONS }]
  })
  if (res.canceled) return []

  return Promise.all(
    res.filePaths.map(async (src) => {
      const clipId = newId('clp')
      const file = `clips/${clipId}${extname(src).toLowerCase()}`
      await copyFile(src, join(dir, file))
      return { clipId, file, name: basename(src, extname(src)) }
    })
  )
}

/** Resuelve una ruta dentro del proyecto. Rechaza rutas que escapen de su carpeta. */
function projectPath(dir: string, file: string): string {
  const root = resolve(dir)
  const full = resolve(root, file)
  const rel = relative(root, full)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Ruta de clip fuera del proyecto: ${file}`)
  }
  return full
}

export async function readClip(dir: string, file: string): Promise<Uint8Array> {
  return readFile(projectPath(dir, file))
}

export async function writeClip(dir: string, file: string, bytes: Uint8Array): Promise<void> {
  const full = projectPath(dir, file)
  await mkdir(dirname(full), { recursive: true })
  await writeFile(full, bytes)
}
