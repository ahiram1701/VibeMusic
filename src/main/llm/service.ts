import type { LlmProviderId, LlmRequest, LlmResponse } from '@shared/llm'
import type { SettingsStore } from '../settings'
import { createAnthropicAdapter, verifyAnthropicKey } from './anthropic'
import { createFakeAdapter } from './fake'
import { createOpenAiCompatibleAdapter, verifyOpenAiCompatible } from './openai-compatible'
import { LlmError, type LlmAdapter } from './types'

const OPENAI_URL = 'https://api.openai.com/v1'

/**
 * Punto único para hablar con el LLM configurado. Las claves se leen aquí (proceso
 * principal) y nunca viajan al renderer; cada petición se puede cancelar por id.
 */
export class LlmService {
  private controllers = new Map<string, AbortController>()

  constructor(
    private readonly settings: SettingsStore,
    private readonly allowFake = false
  ) {}

  private async adapter(): Promise<LlmAdapter> {
    const { provider, models, ollamaUrl } = await this.settings.llmConfig()
    if (this.allowFake) return createFakeAdapter()
    switch (provider) {
      case 'anthropic': {
        const key = await this.settings.getSecret('anthropicKey')
        if (!key) throw new LlmError('Falta la API key de Anthropic. Añádela en Ajustes.', 'config')
        return createAnthropicAdapter(key, models.anthropic)
      }
      case 'openai': {
        const key = await this.settings.getSecret('openaiKey')
        if (!key) throw new LlmError('Falta la API key de OpenAI. Añádela en Ajustes.', 'config')
        return createOpenAiCompatibleAdapter({
          baseUrl: OPENAI_URL,
          apiKey: key,
          model: models.openai,
          label: 'OpenAI',
          tokensParam: 'max_completion_tokens'
        })
      }
      case 'ollama':
        return createOpenAiCompatibleAdapter({
          baseUrl: `${ollamaUrl.replace(/\/$/, '')}/v1`,
          model: models.ollama,
          label: 'Ollama',
          tokensParam: 'max_tokens'
        })
      case 'fake':
        throw new LlmError('Proveedor de pruebas no disponible', 'config')
    }
  }

  async chat(
    requestId: string,
    req: LlmRequest,
    onText: (delta: string) => void
  ): Promise<LlmResponse> {
    const controller = new AbortController()
    this.controllers.set(requestId, controller)
    try {
      return await (await this.adapter()).chat(req, onText, controller.signal)
    } finally {
      this.controllers.delete(requestId)
    }
  }

  cancel(requestId: string): void {
    this.controllers.get(requestId)?.abort()
  }

  /** Comprueba y guarda una clave. Devuelve un texto de confirmación o lanza un error. */
  async setKey(
    provider: Extract<LlmProviderId, 'anthropic' | 'openai'>,
    key: string
  ): Promise<string> {
    const clean = key.trim()
    const info =
      provider === 'anthropic'
        ? await verifyAnthropicKey(clean)
        : await verifyOpenAiCompatible(OPENAI_URL, clean)
    await this.settings.setSecret(provider === 'anthropic' ? 'anthropicKey' : 'openaiKey', clean)
    return info
  }

  async testOllama(): Promise<string> {
    const { ollamaUrl } = await this.settings.llmConfig()
    return verifyOpenAiCompatible(`${ollamaUrl.replace(/\/$/, '')}/v1`)
  }
}
