import type { Project } from './project'

// Deshacer / Rehacer de la sesión.
// Cada entrada guarda el proyecto *antes* (en undo) o *después* (en redo) de un cambio,
// junto con el mensaje de ese cambio. Deshacer/rehacer también crea versiones en disco,
// así el historial nunca pierde información.

export interface HistoryEntry {
  project: Project
  message: string
}

export interface UndoState {
  undo: HistoryEntry[]
  redo: HistoryEntry[]
}

export const MAX_UNDO = 200

export const emptyUndo: UndoState = { undo: [], redo: [] }

/** Registra un cambio normal: se puede deshacer y se descarta lo que hubiera para rehacer. */
export function recordChange(state: UndoState, before: Project, message: string): UndoState {
  return { undo: [...state.undo, { project: before, message }].slice(-MAX_UNDO), redo: [] }
}

/** Saca el último cambio para deshacerlo. `current` pasa a la pila de rehacer. */
export function takeUndo(
  state: UndoState,
  current: Project
): { state: UndoState; entry: HistoryEntry } | null {
  const entry = state.undo.at(-1)
  if (!entry) return null
  return {
    entry,
    state: {
      undo: state.undo.slice(0, -1),
      redo: [...state.redo, { project: current, message: entry.message }]
    }
  }
}

/** Vuelve a aplicar el último cambio deshecho. `current` vuelve a la pila de deshacer. */
export function takeRedo(
  state: UndoState,
  current: Project
): { state: UndoState; entry: HistoryEntry } | null {
  const entry = state.redo.at(-1)
  if (!entry) return null
  return {
    entry,
    state: {
      undo: [...state.undo, { project: current, message: entry.message }],
      redo: state.redo.slice(0, -1)
    }
  }
}

/** Quita prefijos acumulados ("Vuelta a v8: Deshacer: …") para que los mensajes no se encadenen. */
export function baseMessage(message: string): string {
  return message.replace(/^((Restaurada|Vuelta a) v\d+: |Deshacer: |Rehacer: )+/, '')
}
