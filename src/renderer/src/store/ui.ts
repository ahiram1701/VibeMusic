import { create } from 'zustand'
import type { GridResolution } from '@shared/timeline'

interface UiState {
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

export const useUi = create<UiState>((set) => ({
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
