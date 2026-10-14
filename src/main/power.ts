import { powerSaveBlocker } from 'electron'
import { log } from './log'

/**
 * Impide que el equipo se suspenda mientras hay trabajo largo en marcha (el productor
 * o generaciones de audio). Si Windows se duerme a mitad de la noche, las conexiones
 * con Ollama y el motor local se cortan. La pantalla sí puede apagarse.
 */
export class KeepAwake {
  private reasons = new Set<string>()
  private blockerId: number | null = null

  set(reason: string, busy: boolean): void {
    if (busy) this.reasons.add(reason)
    else this.reasons.delete(reason)
    if (this.reasons.size > 0 && this.blockerId === null) {
      this.blockerId = powerSaveBlocker.start('prevent-app-suspension')
      log('power', `sin suspensión (${[...this.reasons].join(', ')})`)
    } else if (this.reasons.size === 0 && this.blockerId !== null) {
      powerSaveBlocker.stop(this.blockerId)
      this.blockerId = null
      log('power', 'suspensión permitida de nuevo')
    }
  }
}
