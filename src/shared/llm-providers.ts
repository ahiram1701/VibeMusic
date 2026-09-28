// Catálogo de proveedores de LLM para el productor.
// Casi todos exponen una API compatible con OpenAI Chat Completions, así que basta
// con su URL; "Personalizado" admite cualquier otro servicio compatible.
// Añadir un proveedor nuevo = añadir una entrada aquí.

export type LlmProviderKind = 'anthropic' | 'openai-compatible'

export interface LlmProviderPreset {
  id: string
  label: string
  kind: LlmProviderKind
  group: 'Nube' | 'En tu equipo' | 'Otro'
  /** URL base de la API (compatible con OpenAI). Vacía si la pone el usuario. */
  baseUrl: string
  /** El usuario puede cambiar la URL (servidores locales, personalizado). */
  urlEditable: boolean
  /** true = obligatoria; 'optional' = se envía si existe. */
  needsKey: boolean | 'optional'
  /** Modelo sugerido. Vacío = el usuario elige de la lista del proveedor. */
  defaultModel: string
  keyUrl?: string
  /** Nombre del parámetro de límite de tokens que acepta el proveedor. */
  tokensParam: 'max_completion_tokens' | 'max_tokens'
  hint?: string
}

export const CUSTOM_PROVIDER_ID = 'custom'
export const FAKE_PROVIDER_ID = 'fake'

export const LLM_PROVIDERS: LlmProviderPreset[] = [
  {
    id: 'anthropic',
    label: 'Anthropic · Claude',
    kind: 'anthropic',
    group: 'Nube',
    baseUrl: '',
    urlEditable: false,
    needsKey: true,
    defaultModel: 'claude-opus-5',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    tokensParam: 'max_tokens',
    hint: 'Recomendado: el que mejor sigue instrucciones musicales complejas.'
  },
  {
    id: 'groq',
    label: 'Groq',
    kind: 'openai-compatible',
    group: 'Nube',
    baseUrl: 'https://api.groq.com/openai/v1',
    urlEditable: false,
    needsKey: true,
    defaultModel: 'llama-3.3-70b-versatile',
    keyUrl: 'https://console.groq.com/keys',
    tokensParam: 'max_completion_tokens',
    hint: 'Muy rápido y con capa gratuita. Los modelos gpt-oss no hacen acciones en paralelo.'
  },
  {
    id: 'openai',
    label: 'OpenAI',
    kind: 'openai-compatible',
    group: 'Nube',
    baseUrl: 'https://api.openai.com/v1',
    urlEditable: false,
    needsKey: true,
    defaultModel: '',
    keyUrl: 'https://platform.openai.com/api-keys',
    tokensParam: 'max_completion_tokens'
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    kind: 'openai-compatible',
    group: 'Nube',
    baseUrl: 'https://openrouter.ai/api/v1',
    urlEditable: false,
    needsKey: true,
    defaultModel: '',
    keyUrl: 'https://openrouter.ai/keys',
    tokensParam: 'max_tokens',
    hint: 'Un solo acceso a cientos de modelos de distintas empresas.'
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    kind: 'openai-compatible',
    group: 'Nube',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    urlEditable: false,
    needsKey: true,
    defaultModel: '',
    keyUrl: 'https://aistudio.google.com/apikey',
    tokensParam: 'max_tokens'
  },
  {
    id: 'mistral',
    label: 'Mistral',
    kind: 'openai-compatible',
    group: 'Nube',
    baseUrl: 'https://api.mistral.ai/v1',
    urlEditable: false,
    needsKey: true,
    defaultModel: '',
    keyUrl: 'https://console.mistral.ai/api-keys',
    tokensParam: 'max_tokens'
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    kind: 'openai-compatible',
    group: 'Nube',
    baseUrl: 'https://api.deepseek.com/v1',
    urlEditable: false,
    needsKey: true,
    defaultModel: '',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    tokensParam: 'max_tokens'
  },
  {
    id: 'xai',
    label: 'xAI · Grok',
    kind: 'openai-compatible',
    group: 'Nube',
    baseUrl: 'https://api.x.ai/v1',
    urlEditable: false,
    needsKey: true,
    defaultModel: '',
    keyUrl: 'https://console.x.ai',
    tokensParam: 'max_tokens'
  },
  {
    id: 'ollama',
    label: 'Ollama',
    kind: 'openai-compatible',
    group: 'En tu equipo',
    baseUrl: 'http://localhost:11434/v1',
    urlEditable: true,
    needsKey: false,
    defaultModel: 'qwen3',
    tokensParam: 'max_tokens',
    hint: 'Gratis y privado. Usa un modelo con soporte de herramientas (p. ej. qwen3) y descárgalo antes con "ollama pull".'
  },
  {
    id: 'lmstudio',
    label: 'LM Studio',
    kind: 'openai-compatible',
    group: 'En tu equipo',
    baseUrl: 'http://localhost:1234/v1',
    urlEditable: true,
    needsKey: false,
    defaultModel: '',
    tokensParam: 'max_tokens',
    hint: 'Activa el servidor local en LM Studio (pestaña Developer) y carga un modelo con herramientas.'
  },
  {
    id: CUSTOM_PROVIDER_ID,
    label: 'Personalizado (compatible con OpenAI)',
    kind: 'openai-compatible',
    group: 'Otro',
    baseUrl: '',
    urlEditable: true,
    needsKey: 'optional',
    defaultModel: '',
    tokensParam: 'max_tokens',
    hint: 'Cualquier servicio con API compatible con OpenAI (Together, Fireworks, Cerebras, vLLM…). Pega su URL base, normalmente terminada en /v1.'
  }
]

export function findProvider(id: string): LlmProviderPreset | undefined {
  return LLM_PROVIDERS.find((p) => p.id === id)
}
