import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join } from 'node:path'
import type { LocalDevice, LocalEngineStatus, TorchVariant } from '@shared/local-engine'

// Gestor del motor local (sidecar Python):
//   · instala un entorno virtual propio en una carpeta corta (no toca el Python del sistema)
//   · lo arranca en un puerto libre de 127.0.0.1 cuando hace falta y espera a que responda
//   · lo detiene al cerrar la app

const TORCH_INDEX: Record<TorchVariant, string | null> = {
  cpu: null, // PyPI: en Windows la rueda por defecto es solo CPU
  cuda: 'https://download.pytorch.org/whl/cu126'
}

export interface SidecarPaths {
  /** Carpeta con server.py, engine.py y requirements*.txt */
  sidecarDir: string
  /**
   * Carpeta del entorno Python. Debe ser una ruta CORTA: PyTorch tiene archivos con
   * rutas de ~140 caracteres y Windows, por defecto, no admite rutas de más de 260.
   */
  envDir: string
}

/** Longitud de la ruta más larga que instala PyTorch dentro del entorno (medida en torch 2.14). */
const DEEPEST_TORCH_PATH = 140
const WINDOWS_MAX_PATH = 259

const LONG_PATHS_HELP =
  'Windows no admite rutas tan largas en este equipo. Solución: activa las rutas largas (PowerShell como administrador: ' +
  'New-ItemProperty -Path "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\FileSystem" -Name LongPathsEnabled -Value 1 -PropertyType DWORD -Force) ' +
  'y reinicia el equipo, o usa un usuario de Windows con un nombre más corto.'

interface Marker {
  variant: TorchVariant
  installedAt: string
  /** Separación de pistas (Demucs) instalada. Ausente en instalaciones antiguas. */
  stems?: boolean
}

type Listener = (status: LocalEngineStatus) => void

export class SidecarManager {
  private proc: ChildProcess | null = null
  private port = 0
  private state: LocalEngineStatus = { state: 'checking' }
  private starting: Promise<void> | null = null
  private listeners = new Set<Listener>()
  private logListeners = new Set<(line: string) => void>()
  private stderrTail: string[] = []

  constructor(
    private readonly paths: SidecarPaths,
    private readonly findPython: () => Promise<string[]> = defaultPythonCandidates
  ) {}

  private get envDir(): string {
    return this.paths.envDir
  }
  private get python(): string {
    return process.platform === 'win32'
      ? join(this.envDir, 'Scripts', 'python.exe')
      : join(this.envDir, 'bin', 'python')
  }
  private get markerFile(): string {
    return join(this.envDir, 'vibemusic-installed.json')
  }

  onStatus(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  onLog(fn: (line: string) => void): () => void {
    this.logListeners.add(fn)
    return () => this.logListeners.delete(fn)
  }

  private set(status: LocalEngineStatus): void {
    this.state = status
    for (const fn of this.listeners) fn(status)
  }
  private log(line: string): void {
    for (const fn of this.logListeners) fn(line)
  }

  get baseUrl(): string {
    return `http://127.0.0.1:${this.port}`
  }

  async status(): Promise<LocalEngineStatus> {
    if (this.state.state === 'checking') this.set(await this.idleState())
    return this.state
  }

  /** Estado cuando no está en marcha: detenido (con sus funciones) o sin instalar. */
  private async idleState(): Promise<LocalEngineStatus> {
    const marker = await this.readMarker()
    return marker
      ? { state: 'stopped', variant: marker.variant, stems: this.hasStems(marker) }
      : { state: 'not-installed' }
  }

  private hasStems(marker: Marker): boolean {
    // Instalaciones anteriores no lo anotaban: se mira si el paquete está.
    const sitePackages =
      process.platform === 'win32' ? join(this.envDir, 'Lib', 'site-packages') : this.envDir
    return marker.stems ?? existsSync(join(sitePackages, 'demucs'))
  }

  private async readMarker(): Promise<Marker | null> {
    if (!existsSync(this.python)) return null
    try {
      return JSON.parse(await readFile(this.markerFile, 'utf8')) as Marker
    } catch {
      return null
    }
  }

  /** Crea el entorno e instala servidor, PyTorch (CPU o CUDA) y transformers. */
  async install(variant: TorchVariant): Promise<void> {
    if (this.state.state === 'installing') throw new Error('Ya se está instalando')
    await this.stop()
    this.set({ state: 'installing', variant, step: 'Buscando Python…' })
    let longPathError = false
    const offLog = this.onLog((line) => {
      if (/Long Path/i.test(line)) longPathError = true
    })
    try {
      if (process.platform === 'win32' && this.envDir.length + DEEPEST_TORCH_PATH > WINDOWS_MAX_PATH) {
        throw new Error(`La carpeta del motor (${this.envDir}) es demasiado larga. ${LONG_PATHS_HELP}`)
      }
      const base = await this.pickPython()
      await rm(this.envDir, { recursive: true, force: true })
      await mkdir(this.envDir, { recursive: true })

      this.set({ state: 'installing', variant, step: 'Creando el entorno…' })
      await this.run(base[0], [...base.slice(1), '-m', 'venv', this.envDir])
      const pip = (args: string[]): Promise<void> =>
        this.run(this.python, ['-m', 'pip', '--disable-pip-version-check', ...args])

      this.set({ state: 'installing', variant, step: 'Instalando el servidor…' })
      await pip(['install', '-r', join(this.paths.sidecarDir, 'requirements.txt')])

      this.set({
        state: 'installing',
        variant,
        step: `Instalando PyTorch (${variant === 'cuda' ? 'GPU NVIDIA, ~2.5 GB' : 'CPU, ~200 MB'})…`
      })
      const index = TORCH_INDEX[variant]
      await pip(['install', 'torch', ...(index ? ['--index-url', index] : [])])

      this.set({ state: 'installing', variant, step: 'Instalando transformers…' })
      await pip(['install', '-r', join(this.paths.sidecarDir, 'requirements-models.txt')])

      this.set({ state: 'installing', variant, step: 'Instalando la separación de pistas…' })
      await pip(['install', '-r', join(this.paths.sidecarDir, 'requirements-stems.txt')])

      const marker: Marker = { variant, installedAt: new Date().toISOString(), stems: true }
      await writeFile(this.markerFile, JSON.stringify(marker, null, 2))
      this.log('✓ Motor local instalado.')
      this.set({ state: 'stopped', variant, stems: true })
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err)
      const message = longPathError ? `${raw}. ${LONG_PATHS_HELP}` : raw
      this.log(`✗ ${message}`)
      this.set({ state: 'error', error: `La instalación falló: ${message}` })
      throw new Error(message, { cause: err })
    } finally {
      offLog()
    }
  }

  /** Añade la separación de pistas (Demucs) a una instalación existente. */
  async installStems(): Promise<void> {
    const marker = await this.readMarker()
    if (!marker) throw new Error('Instala primero el motor local')
    if (this.state.state === 'installing') throw new Error('Ya se está instalando')
    await this.stop()
    this.set({ state: 'installing', variant: marker.variant, step: 'Instalando la separación de pistas…' })
    try {
      await this.run(this.python, [
        '-m',
        'pip',
        '--disable-pip-version-check',
        'install',
        '-r',
        join(this.paths.sidecarDir, 'requirements-stems.txt')
      ])
      await writeFile(this.markerFile, JSON.stringify({ ...marker, stems: true }, null, 2))
      this.log('✓ Separación de pistas instalada.')
      this.set({ state: 'stopped', variant: marker.variant, stems: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.log(`✗ ${message}`)
      this.set({ state: 'error', error: `No se pudo instalar la separación de pistas: ${message}` })
      throw new Error(message, { cause: err })
    }
  }

  async uninstall(): Promise<void> {
    await this.stop()
    await rm(this.envDir, { recursive: true, force: true })
    this.set({ state: 'not-installed' })
  }

  /** Arranca el servidor si no está ya en marcha (seguro de llamar varias veces). */
  async ensureRunning(): Promise<void> {
    if (this.state.state === 'running' && this.proc) return
    this.starting ??= this.start().finally(() => {
      this.starting = null
    })
    return this.starting
  }

  private async start(): Promise<void> {
    const marker = await this.readMarker()
    if (!marker) {
      this.set({ state: 'not-installed' })
      throw new Error('El motor local no está instalado. Instálalo en Ajustes.')
    }
    const stems = this.hasStems(marker)
    this.set({ state: 'starting', variant: marker.variant, stems })
    this.port = await freePort()
    this.stderrTail = []
    const proc = spawn(this.python, [join(this.paths.sidecarDir, 'server.py')], {
      cwd: this.paths.sidecarDir,
      env: { ...process.env, VIBE_SIDECAR_PORT: String(this.port), PYTHONUNBUFFERED: '1' },
      windowsHide: true
    })
    this.proc = proc
    proc.stderr?.on('data', (d: Buffer) => {
      for (const line of d.toString().split(/\r?\n/).filter(Boolean)) {
        this.stderrTail = [...this.stderrTail, line].slice(-15)
        this.log(line)
      }
    })
    proc.on('exit', (code) => {
      if (this.proc !== proc) return
      this.proc = null
      const crashed = code !== 0 && code !== null && this.state.state !== 'stopped'
      this.set(
        crashed
          ? { state: 'error', error: `El motor local se cerró (código ${code}). ${this.stderrTail.slice(-3).join(' ')}` }
          : { state: 'stopped', variant: marker.variant, stems }
      )
    })

    // Espera a que /health responda (importar torch puede tardar en equipos lentos).
    const deadline = Date.now() + 90_000
    while (Date.now() < deadline) {
      if (!this.proc) break
      try {
        const res = await fetch(`${this.baseUrl}/health`)
        if (res.ok) {
          const health = (await res.json()) as { device: LocalDevice }
          this.set({ state: 'running', variant: marker.variant, stems, device: health.device })
          return
        }
      } catch {
        // aún arrancando
      }
      await new Promise((r) => setTimeout(r, 400))
    }
    await this.stop()
    const detail = this.stderrTail.slice(-3).join(' ')
    this.set({ state: 'error', error: `El motor local no arrancó. ${detail}`.trim() })
    throw new Error(`El motor local no arrancó. ${detail}`.trim())
  }

  async stop(): Promise<void> {
    const proc = this.proc
    if (!proc) return
    this.proc = null
    this.set(await this.idleState())
    await new Promise<void>((resolve) => {
      proc.once('exit', () => resolve())
      proc.kill()
      setTimeout(resolve, 3000)
    })
  }

  /** Detención inmediata al salir de la app (sin esperar). */
  killNow(): void {
    this.proc?.kill()
    this.proc = null
  }

  private async pickPython(): Promise<string[]> {
    const tried: string[] = []
    for (const candidate of await this.findPython()) {
      const cmd = candidate.split(' ')
      tried.push(candidate)
      try {
        const out = await this.capture(cmd[0], [
          ...cmd.slice(1),
          '-c',
          'import sys; print(f"{sys.version_info[0]}.{sys.version_info[1]}")'
        ])
        const [major, minor] = out.trim().split('.').map(Number)
        if (major === 3 && minor >= 10 && minor <= 13) {
          this.log(`Usando Python ${out.trim()} (${candidate})`)
          return cmd
        }
        this.log(`Python ${out.trim()} (${candidate}) no es compatible: hace falta 3.10–3.13`)
      } catch {
        // no existe ese comando
      }
    }
    throw new Error(
      `No se encontró Python 3.10–3.13 (probado: ${tried.join(', ')}). Instálalo desde python.org y vuelve a intentarlo.`
    )
  }

  /** Ejecuta un comando mostrando su salida en el registro. */
  private run(cmd: string, args: string[]): Promise<void> {
    this.log(`$ ${[cmd, ...args].join(' ')}`)
    return new Promise((resolve, reject) => {
      const p = spawn(cmd, args, { windowsHide: true, env: { ...process.env, PYTHONUNBUFFERED: '1' } })
      const onData = (d: Buffer): void => {
        for (const line of d.toString().split(/\r?\n/).filter(Boolean)) this.log(line)
      }
      p.stdout?.on('data', onData)
      p.stderr?.on('data', onData)
      p.on('error', reject)
      p.on('exit', (code) =>
        code === 0 ? resolve() : reject(new Error(`"${cmd} ${args.slice(0, 3).join(' ')}…" terminó con código ${code}`))
      )
    })
  }

  private capture(cmd: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const p = spawn(cmd, args, { windowsHide: true })
      let out = ''
      p.stdout?.on('data', (d: Buffer) => (out += d.toString()))
      p.on('error', reject)
      p.on('exit', (code) => (code === 0 ? resolve(out) : reject(new Error(`código ${code}`))))
    })
  }
}

async function defaultPythonCandidates(): Promise<string[]> {
  return process.platform === 'win32'
    ? ['py -3.12', 'py -3.11', 'py -3.13', 'python', 'py -3']
    : ['python3.12', 'python3.11', 'python3', 'python']
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      srv.close(() => (addr && typeof addr === 'object' ? resolve(addr.port) : reject(new Error('sin puerto'))))
    })
  })
}
