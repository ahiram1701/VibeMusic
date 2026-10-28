import { describe, expect, it } from 'vitest'
import { STYLE_WORDS } from './arrange'
import { findGenre, GENRES, PROMPT_EXAMPLES } from './genres'

const words = (s: string): number => s.split(/\s+/).filter(Boolean).length
// Lo que lleva a MusicGen al drone o al balbuceo (ver drone.ts y producer-prompt.ts).
const BAD = /\b(dark|ambient|atmospheric|cinematic|drone|warehouse|reverb|vocals?|not|no)\b/

describe('guía de géneros', () => {
  it('cada género trae tempo, estructura y un estilo corto que MusicGen entiende', () => {
    for (const g of GENRES) {
      expect(g.bpm[0]).toBeLessThan(g.bpm[1])
      expect(g.structure.length).toBeGreaterThanOrEqual(4)
      expect(words(g.style), g.id).toBeLessThanOrEqual(STYLE_WORDS)
      expect(g.style, g.id).not.toMatch(BAD)
      for (const a of Object.values(g.arrangements)) {
        expect(words(a), `${g.id}: ${a}`).toBeLessThanOrEqual(12)
        expect(a, g.id).not.toMatch(BAD)
      }
      for (const [, bars, energy] of g.structure) {
        expect(bars % 4).toBe(0)
        expect(energy).toBeGreaterThanOrEqual(2)
      }
    }
  })

  it('los ejemplos son cortos, positivos y con tempo', () => {
    for (const p of PROMPT_EXAMPLES) {
      expect(words(p)).toBeLessThanOrEqual(20)
      expect(p).toMatch(/\d+ bpm$/)
      expect(p).not.toMatch(BAD)
    }
  })

  it('encuentra el género por alias, con acentos y mayúsculas', () => {
    expect(findGenre('Corridos Tumbados')?.id).toBe('corridos-tumbados')
    expect(findGenre('un tumbado bélico')?.id).toBe('corridos-tumbados')
    expect(findGenre('Reguetón')?.id).toBe('reggaeton')
    expect(findGenre('trap latino')?.id).toBe('latin-trap')
    expect(findGenre('deep house')?.id).toBe('house')
    expect(findGenre('R&B')?.id).toBe('rnb')
    // Una fusión no se queda con uno solo de los géneros.
    expect(findGenre('house/techno bien tumbado, malandro')?.id).toBe('house-tumbado')
    expect(findGenre('house tumbado')?.id).toBe('house-tumbado')
    expect(findGenre('polka checa')).toBeNull()
  })
})
