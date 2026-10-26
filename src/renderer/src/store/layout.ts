import { create } from 'zustand'

// Tamaño y visibilidad de los paneles de la ventana (preferencia de este equipo: se
// guarda en localStorage). Arrastrar un divisor cambia un tamaño; doble clic lo
// devuelve al inicial.

export type PanelSize = 'aside' | 'mixer' | 'history'

/** Límites y tamaño inicial de cada panel, en píxeles. */
export const PANEL_LIMITS: Record<PanelSize, { min: number; max: number; initial: number }> = {
  aside: { min: 260, max: 600, initial: 340 },
  mixer: { min: 120, max: 400, initial: 190 },
  history: { min: 100, max: 500, initial: 220 }
}

interface LayoutState {
  sizes: Record<PanelSize, number>
  showAside: boolean
  showMixer: boolean
  /** Diálogos que se abren desde varios sitios (cabecera, menú, F1). */
  shortcutsOpen: boolean
  exportOpen: boolean
  settingsTab: SettingsTab | null
  /** La última pestaña de Ajustes que se miró (se abre ahí desde la cabecera). */
  lastSettingsTab: SettingsTab
  setSize(panel: PanelSize, px: number): void
  resetSize(panel: PanelSize): void
  toggleAside(): void
  toggleMixer(): void
  openShortcuts(open: boolean): void
  openExport(open: boolean): void
  /** Abre Ajustes en una pestaña (sin pestaña: la última que se miró); null cierra. */
  openSettings(tab?: SettingsTab | null): void
  rememberSettingsTab(tab: SettingsTab): void
}

export type SettingsTab = 'llm' | 'audio' | 'voices' | 'updates'

const KEY = 'vibe-layout'

export function clampSize(panel: PanelSize, px: number): number {
  const { min, max } = PANEL_LIMITS[panel]
  return Math.round(Math.min(max, Math.max(min, px)))
}

type Saved = Pick<LayoutState, 'sizes' | 'showAside' | 'showMixer'>

function load(): Saved {
  const initial: Saved = {
    sizes: { aside: 340, mixer: 190, history: 220 },
    showAside: true,
    showMixer: true
  }
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Saved>
    const sizes = { ...initial.sizes }
    for (const p of Object.keys(sizes) as PanelSize[]) {
      const v = raw.sizes?.[p]
      if (typeof v === 'number' && Number.isFinite(v)) sizes[p] = clampSize(p, v)
    }
    return {
      sizes,
      showAside: raw.showAside ?? true,
      showMixer: raw.showMixer ?? true
    }
  } catch {
    return initial
  }
}

function save(s: Saved): void {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({ sizes: s.sizes, showAside: s.showAside, showMixer: s.showMixer })
    )
  } catch {
    // sin almacenamiento (p. ej. bloqueado): se queda para esta sesión
  }
}

export const useLayout = create<LayoutState>((set, get) => ({
  ...load(),
  shortcutsOpen: false,
  exportOpen: false,
  settingsTab: null,
  lastSettingsTab: 'llm',
  setSize: (panel, px) => {
    set((s) => ({ sizes: { ...s.sizes, [panel]: clampSize(panel, px) } }))
    save(get())
  },
  resetSize: (panel) => get().setSize(panel, PANEL_LIMITS[panel].initial),
  toggleAside: () => {
    set((s) => ({ showAside: !s.showAside }))
    save(get())
  },
  toggleMixer: () => {
    set((s) => ({ showMixer: !s.showMixer }))
    save(get())
  },
  openShortcuts: (shortcutsOpen) => set({ shortcutsOpen }),
  openExport: (exportOpen) => set({ exportOpen }),
  openSettings: (tab) => set((s) => ({ settingsTab: tab === undefined ? s.lastSettingsTab : tab })),
  rememberSettingsTab: (lastSettingsTab) => set({ lastSettingsTab })
}))
