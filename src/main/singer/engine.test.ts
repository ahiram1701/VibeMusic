import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildUstx, placeMelody } from '@shared/melody'
import { SINGER_VOICE } from '@shared/singer'
import { engineRid, explainRenderFailure, mediafireDirectLink, SingerEngine } from './engine'

describe('SingerEngine (cantante local)', () => {
  it('elige el motor de cada plataforma', () => {
    expect(engineRid('win32', 'x64')).toBe('win-x64')
    expect(engineRid('darwin', 'arm64')).toBe('osx-arm64')
    expect(engineRid('linux', 'x64')).toBe('linux-x64')
  })

  it('encuentra el enlace directo en la página de MediaFire', () => {
    const html =
      '<a class="input popsok" aria-label="Download file" href="https://download2391.mediafire.com/abc/voz.zip" id="downloadButton">'
    expect(mediafireDirectLink(html)).toBe('https://download2391.mediafire.com/abc/voz.zip')
    expect(mediafireDirectLink('<html></html>')).toBeNull()
  })

  it('explica los fallos del motor', () => {
    expect(explainRenderFailure(6, '{"status":"failed","code":6,"error":"tick 480: xyz"}')).toMatch(
      /no sabe pronunciar.*tick 480: xyz/
    )
    expect(explainRenderFailure(4, '')).toMatch(/Falta la voz/)
    expect(explainRenderFailure(5, 'boom')).toBe('El cantante local falló (código 5). boom')
  })

  it('sin instalar no canta', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vibe-singer-'))
    try {
      const engine = new SingerEngine(dir)
      expect(await engine.status()).toEqual({ state: 'not-installed' })
      await expect(engine.render('r', 'a.ustx', 'b.wav', () => undefined)).rejects.toThrow(
        /no está instalado/
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

// Prueba real (lenta): instala desde archivos locales y canta una frase en español.
// VIBE_SINGER_IT=1 con VIBE_SINGER_ENGINE_ZIP y VIBE_SINGER_VOICE_ZIP. No corre en CI.
describe.skipIf(!process.env['VIBE_SINGER_IT'])('SingerEngine real', () => {
  it(
    'instala y canta un .ustx generado por buildUstx',
    async () => {
      const dir = await mkdtemp(join(tmpdir(), 'vibe-singer-it-'))
      try {
        const engine = new SingerEngine(dir)
        await engine.install()
        expect(await engine.status()).toEqual({ state: 'ready' })
        const notes = placeMelody(
          [
            {
              name: 'Coro',
              startBar: 1,
              bars: 4,
              melody: [
                { text: 'Ay amor, ven a bailar', notes: 'E5:1 D5:0.5 C5:1.5 B4 C5 D5 C5:2' },
                { text: 'que la noche va a empezar', notes: 'C5:0.5 B4:0.5 A4 G4 A4 B4 C5 B4 A4' }
              ]
            }
          ],
          4,
          { strict: true, range: SINGER_VOICE.range }
        )
        const ustx = join(dir, 'prueba.ustx')
        const wav = join(dir, 'prueba.wav')
        await writeFile(
          ustx,
          buildUstx({
            singer: SINGER_VOICE.singerId,
            language: 'es',
            bpm: 100,
            beatsPerBar: 4,
            notes
          })
        )
        const stages: string[] = []
        await engine.render('it', ustx, wav, (s) => stages.push(s))
        expect(existsSync(wav)).toBe(true)
        expect(stages).toEqual(['Cantando la melodía…'])
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    },
    10 * 60_000
  )
})
