// Guía de géneros del productor. Los LLM conocen los géneros, pero no el vocabulario
// con el que se entrenó MusicGen: descripciones cortas tipo etiquetas, con
// instrumentos concretos y el tempo. Un género raro ("tumbado", "bélico") o una
// palabra de ambiente ("dark", "cinematic") le hacen generar algo que no es una
// canción. Esta tabla traduce cada género a ese vocabulario y da ejemplos: con
// ejemplos en contexto el LLM escribe prompts que el motor entiende. Todo en inglés,
// que es lo que lee el motor; los alias admiten los nombres en español.

export interface GenreGuide {
  id: string
  /** Nombres con los que lo puede pedir el usuario (minúsculas, sin acentos). */
  aliases: string[]
  bpm: [number, number]
  /** "style" listo para compose_song: 8-15 palabras que MusicGen conoce. */
  style: string
  /** Estructura típica: [nombre, compases, energía]. */
  structure: [string, number, number][]
  /** Ejemplo de "arrangement" por tipo de sección (≤12 palabras). */
  arrangements: Record<string, string>
  /** Palabras o ideas que en este género llevan a MusicGen a sonar mal. */
  avoid: string
  /**
   * Fusión: se elige cuando la consulta nombra una palabra de cada grupo ("house" y
   * "tumbado"), antes que el alias más largo, que daría solo uno de los dos géneros.
   */
  blend?: string[][]
  /** Patrón de la batería programada (drums.ts) que lleva este género, si lleva. */
  drums?: string
}

export const GENRES: GenreGuide[] = [
  {
    id: 'reggaeton',
    drums: 'dembow',
    aliases: ['reggaeton', 'regueton', 'dembow', 'perreo', 'urbano'],
    bpm: [88, 98],
    style: 'reggaeton, dembow drum pattern, punchy kick, 808 bass, synth plucks, latin percussion',
    structure: [
      ['Intro', 4, 2],
      ['Verso', 16, 3],
      ['Pre-coro', 8, 4],
      ['Coro', 16, 5],
      ['Verso', 16, 3],
      ['Coro', 16, 5],
      ['Outro', 8, 2]
    ],
    arrangements: {
      intro: 'filtered synth pluck hook, light dembow hats',
      verse: 'dembow beat, 808 bass, sparse plucks',
      'pre-chorus': 'snare build, rising synth, bass drops for one bar',
      chorus: 'full dembow beat, synth hook, claps and shakers',
      outro: 'synth hook with dembow beat, simpler'
    },
    avoid: 'dark, cinematic, ambient pads; artist names'
  },
  {
    id: 'corridos-tumbados',
    aliases: [
      'corridos tumbados',
      'tumbado',
      'corrido tumbado',
      'corridos belicos',
      'belico',
      'corrido'
    ],
    bpm: [70, 85],
    style:
      'regional mexican, acoustic requinto guitar lead, tuba bass, strummed guitar, trap hi-hats, 808',
    structure: [
      ['Intro', 4, 2],
      ['Verso', 16, 3],
      ['Coro', 8, 4],
      ['Verso', 16, 3],
      ['Coro', 8, 4],
      ['Solo', 8, 4],
      ['Coro', 8, 5],
      ['Outro', 4, 2]
    ],
    arrangements: {
      intro: 'requinto guitar riff alone, tuba enters',
      verse: 'strummed guitar, tuba bass line, soft trap hi-hats',
      chorus: 'requinto melody, tuba, 808 kick, trap hi-hats',
      solo: 'fast requinto guitar solo over tuba and drums',
      outro: 'requinto riff, tuba, final strum'
    },
    avoid:
      'techno, warehouse, industrial, synths; the word "corrido" alone means nothing to the engine'
  },
  {
    id: 'cumbia',
    aliases: ['cumbia', 'cumbia sonidera', 'cumbia nortena', 'cumbia villera'],
    bpm: [90, 100],
    style: 'cumbia, guira scraper, congas, accordion melody, bass guitar, timbales, festive',
    structure: [
      ['Intro', 8, 3],
      ['Verso', 16, 3],
      ['Coro', 16, 4],
      ['Instrumental', 8, 4],
      ['Verso', 16, 3],
      ['Coro', 16, 5],
      ['Outro', 8, 3]
    ],
    arrangements: {
      intro: 'accordion riff, guira and congas',
      verse: 'cumbia rhythm, bass guitar, soft accordion fills',
      chorus: 'accordion melody, full percussion, timbales',
      instrumental: 'accordion solo over cumbia groove',
      outro: 'accordion riff, percussion, final hit'
    },
    avoid: 'trap hi-hats, 808, dark synths'
  },
  {
    id: 'banda',
    aliases: ['banda', 'banda sinaloense', 'regional mexicano', 'norteno', 'nortena', 'sierreno'],
    bpm: [100, 125],
    style: 'mexican banda, brass section, clarinets, tuba bass, snare and tambora, festive',
    structure: [
      ['Intro', 8, 3],
      ['Verso', 16, 3],
      ['Coro', 16, 4],
      ['Instrumental', 8, 4],
      ['Verso', 16, 3],
      ['Coro', 16, 5],
      ['Outro', 4, 3]
    ],
    arrangements: {
      intro: 'trumpets and clarinets play the main melody',
      verse: 'tuba bass, tambora, soft clarinets',
      chorus: 'full brass melody, tuba, tambora hits',
      instrumental: 'brass and clarinet melody, tambora fills',
      outro: 'brass melody, final tambora hit'
    },
    avoid: 'synths, 808, electronic drums'
  },
  {
    id: 'latin-trap',
    drums: 'trap',
    aliases: ['trap latino', 'latin trap', 'trap'],
    bpm: [130, 150],
    style: 'latin trap, half-time 808 drums, rolling hi-hats, deep 808 bass, piano melody',
    structure: [
      ['Intro', 4, 2],
      ['Verso', 16, 3],
      ['Coro', 8, 5],
      ['Verso', 16, 3],
      ['Coro', 8, 5],
      ['Puente', 8, 3],
      ['Coro', 8, 5],
      ['Outro', 4, 2]
    ],
    arrangements: {
      intro: 'piano melody, soft hi-hats',
      verse: 'half-time 808 beat, rolling hi-hats, piano',
      chorus: 'hard 808, rolling hi-hats, piano hook, claps',
      bridge: 'drums half, piano and bass, snare roll at end',
      outro: 'piano melody, 808 fades'
    },
    avoid: 'four-on-the-floor kick, dark ambient, cinematic'
  },
  {
    id: 'latin-pop',
    aliases: ['pop latino', 'latin pop', 'pop en espanol'],
    bpm: [90, 105],
    style: 'latin pop, acoustic guitar, reggaeton beat, bright synths, catchy melody, upbeat',
    structure: [
      ['Intro', 4, 2],
      ['Verso', 16, 3],
      ['Pre-coro', 8, 4],
      ['Coro', 16, 5],
      ['Verso', 16, 3],
      ['Pre-coro', 8, 4],
      ['Coro', 16, 5],
      ['Outro', 8, 2]
    ],
    arrangements: {
      intro: 'acoustic guitar hook, light percussion',
      verse: 'acoustic guitar, soft reggaeton beat, bass',
      'pre-chorus': 'drums build, synth rises',
      chorus: 'full beat, bright synth hook, guitar, claps',
      outro: 'guitar hook, beat simplifies'
    },
    avoid: 'dark, aggressive, distorted'
  },
  {
    id: 'pop',
    aliases: ['pop', 'dance pop', 'electropop'],
    bpm: [100, 125],
    style: 'pop, punchy drums, synth bass, bright synths, catchy hook, polished production',
    structure: [
      ['Intro', 4, 2],
      ['Verso', 16, 3],
      ['Pre-coro', 8, 4],
      ['Coro', 16, 5],
      ['Verso', 16, 3],
      ['Coro', 16, 5],
      ['Puente', 8, 3],
      ['Coro', 16, 5],
      ['Outro', 4, 2]
    ],
    arrangements: {
      intro: 'synth hook, filtered drums',
      verse: 'drums and synth bass, light chords',
      'pre-chorus': 'snare build, rising synth',
      chorus: 'full drums, big synth hook, claps',
      bridge: 'piano and drums half-time',
      outro: 'synth hook, drums fade'
    },
    avoid: 'ambient, cinematic, dark'
  },
  {
    // Tech house mexicano con actitud de corrido tumbado: la fiesta la pone el house, lo
    // "tumbado" la guitarra y la percusión latina. Lo industrial se pide con timbres,
    // no con la palabra (MusicGen la lleva a un drone oscuro).
    id: 'house-tumbado',
    drums: 'house',
    aliases: ['house tumbado', 'tech house tumbado', 'techno tumbado', 'tumbado house'],
    blend: [
      ['house', 'tech house', 'techno', 'tecno', 'electronica', 'edm'],
      ['tumbado', 'tumbados', 'belico', 'malandro', 'corrido', 'corridos']
    ],
    bpm: [124, 128],
    style:
      'tech house, punchy four-on-the-floor kick, rolling bassline, latin percussion, acoustic guitar riff, claps',
    structure: [
      ['Intro', 8, 2],
      ['Verso', 16, 3],
      ['Coro', 8, 5],
      ['Verso', 16, 3],
      ['Coro', 8, 5],
      ['Break', 8, 3],
      ['Coro', 8, 5],
      ['Outro', 8, 2]
    ],
    arrangements: {
      intro: 'kick and shakers, acoustic guitar riff teases the hook',
      verso: 'kick, rolling bassline, congas, sparse guitar riff',
      coro: 'full groove, guitar riff hook, claps, distorted synth stabs',
      break: 'guitar riff and percussion, kick returns at end',
      outro: 'kick, bassline and guitar riff, simpler'
    },
    avoid:
      'industrial, dark, warehouse; dembow and reggaeton (they pull it to a slower reggaeton beat); for an industrial or malandro feel use distorted synth stabs and metallic percussion'
  },
  {
    id: 'house',
    drums: 'house',
    aliases: ['house', 'deep house', 'tech house', 'afro house'],
    bpm: [120, 126],
    style: 'house music, four-on-the-floor kick, offbeat hi-hats, groovy bassline, piano chords',
    structure: [
      ['Intro', 16, 2],
      ['Build', 16, 3],
      ['Drop', 16, 5],
      ['Break', 8, 3],
      ['Drop', 16, 5],
      ['Outro', 16, 2]
    ],
    arrangements: {
      intro: 'kick and hi-hats, bassline enters',
      build: 'piano chords enter, claps, snare roll',
      drop: 'full groove, piano chords, bassline, open hi-hats, claps',
      break: 'piano chords and hats, kick returns at end',
      outro: 'kick, hats and bassline'
    },
    avoid: 'ambient pads alone, dark, cinematic'
  },
  {
    id: 'techno',
    drums: 'techno',
    aliases: ['techno', 'tecno', 'hard techno', 'melodic techno'],
    bpm: [125, 135],
    style: 'techno, driving kick, rolling bassline, hi-hats, analog synth riff, hypnotic groove',
    structure: [
      ['Intro', 16, 2],
      ['Build', 16, 3],
      ['Drop', 16, 5],
      ['Break', 8, 3],
      ['Drop', 16, 5],
      ['Outro', 16, 2]
    ],
    arrangements: {
      intro: 'kick and closed hats, short synth riff',
      build: 'rolling bassline, percussion, filter opens',
      drop: 'full kick, bassline, acid synth riff, open hats',
      break: 'hats and synth riff, snare roll',
      outro: 'kick and hats, riff fades'
    },
    avoid: 'industrial, warehouse reverb, dark pads, drone, sub bass'
  },
  {
    id: 'hip-hop',
    aliases: ['hip hop', 'rap', 'boom bap', 'hiphop'],
    bpm: [85, 95],
    style: 'hip hop, boom bap drums, deep bass, jazzy piano sample, vinyl texture',
    structure: [
      ['Intro', 4, 2],
      ['Verso', 16, 3],
      ['Coro', 8, 4],
      ['Verso', 16, 3],
      ['Coro', 8, 4],
      ['Outro', 4, 2]
    ],
    arrangements: {
      intro: 'piano sample alone',
      verse: 'boom bap drums, bass, piano sample',
      chorus: 'drums, bass, piano and scratches',
      outro: 'piano sample, drums stop'
    },
    avoid: 'four-on-the-floor, ambient'
  },
  {
    id: 'rnb',
    aliases: ['r&b', 'rnb', 'r and b', 'soul'],
    bpm: [65, 85],
    style: 'r&b, smooth drums, electric piano chords, warm bass, soulful',
    structure: [
      ['Intro', 4, 2],
      ['Verso', 16, 3],
      ['Coro', 8, 4],
      ['Verso', 16, 3],
      ['Coro', 8, 4],
      ['Puente', 8, 3],
      ['Coro', 8, 5],
      ['Outro', 4, 2]
    ],
    arrangements: {
      intro: 'electric piano chords',
      verse: 'smooth drums, bass, electric piano',
      chorus: 'full drums, piano, strings, bass',
      bridge: 'piano and bass, drums half',
      outro: 'electric piano chords'
    },
    avoid: 'distorted, aggressive'
  },
  {
    id: 'rock',
    aliases: ['rock', 'pop rock', 'rock en espanol', 'punk'],
    bpm: [110, 140],
    style: 'rock, live drums, distorted electric guitars, bass guitar, energetic',
    structure: [
      ['Intro', 8, 3],
      ['Verso', 16, 3],
      ['Coro', 16, 5],
      ['Verso', 16, 3],
      ['Coro', 16, 5],
      ['Solo', 8, 5],
      ['Coro', 16, 5],
      ['Outro', 4, 3]
    ],
    arrangements: {
      intro: 'guitar riff, drums enter',
      verse: 'drums, bass, palm-muted guitar',
      chorus: 'open distorted guitars, crash cymbals, full drums',
      solo: 'electric guitar solo over full band',
      outro: 'guitar riff, final hit'
    },
    avoid: 'synths, 808'
  },
  {
    id: 'ballad',
    aliases: ['balada', 'ballad', 'balada romantica', 'bolero'],
    bpm: [65, 80],
    style: 'pop ballad, piano, soft drums, strings, bass, emotional',
    structure: [
      ['Intro', 4, 2],
      ['Verso', 16, 2],
      ['Coro', 16, 4],
      ['Verso', 16, 3],
      ['Coro', 16, 4],
      ['Puente', 8, 3],
      ['Coro', 16, 5],
      ['Outro', 4, 2]
    ],
    arrangements: {
      intro: 'solo piano melody',
      verse: 'piano, soft drums, bass',
      chorus: 'piano, full drums, strings',
      bridge: 'strings and piano, drum build',
      outro: 'piano melody'
    },
    avoid: 'ambient, drone, cinematic score'
  },
  {
    id: 'bachata',
    aliases: ['bachata'],
    bpm: [120, 135],
    style: 'bachata, requinto guitar arpeggios, bongos, guira, bass guitar, romantic',
    structure: [
      ['Intro', 8, 2],
      ['Verso', 16, 3],
      ['Coro', 16, 4],
      ['Mambo', 8, 5],
      ['Verso', 16, 3],
      ['Coro', 16, 5],
      ['Outro', 4, 2]
    ],
    arrangements: {
      intro: 'requinto guitar melody, bongos',
      verse: 'guitar arpeggios, bongos, bass',
      chorus: 'requinto melody, guira, full percussion',
      mambo: 'fast guitar riff, bongos and guira louder',
      outro: 'requinto melody, final strum'
    },
    avoid: 'synths, 808'
  },
  {
    id: 'afrobeats',
    aliases: ['afrobeats', 'afrobeat', 'amapiano'],
    bpm: [100, 115],
    style: 'afrobeats, syncopated percussion, log drums, warm bass, guitar licks, groovy',
    structure: [
      ['Intro', 8, 2],
      ['Verso', 16, 3],
      ['Coro', 16, 4],
      ['Verso', 16, 3],
      ['Coro', 16, 5],
      ['Outro', 8, 2]
    ],
    arrangements: {
      intro: 'guitar lick and shakers',
      verse: 'syncopated percussion, bass, guitar',
      chorus: 'full percussion, log drums, synth hook',
      outro: 'guitar and shakers'
    },
    avoid: 'four-on-the-floor techno, dark'
  }
]

/**
 * Descripciones de ejemplo como las que entiende MusicGen: cortas, concretas, con
 * instrumentos y tempo, sin negaciones ni palabras de ambiente.
 */
export const PROMPT_EXAMPLES = [
  'upbeat latin pop with acoustic guitar, congas and a catchy synth hook, 100 bpm',
  'reggaeton beat with dembow drums, 808 bass and synth plucks, 94 bpm',
  'regional mexican song with requinto guitar, tuba bass and trap hi-hats, 78 bpm',
  'festive cumbia with accordion melody, guira and congas, 96 bpm',
  'mexican banda with trumpets, clarinets, tuba and tambora, 110 bpm',
  'latin trap beat with half-time 808 drums, rolling hi-hats and piano, 140 bpm',
  'energetic pop track with punchy drums, synth bass and a big chorus, 118 bpm',
  'groovy house track with four-on-the-floor kick, piano chords and bassline, 124 bpm',
  'driving techno with rolling bassline, open hi-hats and acid synth riff, 130 bpm',
  'boom bap hip hop beat with jazzy piano sample and deep bass, 90 bpm',
  'smooth r&b with electric piano, warm bass and soft drums, 75 bpm',
  'energetic rock song with distorted guitars, live drums and bass, 128 bpm',
  'emotional pop ballad with piano, strings and soft drums, 72 bpm',
  'romantic bachata with requinto guitar, bongos and guira, 128 bpm',
  'afrobeats groove with syncopated percussion, guitar licks and warm bass, 108 bpm'
]

const normalize = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9&]+/g, ' ')
    .trim()

/** Busca un género por nombre o alias ("Corridos Tumbados", "tumbado", "trap latino"…). */
export function findGenre(query: string): GenreGuide | null {
  const q = normalize(query)
  if (!q) return null
  // Primero el alias exacto; si no, el alias más largo que aparezca en la consulta.
  const exact = GENRES.find((g) => g.id === q.replace(/ /g, '-') || g.aliases.includes(q))
  if (exact) return exact
  const has = (a: string): boolean => ` ${q} `.includes(` ${a} `)
  const blended = GENRES.find((g) => g.blend?.every((group) => group.some(has)))
  if (blended) return blended
  let best: { g: GenreGuide; len: number } | null = null
  for (const g of GENRES) {
    for (const a of g.aliases) {
      if (has(a) && a.length > (best?.len ?? 0)) best = { g, len: a.length }
    }
  }
  return best?.g ?? null
}
