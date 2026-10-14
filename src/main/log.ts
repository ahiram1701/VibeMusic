import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

// Registro en disco (userData/logs/main.log) de lo que pasa en trabajos largos: llamadas
// al LLM, reintentos y generaciones. Sin él, un fallo de madrugada no deja rastro.
// Pocas líneas por minuto: escribir de forma síncrona es más simple y no se pierde nada
// si la app se cierra de golpe.

const MAX_BYTES = 2 * 1024 * 1024

export function logDir(): string {
  return join(app.getPath('userData'), 'logs')
}

export function log(scope: string, message: string): void {
  try {
    const dir = logDir()
    const file = join(dir, 'main.log')
    mkdirSync(dir, { recursive: true })
    try {
      if (statSync(file).size > MAX_BYTES) renameSync(file, join(dir, 'main.old.log'))
    } catch {
      // aún no existe
    }
    appendFileSync(file, `${new Date().toISOString()} [${scope}] ${message}\n`)
  } catch {
    // El registro nunca debe romper la app.
  }
}
