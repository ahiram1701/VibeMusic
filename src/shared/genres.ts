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
    aliases: ['pop', 'dance pop', 'electropop', 'k pop', 'kpop', 'j pop'],
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
  },
  {
    id: 'hard-rock',
    aliases: [
      'hard rock',
      'rock pesado',
      'ac dc',
      'heavy metal',
      'metal',
      'thrash metal',
      'metal pesado'
    ],
    bpm: [120, 150],
    style: 'hard rock, heavy distorted guitar riffs, pounding live drums, bass guitar, aggressive',
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
      intro: 'heavy guitar riff alone, drums enter',
      verse: 'driving drums, bass, chugging guitar riff',
      chorus: 'open power chords, crash cymbals, full drums',
      solo: 'shredding electric guitar solo over full band',
      outro: 'main riff, final hit'
    },
    avoid: 'synths, 808, soft piano'
  },
  {
    id: 'salsa',
    aliases: ['salsa', 'salsa romantica', 'salsa brava', 'son cubano', 'timba'],
    bpm: [160, 200],
    style: 'salsa, piano montuno, brass section, congas, timbales, bass guitar, latin',
    structure: [
      ['Intro', 8, 3],
      ['Verso', 16, 3],
      ['Coro', 16, 4],
      ['Mambo', 8, 5],
      ['Verso', 16, 3],
      ['Coro', 16, 5],
      ['Outro', 8, 3]
    ],
    arrangements: {
      intro: 'brass hits, piano montuno, congas enter',
      verse: 'piano montuno, congas, bass tumbao',
      chorus: 'full brass, timbales, cowbell, piano montuno',
      mambo: 'brass riffs, timbales fill, full band',
      outro: 'brass hits and timbales roll'
    },
    avoid: 'synths, 808, electronic drums'
  },
  {
    id: 'merengue',
    aliases: ['merengue', 'merengue tipico', 'perico ripiao'],
    bpm: [140, 170],
    style: 'merengue, fast tambora drum, guira, accordion, saxophone riffs, bass guitar',
    structure: [
      ['Intro', 8, 3],
      ['Verso', 16, 3],
      ['Coro', 16, 4],
      ['Jaleo', 16, 5],
      ['Coro', 16, 5],
      ['Outro', 4, 3]
    ],
    arrangements: {
      intro: 'saxophone riff, tambora and guira',
      verse: 'accordion, tambora, guira, bass',
      chorus: 'saxophones, accordion, full percussion',
      jaleo: 'fast accordion riff, tambora and guira louder',
      outro: 'saxophone riff, final hit'
    },
    avoid: 'synths, 808'
  },
  {
    id: 'vallenato',
    aliases: ['vallenato', 'vallenato romantico'],
    bpm: [90, 120],
    style: 'vallenato, accordion melody, caja drum, guacharaca, bass guitar, colombian',
    structure: [
      ['Intro', 8, 3],
      ['Verso', 16, 3],
      ['Coro', 16, 4],
      ['Verso', 16, 3],
      ['Coro', 16, 5],
      ['Outro', 4, 3]
    ],
    arrangements: {
      intro: 'accordion melody, caja and guacharaca',
      verse: 'accordion, caja drum, guacharaca, bass',
      chorus: 'accordion melody, full percussion, bass',
      outro: 'accordion melody, final strum'
    },
    avoid: 'synths, 808, electric guitar'
  },
  {
    id: 'mariachi',
    aliases: ['mariachi', 'ranchera', 'rancheras', 'ranchero', 'son jalisciense'],
    bpm: [100, 130],
    style: 'mariachi, trumpets, violins, guitarron bass, vihuela strumming, acoustic guitar',
    structure: [
      ['Intro', 8, 3],
      ['Verso', 16, 3],
      ['Coro', 16, 4],
      ['Interludio', 8, 4],
      ['Verso', 16, 3],
      ['Coro', 16, 5],
      ['Outro', 4, 3]
    ],
    arrangements: {
      intro: 'trumpets melody, violins, vihuela strumming',
      verse: 'vihuela and guitar strumming, guitarron bass, soft violins',
      chorus: 'trumpets, violins, full mariachi band',
      interlude: 'trumpets and violins melody',
      outro: 'trumpets fanfare, final strum'
    },
    avoid: 'synths, 808, drum kit'
  },
  {
    id: 'reggae',
    aliases: ['reggae', 'roots reggae', 'reggae en espanol'],
    bpm: [70, 90],
    style: 'reggae, offbeat guitar skank, one drop drums, deep bass guitar, organ bubble',
    structure: [
      ['Intro', 8, 2],
      ['Verso', 16, 3],
      ['Coro', 16, 4],
      ['Verso', 16, 3],
      ['Coro', 16, 4],
      ['Dub', 8, 3],
      ['Coro', 16, 5],
      ['Outro', 8, 2]
    ],
    arrangements: {
      intro: 'organ and guitar skank, drums enter',
      verse: 'one drop drums, deep bass, guitar skank',
      chorus: 'full band, organ bubble, horns',
      dub: 'bass and drums, sparse guitar chops',
      outro: 'guitar skank and organ'
    },
    avoid: 'synths, 808, distorted guitars'
  },
  {
    id: 'ska',
    aliases: ['ska', 'ska punk', 'two tone'],
    bpm: [140, 180],
    style: 'ska, upbeat offbeat guitar, brass section, walking bass, fast live drums',
    structure: [
      ['Intro', 8, 3],
      ['Verso', 16, 3],
      ['Coro', 16, 5],
      ['Verso', 16, 3],
      ['Coro', 16, 5],
      ['Puente', 8, 4],
      ['Coro', 16, 5],
      ['Outro', 4, 3]
    ],
    arrangements: {
      intro: 'brass riff, drums and offbeat guitar',
      verse: 'offbeat guitar, walking bass, drums',
      chorus: 'full brass, crash cymbals, full band',
      bridge: 'bass and drums, brass stabs',
      outro: 'brass riff, final hit'
    },
    avoid: 'synths, 808'
  },
  {
    id: 'funk',
    aliases: ['funk', 'funky', 'funk rock'],
    bpm: [95, 115],
    style: 'funk, slap bass, tight live drums, rhythm guitar, brass stabs, groovy',
    structure: [
      ['Intro', 8, 3],
      ['Verso', 16, 3],
      ['Coro', 16, 4],
      ['Verso', 16, 3],
      ['Coro', 16, 5],
      ['Break', 8, 3],
      ['Coro', 16, 5],
      ['Outro', 8, 3]
    ],
    arrangements: {
      intro: 'drum groove and slap bass',
      verse: 'tight drums, slap bass, rhythm guitar',
      chorus: 'brass stabs, clavinet, full groove',
      break: 'drums and bass groove, guitar licks',
      outro: 'slap bass and drums'
    },
    avoid: '808, ambient'
  },
  {
    id: 'disco',
    aliases: ['disco', 'nu disco', 'italo disco', 'musica disco'],
    bpm: [115, 128],
    style: 'disco, four-on-the-floor drums, octave bassline, strings, rhythm guitar, groovy',
    structure: [
      ['Intro', 8, 3],
      ['Verso', 16, 3],
      ['Coro', 16, 5],
      ['Verso', 16, 3],
      ['Coro', 16, 5],
      ['Break', 8, 3],
      ['Coro', 16, 5],
      ['Outro', 8, 3]
    ],
    arrangements: {
      intro: 'four-on-the-floor drums and bassline',
      verse: 'drums, octave bass, rhythm guitar',
      chorus: 'strings, brass, full groove',
      break: 'bassline and hand claps',
      outro: 'drums and bassline'
    },
    avoid: '808, trap hi-hats'
  },
  {
    id: 'jazz',
    aliases: ['jazz', 'swing', 'smooth jazz', 'big band', 'jazz band'],
    bpm: [100, 160],
    style: 'jazz, swing drums, upright bass, piano, saxophone, trumpet',
    structure: [
      ['Intro', 8, 2],
      ['Tema', 16, 3],
      ['Solo', 16, 4],
      ['Solo', 16, 4],
      ['Tema', 16, 4],
      ['Outro', 4, 2]
    ],
    arrangements: {
      intro: 'piano and upright bass',
      theme: 'saxophone melody, swing drums, walking bass',
      solo: 'saxophone solo over piano, bass and drums',
      outro: 'piano and saxophone, final chord'
    },
    avoid: 'synths, 808, distorted guitars'
  },
  {
    id: 'bossa-nova',
    aliases: ['bossa nova', 'bossa', 'musica brasilena'],
    bpm: [120, 140],
    style: 'bossa nova, nylon guitar, soft brushed drums, upright bass, piano, gentle',
    structure: [
      ['Intro', 8, 2],
      ['Verso', 16, 3],
      ['Coro', 16, 3],
      ['Solo', 8, 3],
      ['Verso', 16, 3],
      ['Coro', 16, 4],
      ['Outro', 4, 2]
    ],
    arrangements: {
      intro: 'nylon guitar chords',
      verse: 'nylon guitar, brushed drums, upright bass',
      chorus: 'guitar, piano, flute melody, bass',
      solo: 'flute solo over guitar and brushes',
      outro: 'nylon guitar chords'
    },
    avoid: 'distorted guitars, 808'
  },
  {
    id: 'blues',
    aliases: ['blues', 'blues rock', 'delta blues', 'chicago blues'],
    bpm: [70, 110],
    style: 'blues, electric guitar licks, shuffle drums, bass guitar, harmonica, piano',
    structure: [
      ['Intro', 4, 2],
      ['Verso', 12, 3],
      ['Verso', 12, 3],
      ['Solo', 12, 4],
      ['Verso', 12, 4],
      ['Outro', 4, 2]
    ],
    arrangements: {
      intro: 'guitar lick, drums enter',
      verse: 'shuffle drums, bass, guitar fills, piano',
      solo: 'electric guitar solo over shuffle groove',
      outro: 'guitar turnaround, final chord'
    },
    avoid: 'synths, 808'
  },
  {
    id: 'country',
    aliases: ['country', 'country pop', 'bluegrass', 'western'],
    bpm: [90, 130],
    style: 'country, acoustic guitar strumming, banjo, fiddle, pedal steel guitar, bass, drums',
    structure: [
      ['Intro', 8, 2],
      ['Verso', 16, 3],
      ['Coro', 16, 4],
      ['Verso', 16, 3],
      ['Coro', 16, 5],
      ['Puente', 8, 3],
      ['Coro', 16, 5],
      ['Outro', 4, 2]
    ],
    arrangements: {
      intro: 'acoustic guitar and fiddle melody',
      verse: 'acoustic guitar, bass, light drums',
      chorus: 'full band, banjo, pedal steel, drums',
      bridge: 'fiddle solo over guitar',
      outro: 'acoustic guitar, final strum'
    },
    avoid: 'synths, 808'
  },
  {
    id: 'folk',
    aliases: ['folk', 'indie folk', 'folk rock', 'acustico', 'acoustic'],
    bpm: [80, 120],
    style: 'folk, acoustic guitar, soft percussion, upright bass, mandolin, warm',
    structure: [
      ['Intro', 4, 2],
      ['Verso', 16, 2],
      ['Coro', 16, 3],
      ['Verso', 16, 3],
      ['Coro', 16, 4],
      ['Puente', 8, 3],
      ['Coro', 16, 4],
      ['Outro', 4, 2]
    ],
    arrangements: {
      intro: 'acoustic guitar picking',
      verse: 'acoustic guitar, soft percussion, upright bass',
      chorus: 'strummed guitars, mandolin, hand claps, bass',
      bridge: 'mandolin melody over guitar',
      outro: 'acoustic guitar picking'
    },
    avoid: 'synths, 808, distorted guitars'
  },
  {
    id: 'lofi',
    aliases: ['lofi', 'lo fi', 'chillhop', 'lofi hip hop', 'lo fi hip hop'],
    bpm: [70, 90],
    style: 'lofi hip hop, dusty drums, mellow electric piano chords, warm bass, jazzy',
    structure: [
      ['Intro', 4, 2],
      ['A', 16, 3],
      ['B', 16, 3],
      ['A', 16, 3],
      ['B', 16, 3],
      ['Outro', 4, 2]
    ],
    arrangements: {
      intro: 'electric piano chords alone',
      a: 'dusty drums, electric piano chords, warm bass',
      b: 'drums, bass, guitar melody, electric piano',
      outro: 'electric piano chords'
    },
    avoid: 'ambient, vinyl noise, rain sounds'
  },
  {
    id: 'drum-and-bass',
    aliases: ['drum and bass', 'drum n bass', 'dnb', 'jungle', 'liquid dnb'],
    bpm: [165, 178],
    style: 'drum and bass, fast breakbeat drums, deep sub bass, synth stabs, energetic',
    structure: [
      ['Intro', 16, 2],
      ['Build', 8, 4],
      ['Drop', 16, 5],
      ['Break', 16, 3],
      ['Build', 8, 4],
      ['Drop', 16, 5],
      ['Outro', 8, 2]
    ],
    arrangements: {
      intro: 'synth pads and hi-hats, breakbeat enters',
      build: 'snare roll, rising synth',
      drop: 'fast breakbeat drums, deep sub bass, synth stabs',
      break: 'synth chords and light drums',
      outro: 'breakbeat drums and bass'
    },
    avoid: 'acoustic guitar, slow'
  },
  {
    id: 'edm',
    aliases: ['edm', 'electro house', 'big room', 'future bass', 'dubstep', 'electronica'],
    bpm: [126, 145],
    style: 'edm, punchy kick, big synth lead, sidechained bass, energetic festival',
    structure: [
      ['Intro', 16, 2],
      ['Build', 8, 4],
      ['Drop', 16, 5],
      ['Break', 16, 3],
      ['Build', 8, 4],
      ['Drop', 16, 5],
      ['Outro', 8, 2]
    ],
    arrangements: {
      intro: 'kick and synth chords',
      build: 'snare roll, rising synth, claps',
      drop: 'big synth lead, punchy kick, heavy bass',
      break: 'piano chords and synth melody',
      outro: 'kick and synth chords'
    },
    avoid: 'acoustic guitar, ambient, dark'
  },
  {
    id: 'flamenco',
    aliases: ['flamenco', 'rumba flamenca', 'rumba', 'flamenco pop'],
    bpm: [100, 130],
    style: 'flamenco rumba, nylon guitar strumming, palmas hand claps, cajon, bass, spanish',
    structure: [
      ['Intro', 8, 2],
      ['Verso', 16, 3],
      ['Coro', 16, 4],
      ['Falseta', 8, 4],
      ['Verso', 16, 3],
      ['Coro', 16, 5],
      ['Outro', 4, 2]
    ],
    arrangements: {
      intro: 'flamenco guitar melody',
      verse: 'guitar strumming, cajon, palmas, bass',
      chorus: 'full rumba strumming, palmas, cajon',
      falseta: 'fast flamenco guitar melody, cajon',
      outro: 'flamenco guitar, final strum'
    },
    avoid: 'synths, 808, distorted guitars'
  },
  {
    id: 'tango',
    aliases: ['tango', 'tango argentino', 'tango electronico'],
    bpm: [110, 130],
    style: 'argentine tango, bandoneon, violins, piano, double bass, staccato rhythm',
    structure: [
      ['Intro', 8, 2],
      ['A', 16, 3],
      ['B', 16, 4],
      ['A', 16, 4],
      ['Outro', 4, 3]
    ],
    arrangements: {
      intro: 'bandoneon melody over piano',
      a: 'staccato piano and double bass, bandoneon melody',
      b: 'violins melody, bandoneon, full ensemble',
      outro: 'bandoneon and violins, final chord'
    },
    avoid: 'synths, 808, drum kit'
  },
  {
    id: 'orchestral',
    aliases: ['orquesta', 'orquestal', 'orchestral', 'clasica', 'classical', 'sinfonica'],
    bpm: [70, 110],
    style: 'orchestral, string section, french horns, timpani, piano, woodwinds, epic',
    structure: [
      ['Intro', 8, 2],
      ['Tema', 16, 3],
      ['Desarrollo', 16, 4],
      ['Climax', 16, 5],
      ['Final', 8, 3]
    ],
    arrangements: {
      intro: 'piano and soft strings',
      theme: 'strings melody, woodwinds, light percussion',
      development: 'french horns, strings, timpani rolls',
      climax: 'full orchestra, timpani, brass, strings',
      finale: 'strings and horns, final chord'
    },
    avoid: 'cinematic, ambient, drone, synths'
  }
]

/** Estructura para un género que no está en la guía: verso-coro en frases de 4 compases. */
export const GENERIC_STRUCTURE: GenreGuide['structure'] = [
  ['Intro', 8, 2],
  ['Verso', 16, 3],
  ['Coro', 16, 5],
  ['Verso', 16, 3],
  ['Coro', 16, 5],
  ['Puente', 8, 3],
  ['Coro', 16, 5],
  ['Outro', 4, 2]
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
