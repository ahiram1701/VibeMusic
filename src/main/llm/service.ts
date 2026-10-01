import type { LlmProviderId, LlmRequest, LlmResponse } from '@shared/llm'
import { findProvider, type LlmProviderPreset } from '@shared/llm-providers'
import { llmSecret, type SettingsStore } from '../settings'
import { createAnthropicAdapter, listAnthropicModels } from './anthropic'
import { createFakeAdapter } from './fake'
import { createOllamaAdapter } from './ollama'
import { createOpenAiCompatibleAdapter, listOpenAiCompatibleModels } from './openai-compatible'
import { LlmError, type LlmAdapter } from './types'

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

  /** Proveedor, modelo, URL y clave listos para usar (o un error explicando qué falta). */
  private async resolve(
    providerId?: LlmProviderId,
    opts: { requireModel?: boolean; key?: string } = {}
  ): Promise<{ preset: LlmProviderPreset; model: string; baseUrl: string; key: string | null }> {
    const { provider, model, baseUrl } = await this.settings.llmConfig(providerId)
    const preset = findProvider(provider)
    if (!preset) throw new LlmError(`Proveedor desconocido: ${provider}`, 'config')
    const key = opts.key ?? (await this.settings.getSecret(llmSecret(provider)))
    if (preset.needsKey === true && !key) {
      throw new LlmError(`Falta la API key de ${preset.label}. Añádela en Ajustes.`, 'config')
    }
    if (preset.kind === 'openai-compatible' && !baseUrl) {
      throw new LlmError(`Falta la URL de ${preset.label}. Añádela en Ajustes.`, 'config')
    }
    if (opts.requireModel !== false && !model) {
      throw new LlmError(`Elige un modelo de ${preset.label} en Ajustes.`, 'config')
    }
    return { preset, model, baseUrl, key }
  }

  private async adapter(): Promise<LlmAdapter> {
    if (this.allowFake) return createFakeAdapter()
    const { preset, model, baseUrl, key } = await this.resolve()
    if (preset.kind === 'anthropic') return createAnthropicAdapter(key!, model)
    // Ollama por su API nativa: es la única que permite pedir más contexto.
    if (preset.id === 'ollama') return createOllamaAdapter({ baseUrl, model })
    return createOpenAiCompatibleAdapter({
      baseUrl,
      apiKey: key ?? undefined,
      model,
      label: preset.label,
      tokensParam: preset.tokensParam
    })
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

  /** Modelos que ofrece el proveedor (para elegir sin adivinar nombres). */
  async listModels(providerId: LlmProviderId, key?: string): Promise<string[]> {
    const { preset, baseUrl, key: k } = await this.resolve(providerId, { requireModel: false, key })
    return preset.kind === 'anthropic'
      ? listAnthropicModels(k!)
      : listOpenAiCompatibleModels(baseUrl, k ?? undefined, preset.label)
  }

  /** Comprueba la clave pidiendo la lista de modelos y, si funciona, la guarda cifrada. */
  async setKey(providerId: LlmProviderId, key: string): Promise<string> {
    const clean = key.trim()
    const models = await this.listModels(providerId, clean)
    await this.settings.setSecret(llmSecret(providerId), clean)
    return `${models.length} modelos disponibles`
  }

  /** Prueba la conexión con la configuración guardada. */
  async test(providerId: LlmProviderId): Promise<string> {
    const models = await this.listModels(providerId)
    return `${models.length} modelos disponibles`
  }
}
