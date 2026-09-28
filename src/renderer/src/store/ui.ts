import { create } from 'zustand'
import type { GridResolution } from '@shared/timeline'

interface UiState {
  grid: GridResolution
  pxPerBeat: number
  selectedRegionId: string | null
  setGrid(grid: GridResolution): void
  zoom(factor: number): void
  select(regionId: string | null): void
}

export const useUi = create<UiState>((set) => ({
  grid: 'beat',
  pxPerBeat: 24,
  selectedRegionId: null,
  setGrid: (grid) => set({ grid }),
  zoom: (factor) => set((s) => ({ pxPerBeat: Math.min(200, Math.max(4, s.pxPerBeat * factor)) })),
  select: (selectedRegionId) => set({ selectedRegionId })
}))
