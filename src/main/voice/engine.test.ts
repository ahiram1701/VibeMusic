import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { engineRequirements, inferArgs, VoiceEngine, voiceId } from './engine'

describe('VoiceEngine (Mi voz)', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'vibe-voice-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('instala solo lo necesario para convertir en CPU', () => {
    const req = engineRequirements(
      [
        '-r requirements-engine.txt',
        '# comentario',
        'numpy==2.4.6',
        'torch==2.11.0',
        'torchaudio==2.11.0',
        'torchcrepe==0.0.24',
        'transformers==5.13.1',
        'matplotlib==3.11.0',
        'tensorboard==2.21.0',
        'onnxruntime>=1.17.0; sys_platform != "win32"',
        'onnxruntime-gpu==1.22.0; sys_platform == "win32"',
        'nvidia-cublas-cu12==12.9.2.10; sys_platform == "win32"',
        'fastapi>=0.110.0'
      ].join('\n')
    )
    expect(req.split('\n')).toEqual([
      'numpy==2.4.6',
      'torchcrepe==0.0.24',
      'transformers==5.13.1',
      'onnxruntime>=1.17'
    ])
  })

  it('voiceId da nombres de carpeta seguros', () => {
    expect(voiceId('Mi Voz Ñandú!')).toBe('mi-voz-nandu')
    expect(voiceId('***')).toBe('voz')
  })

  it('inferArgs usa FCPE, acota el tono y no usa índice si no hay', () => {
    const args = inferArgs('in.wav', 'out.wav', { pth: 'v.pth', index: null }, { pitch: 30.4 })
    const opt = (k: string): string => args[args.indexOf(k) + 1]
    expect(opt('--f0-method')).toBe('fcpe')
    expect(opt('--pitch')).toBe('24')
    expect(opt('--index-path')).toBe('')
    expect(opt('--index-rate')).toBe('0')
    const withIndex = inferArgs('a', 'b', { pth: 'v.pth', index: 'v.index' }, { pitch: -12 })
    expect(withIndex[withIndex.indexOf('--index-rate') + 1]).toBe('0.5')
    expect(withIndex[withIndex.indexOf('--pitch') + 1]).toBe('-12')
  })

  it('importa una voz suelta (.pth + .index), ignora los checkpoints y no repite nombres', async () => {
    const src = join(dir, 'src')
    await rm(src, { recursive: true, force: true })
    await mkdir(src, { recursive: true })
    const files = ['G_2333.pth', 'alberto_250e_5000s.pth', 'added_IVF_alberto.index']
    for (const f of files) await writeFile(join(src, f), f)
    const engine = new VoiceEngine(join(dir, 'engine'))

    const a = await engine.importVoice(files.map((f) => join(src, f)))
    expect(a).toEqual({ id: 'alberto', name: 'alberto', hasIndex: true })
    expect((await readdir(join(dir, 'engine', 'voices', 'alberto'))).sort()).toEqual([
      'model.index',
      'model.pth',
      'voice.json'
    ])
    const b = await engine.importVoice([join(src, 'alberto_250e_5000s.pth')], 'Alberto')
    expect(b).toEqual({ id: 'alberto-2', name: 'Alberto', hasIndex: false })
    expect(await engine.listVoices()).toEqual([a, b])

    await engine.removeVoice('alberto')
    expect((await engine.listVoices()).map((v) => v.id)).toEqual(['alberto-2'])
    await expect(engine.removeVoice('../etc')).rejects.toThrow(/no válida/)
  })

  it('sin .pth explica qué falta, y sin instalar no convierte', async () => {
    const engine = new VoiceEngine(join(dir, 'engine'))
    const only = join(dir, 'x.index')
    await writeFile(only, 'x')
    await expect(engine.importVoice([only])).rejects.toThrow(/\.pth/)
    expect(await engine.status()).toEqual({ state: 'not-installed' })
    await expect(
      engine.convert('r', 'in.wav', 'out.wav', 'alberto', { pitch: 0 }, () => undefined)
    ).rejects.toThrow(/no está instalado/)
  })
})

// Prueba real con Applio instalado (lenta): VIBE_VOICE_IT=<carpeta del motor> y una voz
// "prueba" importada, más VIBE_VOICE_IT_INPUT=<wav>. No corre en CI.
const realDir = process.env['VIBE_VOICE_IT']
describe.skipIf(!realDir)('VoiceEngine real', () => {
  it(
    'convierte un WAV con Applio',
    async () => {
      const engine = new VoiceEngine(realDir!)
      expect(await engine.status()).toEqual({ state: 'ready' })
      const out = join(tmpdir(), `vibe-voice-it-${Date.now()}.wav`)
      const stages: string[] = []
      await engine.convert(
        'it',
        process.env['VIBE_VOICE_IT_INPUT']!,
        out,
        'prueba',
        { pitch: 0 },
        (s) => stages.push(s)
      )
      expect(stages).toContain('Convirtiendo a tu voz…')
      await rm(out, { force: true })
    },
    10 * 60_000
  )
})
