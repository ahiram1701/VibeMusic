import { describe, expect, it } from 'vitest'
import { STYLE_WORDS } from './arrange'
import { findGenre, GENERIC_STRUCTURE, GENRES, PROMPT_EXAMPLES } from './genres'

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

  it('cubre géneros de fuera del urbano y el regional (test13: rock tipo AC/DC)', () => {
    expect(findGenre('rock tipo AC/DC, hard rock')?.id).toBe('hard-rock')
    expect(findGenre('heavy metal')?.id).toBe('hard-rock')
    // Rock a secas sigue siendo rock.
    expect(findGenre('rock en español')?.id).toBe('rock')
    expect(findGenre('salsa romántica')?.id).toBe('salsa')
    expect(findGenre('Merengue')?.id).toBe('merengue')
    expect(findGenre('vallenato')?.id).toBe('vallenato')
    expect(findGenre('una ranchera')?.id).toBe('mariachi')
    expect(findGenre('reggae')?.id).toBe('reggae')
    expect(findGenre('ska punk')?.id).toBe('ska')
    expect(findGenre('jazz')?.id).toBe('jazz')
    expect(findGenre('bossa nova')?.id).toBe('bossa-nova')
    expect(findGenre('blues')?.id).toBe('blues')
    expect(findGenre('lo-fi hip hop')?.id).toBe('lofi')
    expect(findGenre('drum and bass')?.id).toBe('drum-and-bass')
    expect(findGenre('dubstep')?.id).toBe('edm')
    expect(findGenre('K-pop')?.id).toBe('pop')
    expect(findGenre('música clásica')?.id).toBe('orchestral')
  })

  it('cada alias lleva a un solo género', () => {
    const seen = new Map<string, string>()
    for (const g of GENRES) {
      for (const a of g.aliases) {
        expect(seen.get(a), `${a}: ${g.id}`).toBeUndefined()
        seen.set(a, g.id)
      }
    }
  })

  it('la estructura genérica va en frases de 4 compases', () => {
    for (const [, bars] of GENERIC_STRUCTURE) expect(bars % 4).toBe(0)
  })
})
