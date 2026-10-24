// Tipos del cantante local (DiffSinger en OpenUtau) compartidos entre main y renderer.

export type SingerEngineStatus =
  | { state: 'checking' }
  | { state: 'not-installed' }
  | { state: 'installing'; step: string }
  | { state: 'ready' }
  | { state: 'error'; error: string }

/** La voz que canta: un voicebank DiffSinger descargado de su enlace original. */
export const SINGER_VOICE = {
  /** Nombre de la carpeta del voicebank (= id del cantante en OpenUtau). */
  singerId: 'Hoshino Hanami ~AIdol~ for DiffSinger v1.0',
  name: 'Hanami',
  description: 'voz femenina de pop, brillante (soprano)',
  credit: 'Hoshino Hanami ~AI❤dol~ (voicebank DiffSinger de Lotte V, lottev.moe)',
  termsUrl: 'https://github.com/lottev1991/LotteV-Voicebank-Update-Repo/blob/main/ToU_ES.md',
  /** Registro en el que suena bien (MIDI): G3–A5. */
  range: [55, 81] as [number, number],
  /** Registro recomendado al productor. */
  comfortable: 'E4–D5'
}

/** Proveedor con el que se guardan los clips del cantante local. */
export const SINGER_PROVIDER = 'diffsinger'
