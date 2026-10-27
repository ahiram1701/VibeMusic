import { describe, expect, it } from 'vitest'
import { lineLanguage, lyricsLanguages } from './lyrics-language'

describe('idioma de cada línea', () => {
  it.each([
    ['ven a bailar conmigo', 'es'],
    ['la luna cae sobre el mar', 'es'],
    ['quédate cerca de mí', 'es'],
    ["baby, don't stop the music", 'en'],
    ['dancing all night with you', 'en'],
    ['oh yeah', 'en'],
    ['I want you tonight', 'en'],
    ['baby, quiero verte', 'es'] // una palabra suelta en inglés no cambia la línea
  ])('%s → %s', (text, lang) => {
    expect(lineLanguage(text, 'es')).toBe(lang)
  })

  it('si no se distingue, usa el idioma de la canción', () => {
    expect(lineLanguage('no no no', 'es')).toBe('es')
    expect(lineLanguage('no no no', 'en')).toBe('en')
    expect(lineLanguage('lalala', 'en')).toBe('en')
  })

  it('no adivina en canciones de otros idiomas', () => {
    expect(lineLanguage('love you tonight', 'ja')).toBe('ja')
  })

  it('lista los idiomas de una letra mixta sin contar las etiquetas', () => {
    expect(
      lyricsLanguages('[Verse]\nven a bailar conmigo\n\n[Chorus]\nbaby tonight', 'es')
    ).toEqual(['es', 'en'])
    expect(lyricsLanguages('[Verse]\nven a bailar conmigo', 'es')).toEqual(['es'])
  })
})
