// Batería programada: en house, techno, reggaetón o trap el ritmo *es* el género, y
// MusicGen-small no lo clava (bombo blando, no siempre a tempo). Así que el modelo
// toca la cama (bajo, sintes, guitarras) y la batería se programa como lo haría un
// productor: un patrón por género en semicorcheas, que entra y sale según la energía
// de cada sección, con subida (redoble y riser) y un hueco antes de cada coro, y un
// break sin bombo. Aquí solo el plan de golpes; drum-synth.ts los hace sonar. Puro.

export type DrumVoice =
  | 'kick'
  | 'clap'
  | 'snare'
  | 'hat'
  | 'openhat'
  | 'shaker'
  | 'conga'
  | 'congaHi'
  | 'rim'
  | 'crash'
  | 'riser'
  | 'sub808'

export interface DrumHit {
  /** Pulso de la canción (negras desde el principio) en que suena. */
  beat: number
  voice: DrumVoice
  /** Intensidad 0-1. */
  vel: number
  /** Duración en pulsos (solo riser y 808, que se sostienen). */
  lengthBeats?: number
}

/** Una capa del patrón: 16 pasos por compás ("x" fuerte, "o" suave, "." nada). */
interface Layer {
  voice: DrumVoice
  steps: string
  /** Energía mínima de la sección para que suene (1-5). */
  minEnergy: number
  /** ¿Suena en un break? (el bombo y el bajo no). */
  inBreak?: boolean
}

export interface DrumPattern {
  id: string
  label: string
  layers: Layer[]
  /** Swing de las semicorcheas pares (0 = recto; 0,1 = un 10 % de semicorchea tarde). */
  swing: number
}

export const DRUM_PATTERNS: DrumPattern[] = [
  {
    id: 'house',
    label: 'house (bombo 4×4, hat abierto a contratiempo, palmas, congas)',
    swing: 0.08,
    layers: [
      { voice: 'kick', steps: 'x...x...x...x...', minEnergy: 1 },
      { voice: 'openhat', steps: '..x...x...x...x.', minEnergy: 2, inBreak: true },
      { voice: 'clap', steps: '....x.......x...', minEnergy: 3, inBreak: true },
      { voice: 'shaker', steps: 'oxoxoxoxoxoxoxox', minEnergy: 3, inBreak: true },
      { voice: 'conga', steps: '...o..x....o.x..', minEnergy: 3, inBreak: true },
      { voice: 'congaHi', steps: '......o.......x.', minEnergy: 4, inBreak: true },
      { voice: 'hat', steps: 'o.o.o.o.o.o.o.o.', minEnergy: 4 }
    ]
  },
  {
    id: 'techno',
    label: 'techno (bombo 4×4 seco, hats rodando, palma en 2 y 4)',
    swing: 0,
    layers: [
      { voice: 'kick', steps: 'x...x...x...x...', minEnergy: 1 },
      { voice: 'openhat', steps: '..x...x...x...x.', minEnergy: 2, inBreak: true },
      { voice: 'hat', steps: 'oooooooooooooooo', minEnergy: 3, inBreak: true },
      { voice: 'clap', steps: '....x.......x...', minEnergy: 3 },
      { voice: 'rim', steps: '...o..o....o..o.', minEnergy: 4, inBreak: true }
    ]
  },
  {
    id: 'dembow',
    label: 'dembow (reggaetón)',
    swing: 0,
    layers: [
      { voice: 'kick', steps: 'x...x...x...x...', minEnergy: 1 },
      { voice: 'snare', steps: '...x..x....x..x.', minEnergy: 2, inBreak: true },
      { voice: 'hat', steps: 'o.o.o.o.o.o.o.o.', minEnergy: 3, inBreak: true },
      { voice: 'rim', steps: '......o.......o.', minEnergy: 4, inBreak: true }
    ]
  },
  {
    id: 'trap',
    label: 'trap (808, palma en el 3, hats en semicorcheas)',
    swing: 0,
    layers: [
      { voice: 'sub808', steps: 'x.........x.....', minEnergy: 1 },
      { voice: 'kick', steps: 'x.........x.....', minEnergy: 1 },
      { voice: 'clap', steps: '........x.......', minEnergy: 2, inBreak: true },
      { voice: 'hat', steps: 'xoxoxoxoxoxoxxxx', minEnergy: 3, inBreak: true },
      { voice: 'openhat', steps: '..............x.', minEnergy: 4 }
    ]
  }
]

export function findPattern(id: string | null | undefined): DrumPattern | null {
  return DRUM_PATTERNS.find((p) => p.id === id) ?? null
}

export interface DrumSection {
  name: string
  /** Compás de inicio (1 = el primero). */
  startBar: number
  bars: number
  energy?: number
}

/** ¿Es un break (sin bombo)? */
export function isBreak(name: string): boolean {
  return /break|puente|bridge|breakdown/i.test(name)
}

/** Compases de subida antes de un coro. */
const BUILD_BARS = 2

/**
 * Golpes de batería de toda la canción. `intensity` (−2…+2) sube o baja la energía de
 * todas las secciones (más o menos capas). Pulsos absolutos desde el compás 1.
 */
export function drumPlan(
  sections: DrumSection[],
  beatsPerBar: number,
  pattern: DrumPattern,
  { intensity = 0 }: { intensity?: number } = {}
): DrumHit[] {
  const hits: DrumHit[] = []
  const stepBeats = beatsPerBar / 16
  const sorted = [...sections].sort((a, b) => a.startBar - b.startBar)
  const energyOf = (s: DrumSection | undefined): number =>
    Math.max(1, Math.min(5, (s?.energy ?? 3) + intensity))
  const last = sorted.at(-1)
  const songEnd = last ? last.startBar - 1 + last.bars : 0

  sorted.forEach((s, i) => {
    const energy = energyOf(s)
    const next = sorted[i + 1]
    // Subida: la sección siguiente es un coro o un drop (bastante más energía).
    const build = next && energyOf(next) >= energy + 2 && s.bars >= BUILD_BARS + 2
    const brk = isBreak(s.name)
    const isIntro = i === 0
    for (let b = 0; b < s.bars; b++) {
      const bar = s.startBar - 1 + b
      const barBeat = bar * beatsPerBar
      const inBuild = build && b >= s.bars - BUILD_BARS
      const lastOfSong = bar === songEnd - 1
      for (const layer of pattern.layers) {
        if (energy < layer.minEnergy) continue
        if (brk && !layer.inBreak) continue
        // La intro arranca sin bombo: entra a la mitad, como en una sesión de DJ.
        if (isIntro && (layer.voice === 'kick' || layer.voice === 'sub808') && b < s.bars / 2) {
          continue
        }
        // En la subida se van quitando capas suaves para dejar sitio al redoble.
        if (inBuild && (layer.voice === 'shaker' || layer.voice === 'congaHi')) continue
        for (let step = 0; step < 16; step++) {
          const ch = layer.steps[step]
          if (ch !== 'x' && ch !== 'o') continue
          let beat = barBeat + step * stepBeats
          if (step % 2 === 1) beat += pattern.swing * stepBeats
          // El hueco antes del drop: el último pulso de la subida va sin bombo.
          const gap = inBuild && b === s.bars - 1 && beat >= barBeat + beatsPerBar - 1
          if (gap && (layer.voice === 'kick' || layer.voice === 'sub808')) continue
          // El final: solo el primer golpe del último compás.
          if (lastOfSong && step > 0) continue
          hits.push({
            beat,
            voice: layer.voice,
            vel: (ch === 'x' ? 1 : 0.55) * velocityJitter(bar, step, layer.voice),
            ...(layer.voice === 'sub808' && { lengthBeats: 2 })
          })
        }
      }
      if (inBuild) addBuildBar(hits, barBeat, beatsPerBar, b === s.bars - 1)
      // Un fill cada 8 compases (menos donde ya hay subida o al final).
      else if ((b + 1) % 8 === 0 && b < s.bars - 1 && !lastOfSong && energy >= 3) {
        addFill(hits, barBeat, beatsPerBar)
      }
    }
    if (build) {
      hits.push({
        beat: (s.startBar - 1 + s.bars - BUILD_BARS) * beatsPerBar,
        voice: 'riser',
        vel: 0.8,
        lengthBeats: BUILD_BARS * beatsPerBar
      })
    }
    // Las secciones fuertes entran con un platillo.
    if (energy >= 5 && i > 0) {
      hits.push({ beat: (s.startBar - 1) * beatsPerBar, voice: 'crash', vel: 1 })
    }
  })
  return hits.sort((a, b) => a.beat - b.beat)
}

/** Un compás de subida: redoble en corcheas que pasa a semicorcheas y crece. */
function addBuildBar(hits: DrumHit[], barBeat: number, beatsPerBar: number, final: boolean): void {
  const per = final ? 4 : 2 // golpes por pulso
  const total = beatsPerBar * per
  for (let k = 0; k < total; k++) {
    const progress = (k + (final ? total : 0)) / (2 * total)
    hits.push({ beat: barBeat + k / per, voice: 'snare', vel: 0.35 + 0.6 * progress })
  }
}

/** Fill de fin de frase: tres golpes de conga y palma en el último pulso. */
function addFill(hits: DrumHit[], barBeat: number, beatsPerBar: number): void {
  const at = barBeat + beatsPerBar - 1
  hits.push({ beat: at, voice: 'conga', vel: 0.8 })
  hits.push({ beat: at + 0.25, voice: 'congaHi', vel: 0.7 })
  hits.push({ beat: at + 0.5, voice: 'snare', vel: 0.6 })
  hits.push({ beat: at + 0.75, voice: 'snare', vel: 0.8 })
}

/** Variación de intensidad pequeña y siempre igual (no suena a máquina, pero es repetible). */
function velocityJitter(bar: number, step: number, voice: string): number {
  let h = (bar * 131 + step * 17 + voice.length * 7) % 97
  h = (h * 37 + 11) % 97
  return 0.9 + (h / 97) * 0.1
}

/** Pulsos donde suena el bombo (para el sidechain de la cama). */
export function kickBeats(hits: DrumHit[]): number[] {
  return hits.filter((h) => h.voice === 'kick').map((h) => h.beat)
}
