import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SettingsStore, type SecretCipher } from './settings'

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
      llm: { hasAnthropicKey: false }
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

  it('guarda la configuración del LLM y sus claves por separado', async () => {
    const file = join(dir, 'settings.json')
    const store = new SettingsStore(file, fakeCipher, {
      models: { anthropic: 'claude-opus-5', openai: 'gpt-5', ollama: 'qwen3' },
      ollamaUrl: 'http://localhost:11434'
    })
    await store.setLlm({ provider: 'ollama', model: { provider: 'ollama', name: ' llama4 ' } })
    await store.setSecret('anthropicKey', 'sk-ant-xyz')

    const pub = (await store.publicSettings()).llm
    expect(pub).toEqual({
      provider: 'ollama',
      models: { anthropic: 'claude-opus-5', openai: 'gpt-5', ollama: 'llama4' },
      ollamaUrl: 'http://localhost:11434',
      hasAnthropicKey: true,
      hasOpenaiKey: false
    })
    expect(await readFile(file, 'utf8')).not.toContain('sk-ant-xyz')
    expect(await store.getSecret('anthropicKey')).toBe('sk-ant-xyz')
  })
})
