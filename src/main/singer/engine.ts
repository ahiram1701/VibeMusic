import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SINGER_VOICE, type SingerEngineStatus } from '@shared/singer'

// Cantante local: OpenUtau sin interfaz (fork MIT "OpenUtau-Headless", compilado por
// el workflow singer-engine.yml) con un voicebank DiffSinger. Canta en este equipo, en
// CPU, a partir de un proyecto .ustx (ver shared/melody.ts). Se instala en una carpeta
// propia: el motor (~60 MB) desde las releases del repositorio y la voz (~550 MB)
// desde su enlace original, porque sus condiciones no permiten volver a subirla.

const ENGINE_TAG = 'singer-engine-v1'
const ENGINE_BASE = `https://github.com/ahiram1701/VibeMusic/releases/download/${ENGINE_TAG}`
const VOICE = {
  page: 'https://www.mediafire.com/file/ks3hpb5zldabo3s/Hoshino_Hanami_%257EAIdol%257E_for_DiffSinger_v1.0.zip/file',
  sha256: '91d9302cb220ba2c790a01973b0cc6ab1d84df3581582a1a4b1fb9acc4f65277',
  bytes: 549_903_782
}

/** Identificador de plataforma de .NET para el motor de este equipo. */
export function engineRid(platform = process.platform, arch = process.arch): string {
  if (platform === 'win32') return 'win-x64'
  if (platform === 'darwin') return arch === 'arm64' ? 'osx-arm64' : 'osx-x64'
  return 'linux-x64'
}

/** El enlace de descarga directa dentro de la página de MediaFire. */
export function mediafireDirectLink(html: string): string | null {
  return /href="(https:\/\/download[^"]+)"/.exec(html)?.[1] ?? null
}

/** Mensaje claro a partir de lo que imprime el motor al fallar ({status, code, error}). */
export function explainRenderFailure(code: number | null, stderr: string): string {
  let error = stderr.trim().split('\n').at(-1) ?? ''
  try {
    const parsed = JSON.parse(error) as { error?: unknown }
    error = typeof parsed.error === 'string' ? parsed.error : JSON.stringify(parsed.error)
  } catch {
    // no era JSON
  }
  if (code === 6) return `El cantante no sabe pronunciar parte de la letra: ${error}`
  if (code === 4) return 'Falta la voz del cantante. Reinstala el cantante local en Ajustes.'
  return `El cantante local falló (código ${code}). ${error.split('\n')[0].slice(0, 300)}`.trim()
}

interface Marker {
  engine: string
  voice: string
  installedAt: string
}

export class SingerEngine {
  private state: SingerEngineStatus = { state: 'checking' }
  private listeners = new Set<(s: SingerEngineStatus) => void>()
  private logListeners = new Set<(line: string) => void>()
  private running = new Map<string, ChildProcess>()

  constructor(
    private readonly dir: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  private get engineDir(): string {
    return join(this.dir, 'engine')
  }
  private get dataDir(): string {
    return join(this.dir, 'data')
  }
  private get exe(): string {
    return join(this.engineDir, process.platform === 'win32' ? 'OpenUtau.Cli.exe' : 'OpenUtau.Cli')
  }
  private get markerFile(): string {
    return join(this.dir, 'vibemusic-installed.json')
  }

  onStatus(fn: (s: SingerEngineStatus) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  onLog(fn: (line: string) => void): () => void {
    this.logListeners.add(fn)
    return () => this.logListeners.delete(fn)
  }
  private set(s: SingerEngineStatus): void {
    this.state = s
    for (const fn of this.listeners) fn(s)
  }
  private readonly log = (line: string): void => {
    for (const fn of this.logListeners) fn(line)
  }

  async status(): Promise<SingerEngineStatus> {
    if (this.state.state === 'checking') {
      this.set((await this.installed()) ? { state: 'ready' } : { state: 'not-installed' })
    }
    return this.state
  }

  private async installed(): Promise<boolean> {
    if (!existsSync(this.exe)) return false
    if (!existsSync(join(this.dataDir, 'Singers', SINGER_VOICE.singerId))) return false
    try {
      const m = JSON.parse(await readFile(this.markerFile, 'utf8')) as Marker
      return m.engine === ENGINE_TAG
    } catch {
      return false
    }
  }

  /**
   * Descarga y prepara el motor y la voz. VIBE_SINGER_ENGINE_ZIP y VIBE_SINGER_VOICE_ZIP
   * permiten usar archivos locales (desarrollo y pruebas).
   */
  async install(): Promise<void> {
    if (this.state.state === 'installing') throw new Error('Ya se está instalando')
    const step = (s: string): void => this.set({ state: 'installing', step: s })
    try {
      await rm(this.engineDir, { recursive: true, force: true })
      await mkdir(this.dir, { recursive: true })

      step('Descargando el motor de canto (~60 MB)…')
      const rid = engineRid()
      const engineZip =
        process.env['VIBE_SINGER_ENGINE_ZIP'] ??
        (await this.download(`${ENGINE_BASE}/openutau-cli-${rid}.zip`, 'engine.zip', {
          sha256: await this.remoteSha(`${ENGINE_BASE}/openutau-cli-${rid}.zip.sha256`),
          label: 'el motor'
        }))
      step('Preparando el motor…')
      await this.extract(engineZip, this.engineDir)
      if (!existsSync(this.exe)) throw new Error('El paquete del motor no trae OpenUtau.Cli')

      const singers = join(this.dataDir, 'Singers')
      if (!existsSync(join(singers, SINGER_VOICE.singerId))) {
        step(`Descargando la voz ${SINGER_VOICE.name} (~550 MB, de su enlace original)…`)
        let voiceZip = process.env['VIBE_SINGER_VOICE_ZIP']
        if (!voiceZip) {
          const page = await this.fetchImpl(VOICE.page)
          const link = page.ok ? mediafireDirectLink(await page.text()) : null
          if (!link) {
            throw new Error(
              'No se pudo obtener el enlace de descarga de la voz (MediaFire). Prueba más tarde.'
            )
          }
          voiceZip = await this.download(link, 'voice.zip', {
            sha256: VOICE.sha256,
            bytes: VOICE.bytes,
            label: `la voz ${SINGER_VOICE.name}`,
            onProgress: (pct) =>
              step(`Descargando la voz ${SINGER_VOICE.name} (${pct}% de ~550 MB)…`)
          })
        }
        step('Preparando la voz…')
        await mkdir(singers, { recursive: true })
        await this.extract(voiceZip, singers)
        if (!process.env['VIBE_SINGER_VOICE_ZIP']) await rm(voiceZip, { force: true })
      }
      if (!process.env['VIBE_SINGER_ENGINE_ZIP']) await rm(engineZip, { force: true })

      const marker: Marker = {
        engine: ENGINE_TAG,
        voice: SINGER_VOICE.singerId,
        installedAt: new Date().toISOString()
      }
      await writeFile(this.markerFile, JSON.stringify(marker, null, 2))
      this.log('✓ Cantante local instalado.')
      this.set({ state: 'ready' })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.log(`✗ ${message}`)
      this.set({ state: 'error', error: `La instalación falló: ${message}` })
      throw new Error(message, { cause: err })
    }
  }

  private async remoteSha(url: string): Promise<string | undefined> {
    const res = await this.fetchImpl(url)
    if (!res.ok) return undefined
    return (await res.text()).trim().split(/\s+/)[0]?.toLowerCase()
  }

  /** Descarga a la carpeta del cantante comprobando tamaño y SHA-256. */
  private async download(
    url: string,
    name: string,
    opts: {
      sha256?: string
      bytes?: number
      label: string
      onProgress?: (pct: number) => void
    }
  ): Promise<string> {
    this.log(`Descargando ${url}`)
    const res = await this.fetchImpl(url)
    if (!res.ok || !res.body) {
      throw new Error(`No se pudo descargar ${opts.label} (${res.status})`)
    }
    const path = join(this.dir, name)
    const out = createWriteStream(path)
    const hash = createHash('sha256')
    const total = opts.bytes ?? Number(res.headers.get('content-length') ?? 0)
    let done = 0
    let lastPct = -1
    const reader = res.body.getReader()
    try {
      for (;;) {
        const { value, done: end } = await reader.read()
        if (end) break
        hash.update(value)
        done += value.byteLength
        if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()))
        const pct = total ? Math.floor((done / total) * 100) : 0
        if (pct !== lastPct && pct % 5 === 0) {
          lastPct = pct
          opts.onProgress?.(pct)
        }
      }
    } finally {
      await new Promise<void>((r) => out.end(r))
    }
    const digest = hash.digest('hex')
    if (opts.sha256 && digest !== opts.sha256) {
      await rm(path, { force: true })
      throw new Error(`La descarga de ${opts.label} está dañada (SHA-256 no coincide)`)
    }
    return path
  }

  /** Descomprime un .zip con las herramientas del sistema (tar en Windows/macOS, unzip en Linux). */
  private async extract(zip: string, dest: string): Promise<void> {
    await mkdir(dest, { recursive: true })
    // En Windows, el tar del sistema (bsdtar, lee .zip); otro "tar" del PATH (p. ej. el
    // de Git) es GNU tar, que no abre .zip y confunde "C:" con un servidor remoto.
    const tar =
      process.platform === 'win32'
        ? join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'tar.exe')
        : 'tar'
    const [cmd, args] =
      process.platform === 'linux'
        ? ['unzip', ['-q', '-o', zip, '-d', dest]]
        : [tar, ['-xf', zip, '-C', dest]]
    await new Promise<void>((resolve, reject) => {
      const p = spawn(cmd, args, { windowsHide: true })
      let err = ''
      p.stderr?.on('data', (d: Buffer) => (err += d.toString()))
      p.on('error', reject)
      p.on('exit', (code) =>
        code === 0 ? resolve() : reject(new Error(`No se pudo descomprimir (${err.trim()})`))
      )
    })
  }

  async uninstall(): Promise<void> {
    this.killAll()
    await rm(this.dir, { recursive: true, force: true })
    this.set({ state: 'not-installed' })
  }

  /** Canta el proyecto `ustx` y escribe la voz en `output` (WAV). */
  async render(
    requestId: string,
    ustx: string,
    output: string,
    onStage: (stage: string) => void
  ): Promise<void> {
    if (!(await this.installed())) {
      throw new Error('El cantante local no está instalado. Instálalo en Ajustes → Cantante local.')
    }
    onStage('Cantando la melodía…')
    let stderr = ''
    await new Promise<void>((resolve, reject) => {
      const p = spawn(
        this.exe,
        ['render', '--project', ustx, '--output', output, '--data-path', this.dataDir],
        { windowsHide: true, env: { ...process.env, OPENUTAU_CLI_LOG: 'Error' } }
      )
      this.running.set(requestId, p)
      p.stdout?.on('data', (d: Buffer) => this.log(d.toString().trim()))
      p.stderr?.on('data', (d: Buffer) => {
        stderr += d.toString()
        this.log(d.toString().trim())
      })
      p.on('error', reject)
      p.on('exit', (code, signal) => {
        this.running.delete(requestId)
        if (signal || code === null) reject(new Error('Cancelado'))
        else if (code !== 0 || !existsSync(output)) {
          reject(new Error(explainRenderFailure(code, stderr)))
        } else resolve()
      })
    })
  }

  cancel(requestId: string): void {
    this.running.get(requestId)?.kill()
  }

  killAll(): void {
    for (const p of this.running.values()) p.kill()
  }
}
