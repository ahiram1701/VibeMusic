import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { dialog } from 'electron'

// Exportación de archivos. El renderer nunca decide rutas libremente:
//   · un archivo: el usuario elige dónde en un diálogo
//   · varios (stems): el usuario elige una carpeta y el renderer recibe un "token";
//     solo puede escribir archivos (por nombre, sin rutas) dentro de esa carpeta.

export type ExportExt = 'wav' | 'mp3'

const FILTERS: Record<ExportExt, Electron.FileFilter> = {
  wav: { name: 'WAV', extensions: ['wav'] },
  mp3: { name: 'MP3', extensions: ['mp3'] }
}

/** Quita caracteres no válidos en nombres de archivo de Windows/macOS/Linux. */
export function safeFileName(name: string): string {
  const clean = name
    // Los caracteres de control (0–31) no son válidos en nombres de archivo: se quitan a propósito.
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/, '')
    .trim()
  return clean.slice(0, 120) || 'sin nombre'
}

export async function saveFileDialog(
  bytes: Uint8Array,
  suggestedName: string,
  ext: ExportExt
): Promise<string | null> {
  const res = await dialog.showSaveDialog({
    title: 'Exportar',
    defaultPath: `${safeFileName(suggestedName)}.${ext}`,
    filters: [FILTERS[ext]]
  })
  if (res.canceled || !res.filePath) return null
  await writeFile(res.filePath, bytes)
  return res.filePath
}

export class ExportFolders {
  private folders = new Map<string, string>()

  async choose(): Promise<{ token: string; path: string } | null> {
    const res = await dialog.showOpenDialog({
      title: 'Carpeta donde guardar las pistas',
      properties: ['openDirectory', 'createDirectory']
    })
    if (res.canceled || !res.filePaths[0]) return null
    const token = randomUUID()
    this.folders.set(token, res.filePaths[0])
    return { token, path: res.filePaths[0] }
  }

  /** Escribe `fileName` (solo nombre, sin carpetas) dentro de la carpeta del token. */
  async write(token: string, fileName: string, bytes: Uint8Array): Promise<string> {
    const folder = this.folders.get(token)
    if (!folder) throw new Error('Carpeta de exportación no válida o caducada')
    const name = safeFileName(basename(fileName))
    const full = join(folder, name)
    await writeFile(full, bytes)
    return full
  }
}
