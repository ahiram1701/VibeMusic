import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { llmSecret, SettingsStore, type SecretCipher } from './settings'

// Cifrado de mentira (invierte el texto) para comprobar que el secreto no se guarda en claro.
const fakeCipher: SecretCipher = {
  isAvailable: () => true,
  encrypt: (s) => Buffer.from([...s].reverse().join('')),
  decrypt: (b) => [...b.toString()].reverse().join('')
}

describe('SettingsStore', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'vibe-set-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('guarda el token cifrado y solo expone si existe', async () => {
    const file = join(dir, 'settings.json')
    const store = new SettingsStore(file, fakeCipher)
    await store.setReplicateToken('r8_secreto')

    expect(await readFile(file, 'utf8')).not.toContain('r8_secreto')
    expect(await store.publicSettings()).toMatchObject({
      defaultProvider: 'demo',
      hasReplicateToken: true,
      llm: { keys: { anthropic: false } }
    })
    // Una instancia nueva (reinicio de la app) lo recupera.
    expect(await new SettingsStore(file, fakeCipher).getReplicateToken()).toBe('r8_secreto')

    await store.setReplicateToken(null)
    expect(await store.getReplicateToken()).toBeNull()
  })

  it('recuerda el proveedor por defecto', async () => {
    const file = join(dir, 'settings.json')
    await new SettingsStore(file, fakeCipher).setDefaultProvider('replicate')
    expect((await new SettingsStore(file, fakeCipher).publicSettings()).defaultProvider).toBe(
      'replicate'
    )
  })

  it('guarda proveedor, modelo, URL y clave de cualquier proveedor', async () => {
    const file = join(dir, 'settings.json')
    const store = new SettingsStore(file, fakeCipher)
    await store.setLlm({
      provider: 'groq',
      model: { provider: 'groq', name: ' openai/gpt-oss-120b ' }
    })
    await store.setLlm({ url: { provider: 'custom', url: 'https://api.together.xyz/v1/' } })
    await store.setSecret(llmSecret('groq'), 'gsk_secreto')

    const pub = (await store.publicSettings()).llm
    expect(pub.provider).toBe('groq')
    expect(pub.models.groq).toBe('openai/gpt-oss-120b')
    expect(pub.models.anthropic).toBe('claude-opus-5') // por defecto del catálogo
    expect(pub.urls.custom).toBe('https://api.together.xyz/v1')
    expect(pub.urls.ollama).toBe('http://localhost:11434/v1')
    expect(pub.keys).toMatchObject({ groq: true, anthropic: false })
    expect(await readFile(file, 'utf8')).not.toContain('gsk_secreto')
    expect(await store.llmConfig()).toEqual({
      provider: 'groq',
      model: 'openai/gpt-oss-120b',
      baseUrl: 'https://api.groq.com/openai/v1'
    })
  })

  it('rechaza proveedores desconocidos y URLs sin http', async () => {
    const store = new SettingsStore(join(dir, 'settings.json'), fakeCipher)
    await expect(store.setLlm({ provider: 'inventado' })).rejects.toThrow(/desconocido/)
    await expect(store.setLlm({ url: { provider: 'custom', url: 'ftp://x' } })).rejects.toThrow(
      /http/
    )
  })

  it('migra las claves y la URL de Ollama del formato anterior', async () => {
    const file = join(dir, 'settings.json')
    await writeFile(
      file,
      JSON.stringify({
        defaultProvider: 'replicate',
        llmProvider: 'anthropic',
        llmModels: { anthropic: 'claude-sonnet-5', openai: '', ollama: 'llama3.1' },
        ollamaUrl: 'http://192.168.1.10:11434',
        secrets: { anthropicKey: fakeCipher.encrypt('sk-ant-viejo').toString('base64') }
      })
    )
    const store = new SettingsStore(file, fakeCipher)
    expect(await store.getSecret(llmSecret('anthropic'))).toBe('sk-ant-viejo')
    const pub = (await store.publicSettings()).llm
    expect(pub.keys.anthropic).toBe(true)
    expect(pub.models).toMatchObject({
      anthropic: 'claude-sonnet-5',
      ollama: 'llama3.1',
      groq: 'llama-3.3-70b-versatile'
    })
    expect(pub.urls.ollama).toBe('http://192.168.1.10:11434/v1')
  })
})
