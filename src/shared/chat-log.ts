// La conversación con el productor se guarda en el proyecto (chat.json): al volver a
// abrirlo, o si la ventana se recarga a mitad de una canción, sigue ahí. Puro para
// probarlo; el renderer solo lee y escribe el archivo.

import type { LlmMessage } from './llm'

export const CHAT_FILE = 'chat.json'

/** Lo mínimo que se mira de un mensaje del chat (el tipo completo vive en el renderer). */
interface SavedItem {
  kind: string
  status?: string
  [key: string]: unknown
}

export function serializeChat(items: readonly SavedItem[], history: readonly LlmMessage[]): string {
  return JSON.stringify({ version: 1, items, history })
}

/**
 * Lee una conversación guardada, o null si el archivo no es válido. Una herramienta
 * que se quedó "en curso" (la app se cerró a mitad) se marca como interrumpida.
 */
export function parseSavedChat<T extends SavedItem>(
  text: string
): { items: T[]; history: LlmMessage[] } | null {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  const saved = data as { version?: unknown; items?: unknown; history?: unknown }
  if (saved?.version !== 1 || !Array.isArray(saved.items) || !Array.isArray(saved.history)) {
    return null
  }
  const items = (saved.items as T[]).map((i) =>
    i.kind === 'tool' && i.status === 'running'
      ? { ...i, status: 'error', result: 'Se interrumpió (la app se cerró o se recargó).' }
      : i
  )
  return { items, history: saved.history as LlmMessage[] }
}
