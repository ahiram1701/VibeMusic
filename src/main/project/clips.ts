import { copyFile, readFile, writeFile } from 'node:fs/promises'
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path'
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

/** Lee un clip del proyecto. Rechaza rutas que escapen de la carpeta del proyecto. */
export async function readClip(dir: string, file: string): Promise<Uint8Array> {
  const root = resolve(dir)
  const full = resolve(root, file)
  const rel = relative(root, full)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Ruta de clip fuera del proyecto: ${file}`)
  }
  return readFile(full)
}

export async function saveWavDialog(
  bytes: Uint8Array,
  suggestedName: string
): Promise<string | null> {
  const res = await dialog.showSaveDialog({
    title: 'Exportar mezcla',
    defaultPath: `${suggestedName}.wav`,
    filters: [{ name: 'WAV', extensions: ['wav'] }]
  })
  if (res.canceled || !res.filePath) return null
  await writeFile(res.filePath, bytes)
  return res.filePath
}
