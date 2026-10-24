import { spawn } from 'node:child_process'

// Utilidades para los entornos de Python que instala la app (motor local y "Mi voz"):
// encontrar un Python compatible y ejecutar comandos mostrando su salida en el registro.

export async function defaultPythonCandidates(): Promise<string[]> {
  return process.platform === 'win32'
    ? ['py -3.12', 'py -3.11', 'py -3.13', 'python', 'py -3']
    : ['python3.12', 'python3.11', 'python3', 'python']
}

/** El primer Python 3.10–3.13 de la lista, como comando y argumentos (p. ej. ["py", "-3.12"]). */
export async function pickPython(
  candidates: string[],
  log: (line: string) => void
): Promise<string[]> {
  const tried: string[] = []
  for (const candidate of candidates) {
    const cmd = candidate.split(' ')
    tried.push(candidate)
    try {
      const out = await capture(cmd[0], [
        ...cmd.slice(1),
        '-c',
        'import sys; print(f"{sys.version_info[0]}.{sys.version_info[1]}")'
      ])
      const [major, minor] = out.trim().split('.').map(Number)
      if (major === 3 && minor >= 10 && minor <= 13) {
        log(`Usando Python ${out.trim()} (${candidate})`)
        return cmd
      }
      log(`Python ${out.trim()} (${candidate}) no es compatible: hace falta 3.10–3.13`)
    } catch {
      // no existe ese comando
    }
  }
  throw new Error(
    `No se encontró Python 3.10–3.13 (probado: ${tried.join(', ')}). Instálalo desde python.org y vuelve a intentarlo.`
  )
}

/** Ejecuta un comando mostrando su salida en el registro. */
export function runLogged(
  cmd: string,
  args: string[],
  log: (line: string) => void,
  opts: { cwd?: string; signal?: AbortSignal } = {}
): Promise<void> {
  log(`$ ${[cmd, ...args].join(' ')}`)
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, {
      cwd: opts.cwd,
      windowsHide: true,
      env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' }
    })
    const onAbort = (): void => void p.kill()
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    const onData = (d: Buffer): void => {
      // Las barras de progreso (tqdm) reescriben la línea con \r: solo cuenta la última.
      for (const line of d.toString().split(/\r?\n|\r/).filter((l) => l.trim())) log(line)
    }
    p.stdout?.on('data', onData)
    p.stderr?.on('data', onData)
    p.on('error', reject)
    p.on('exit', (code) => {
      opts.signal?.removeEventListener('abort', onAbort)
      if (opts.signal?.aborted) reject(new Error('Cancelado'))
      else if (code === 0) resolve()
      else reject(new Error(`"${cmd} ${args.slice(0, 3).join(' ')}…" terminó con código ${code}`))
    })
  })
}

export function capture(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true })
    let out = ''
    p.stdout?.on('data', (d: Buffer) => (out += d.toString()))
    p.on('error', reject)
    p.on('exit', (code) => (code === 0 ? resolve(out) : reject(new Error(`código ${code}`))))
  })
}
