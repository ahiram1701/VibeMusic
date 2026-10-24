// Tipos de "Mi voz" (conversión de voz con RVC) compartidos entre main y renderer.
// Una voz cantada cualquiera (la de ACE-Step o la de una pista separada) se convierte
// al timbre de un modelo RVC entrenado con la voz del usuario.

export type VoiceEngineStatus =
  | { state: 'checking' }
  | { state: 'not-installed' }
  | { state: 'installing'; step: string }
  | { state: 'ready' }
  | { state: 'error'; error: string }

/** Un modelo de voz importado (archivo .pth de RVC, con su .index si lo tenía). */
export interface VoiceModel {
  id: string
  name: string
  hasIndex: boolean
}

export interface VoiceConvertOptions {
  /** Semitonos (-24..24): +12 sube una octava (voz grave → aguda), -12 la baja. */
  pitch: number
}

/** Versión de Applio (la implementación de RVC que se instala). */
export const APPLIO_VERSION = '3.6.6'
