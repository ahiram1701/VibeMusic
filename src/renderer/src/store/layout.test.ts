import { describe, expect, it } from 'vitest'
import { clampSize, PANEL_LIMITS, useLayout } from './layout'

describe('tamaños de los paneles', () => {
  it('se quedan dentro de sus límites', () => {
    expect(clampSize('aside', 100)).toBe(PANEL_LIMITS.aside.min)
    expect(clampSize('aside', 5000)).toBe(PANEL_LIMITS.aside.max)
    expect(clampSize('mixer', 250.4)).toBe(250)
  })

  it('arrastrar cambia el tamaño y doble clic lo devuelve al inicial', () => {
    const { setSize, resetSize } = useLayout.getState()
    setSize('aside', 480)
    expect(useLayout.getState().sizes.aside).toBe(480)
    setSize('aside', 9999)
    expect(useLayout.getState().sizes.aside).toBe(600)
    resetSize('aside')
    expect(useLayout.getState().sizes.aside).toBe(PANEL_LIMITS.aside.initial)
  })

  it('Ajustes se abre en la última pestaña mirada', () => {
    const { openSettings, rememberSettingsTab } = useLayout.getState()
    rememberSettingsTab('voices')
    openSettings()
    expect(useLayout.getState().settingsTab).toBe('voices')
    openSettings('audio')
    expect(useLayout.getState().settingsTab).toBe('audio')
    openSettings(null)
    expect(useLayout.getState().settingsTab).toBeNull()
  })
})
