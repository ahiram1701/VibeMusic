import { create } from 'zustand'
import type { GridResolution } from '@shared/timeline'

/** Tarea larga en curso (p. ej. separar pistas), con progreso y cancelar. */
export interface Task {
  id: string
  label: string
  stage: string
  progress: number | null
  cancel?: () => void
}

interface UiState {
  tasks: Task[]
  startTask(label: string, cancel?: () => void): string
  updateTask(id: string, patch: Partial<Pick<Task, 'stage' | 'progress'>>): void
  endTask(id: string): void
  grid: GridResolution
  pxPerBeat: number
  selectedRegionId: string | null
  /** Menú contextual abierto sobre una región (posición en pantalla). */
  regionMenu: { regionId: string; x: number; y: number } | null
  /** Aviso breve en pantalla (errores de acciones, confirmaciones). */
  toast: { text: string; tone: 'error' | 'info' } | null
  setGrid(grid: GridResolution): void
  zoom(factor: number): void
  select(regionId: string | null): void
  openRegionMenu(regionId: string, x: number, y: number): void
  closeRegionMenu(): void
  notify(text: string, tone?: 'error' | 'info'): void
}

let toastTimer: ReturnType<typeof setTimeout> | undefined
let taskCounter = 0

export const useUi = create<UiState>((set) => ({
  tasks: [],
  startTask: (label, cancel) => {
    const id = `task_${++taskCounter}`
    set((s) => ({
      tasks: [...s.tasks, { id, label, stage: 'Empezando…', progress: null, cancel }]
    }))
    return id
  },
  updateTask: (id, patch) =>
    set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
  endTask: (id) => set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) })),
  grid: 'beat',
  pxPerBeat: 24,
  selectedRegionId: null,
  regionMenu: null,
  toast: null,
  setGrid: (grid) => set({ grid }),
  zoom: (factor) => set((s) => ({ pxPerBeat: Math.min(200, Math.max(4, s.pxPerBeat * factor)) })),
  select: (selectedRegionId) => set({ selectedRegionId }),
  openRegionMenu: (regionId, x, y) =>
    set({ regionMenu: { regionId, x, y }, selectedRegionId: regionId }),
  closeRegionMenu: () => set({ regionMenu: null }),
  notify: (text, tone = 'info') => {
    clearTimeout(toastTimer)
    set({ toast: { text, tone } })
    toastTimer = setTimeout(() => set({ toast: null }), tone === 'error' ? 7000 : 3500)
  }
}))
