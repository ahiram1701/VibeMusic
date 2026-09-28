import { describe, expect, it } from 'vitest'
import { barsToSeconds, buildMusicPrompt, requestSeconds } from './prompt'
import type { GenerationSpec } from './project'

const spec: GenerationSpec = {
  prompt: '  lo-fi hip hop, warm vinyl  ',
  bpm: 80,
  key: 'A minor',
  durationSec: 12,
  role: 'drums',
  mode: 'text'
}

describe('buildMusicPrompt', () => {
  it('añade rol, tempo y tonalidad al texto del usuario', () => {
    expect(buildMusicPrompt(spec)).toBe(
      'lo-fi hip hop, warm vinyl, drum loop only, percussion only, no melody, no bass, 80 bpm, in the key of A minor'
    )
  })

  it('omite la tonalidad si no hay', () => {
    expect(buildMusicPrompt({ ...spec, key: '', role: 'full' })).toBe(
      'lo-fi hip hop, warm vinyl, full arrangement, 80 bpm'
    )
  })
})

describe('duraciones', () => {
  it('4 compases de 4/4 a 120 BPM son 8 segundos', () => {
    expect(barsToSeconds(4, { bpm: 120, timeSignature: [4, 4] })).toBe(8)
  })

  it('redondea hacia arriba y respeta el máximo del proveedor', () => {
    expect(requestSeconds(8.6, 30)).toBe(9)
    expect(requestSeconds(45, 30)).toBe(30)
    expect(requestSeconds(0.2, 30)).toBe(1)
  })
})
