// Idioma de cada línea de una letra. Las canciones en español mezclan a menudo
// líneas en inglés ("baby, tonight"): los motores que cantan necesitan saberlo para
// pronunciarlas bien. Es una heurística sencilla (palabras frecuentes y rasgos de la
// ortografía), sin dependencias, pensada para español e inglés.

const ENGLISH = new Set(
  (
    'the an and or but i you he she we they it me my your our their his her its this that ' +
    "is are was were be been am do does did don't can't won't i'm you're it's let's " +
    'to of in on at for with from up down out all no not so just like love baby girl boy ' +
    'night tonight feel know want need got get go come take make let what when where who why ' +
    'how oh yeah hey now never ever forever heart dance party right time way one more stop ' +
    'say tell hold keep give back away again only every there here gonna wanna gotta will would ' +
    'could should have has had into over under around through about high low fire light dream'
  ).split(' ')
)

const SPANISH = new Set(
  (
    'el la los las un una unos unas y o pero yo tú tu él ella nosotros ellos me te se nos le ' +
    'mi mis su sus que qué de del en con por para sin es son era fue soy eres estoy está ' +
    'no sí si ya muy más como cómo cuando dónde donde quien hay todo toda nada amor corazón ' +
    'noche vida baila bailar quiero tengo vamos ven dame contigo conmigo siempre nunca hoy ' +
    'aquí allá esta este eso esa lo al le ay mami papi bebé cielo mujer hombre ojos boca'
  ).split(' ')
)

const SPANISH_CHARS = /[ñáéíóú¿¡]/i
const ENGLISH_ENDINGS = /(?:ing|ght|'ll|'re|'ve|n't|'m|'s|th|sh|w|ck|tion)$/

const words = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .split(/[^a-záéíóúüñ']+/)
    .map((w) => w.replace(/^'+|'+$/g, ''))
    .filter(Boolean)

/** Puntuación de inglés (positiva) frente a español (negativa) de una línea. */
function score(text: string): number {
  let s = 0
  for (const w of words(text)) {
    const en = ENGLISH.has(w)
    const es = SPANISH.has(w) || SPANISH_CHARS.test(w)
    if (en && !es) s += 1
    else if (es && !en) s -= 1
    else if (!en && !es && ENGLISH_ENDINGS.test(w)) s += 0.5
  }
  return s
}

/**
 * Idioma de una línea: "en" o "es" si se distingue con claridad; si no (palabras de
 * los dos o desconocidas), el idioma de la canción.
 */
export function lineLanguage(text: string, fallback: string): string {
  if (fallback !== 'es' && fallback !== 'en') return fallback
  const s = score(text)
  if (s >= 1) return 'en'
  if (s <= -1) return 'es'
  return fallback
}

/** Idiomas presentes en una letra (una línea por frase), en orden de aparición. */
export function lyricsLanguages(lyrics: string, fallback: string): string[] {
  const found: string[] = []
  for (const line of lyrics.split('\n')) {
    // Las etiquetas de sección ("[Chorus]") no se cantan.
    const text = line.replace(/\[[^\]]*\]/g, '').trim()
    if (!text) continue
    const lang = lineLanguage(text, fallback)
    if (!found.includes(lang)) found.push(lang)
  }
  return found
}
