// Tipos del motor de audio local (sidecar Python) compartidos entre main y renderer.

export type TorchVariant = 'cpu' | 'cuda'

export interface LocalDevice {
  device: 'cpu' | 'cuda'
  gpu: string | null
  /** Por qué se usa CPU (p. ej. "GPU demasiado antigua"). */
  reason?: string
  loaded_model?: string | null
  threads?: number
}

export type LocalEngineStatus =
  | { state: 'checking' }
  | { state: 'not-installed' }
  | { state: 'installing'; variant: TorchVariant; step: string }
  | { state: 'stopped'; variant: TorchVariant; stems: boolean }
  | { state: 'starting'; variant: TorchVariant; stems: boolean }
  | { state: 'running'; variant: TorchVariant; stems: boolean; device?: LocalDevice }
  | { state: 'error'; error: string }

export interface LocalModel {
  id: string
  label: string
  ramGb: number
  note: string
}

/** Modelos del motor local (deben coincidir con MODELS en sidecar/engine.py). */
export const LOCAL_MODELS: LocalModel[] = [
  {
    id: 'facebook/musicgen-small',
    label: 'MusicGen small · mono',
    ramGb: 3,
    note: 'El único práctico en CPU. Rápido y ligero.'
  },
  {
    id: 'facebook/musicgen-stereo-small',
    label: 'MusicGen small · estéreo',
    ramGb: 3,
    note: 'Como el anterior, en estéreo.'
  },
  {
    id: 'facebook/musicgen-medium',
    label: 'MusicGen medium · mono',
    ramGb: 8,
    note: 'Mejor calidad. Recomendado solo con GPU.'
  },
  {
    id: 'facebook/musicgen-stereo-medium',
    label: 'MusicGen medium · estéreo',
    ramGb: 8,
    note: 'Mejor calidad en estéreo. Recomendado solo con GPU.'
  },
  {
    id: 'facebook/musicgen-large',
    label: 'MusicGen large · mono',
    ramGb: 16,
    note: 'La mejor calidad. Necesita una GPU potente.'
  }
]

export const DEFAULT_LOCAL_MODEL = LOCAL_MODELS[0].id
