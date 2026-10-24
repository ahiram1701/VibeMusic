import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import {
  APPLIO_VERSION,
  type VoiceConvertOptions,
  type VoiceEngineStatus,
  type VoiceModel
} from '@shared/voice'
import { defaultPythonCandidates, pickPython, runLogged } from '../sidecar/python'

// Motor de "Mi voz": RVC a través de Applio (MIT), en un entorno de Python propio.
//   · instala Applio (versión fija), PyTorch para CPU y los modelos base (ContentVec,
//     RMVPE, FCPE) en una carpeta corta (~2 GB)
//   · guarda los modelos de voz que importa el usuario (.pth y .index)
//   · convierte un WAV a la voz elegida lanzando la CLI de Applio
// Va aparte del motor local: Applio fija sus versiones de torch y transformers.

const APPLIO_ZIP = `https://codeload.github.com/IAHispano/Applio/zip/refs/tags/${APPLIO_VERSION}`
const TORCH_CPU = 'https://download.pytorch.org/whl/cpu'
/** Lo que no hace falta para convertir (interfaz, GPU de Windows, TTS, tiempo real). */
const SKIP_REQUIREMENT =
  /^(torch|torchaudio)==|onnxruntime-gpu|nvidia-|tensorboard|matplotlib|edge-tts|sounddevice|webrtcvad|uvicorn|fastapi|websockets|beautifulsoup4/

/** Requisitos de Applio para convertir en este equipo (de su requirements-engine.txt). */
export function engineRequirements(applioRequirements: string): string {
  const keep = applioRequirements
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('-r') && !SKIP_REQUIREMENT.test(l))
  // En Windows Applio solo pide onnxruntime-gpu: aquí basta el de CPU.
  return [...keep.filter((l) => !l.startsWith('onnxruntime')), 'onnxruntime>=1.17'].join('\n')
}

/** Nombre de carpeta seguro a partir del nombre que ve el usuario. */
export function voiceId(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return slug || 'voz'
}

/** Argumentos de `core.py infer`. FCPE es el detector de afinación más rápido en CPU. */
export function inferArgs(
  input: string,
  output: string,
  model: { pth: string; index: string | null },
  opts: VoiceConvertOptions
): string[] {
  return [
    'core.py',
    'infer',
    '--input-path',
    input,
    '--output-path',
    output,
    '--pth-path',
    model.pth,
    '--index-path',
    model.index ?? '',
    '--pitch',
    String(Math.max(-24, Math.min(24, Math.round(opts.pitch)))),
    '--f0-method',
    'fcpe',
    '--index-rate',
    model.index ? '0.5' : '0',
    '--protect',
    '0.4',
    '--export-format',
    'WAV'
  ]
}

interface Marker {
  version: string
  installedAt: string
}

export class VoiceEngine {
  private state: VoiceEngineStatus = { state: 'checking' }
  private listeners = new Set<(s: VoiceEngineStatus) => void>()
  private logListeners = new Set<(line: string) => void>()
  private running = new Map<string, ChildProcess>()

  constructor(
    /** Carpeta del motor. Debe ser CORTA (rutas largas de PyTorch en Windows). */
    private readonly dir: string,
    private readonly findPython: () => Promise<string[]> = defaultPythonCandidates
  ) {}

  private get venv(): string {
    return join(this.dir, 'venv')
  }
  private get python(): string {
    return process.platform === 'win32'
      ? join(this.venv, 'Scripts', 'python.exe')
      : join(this.venv, 'bin', 'python')
  }
  private get applio(): string {
    return join(this.dir, 'applio')
  }
  private get voicesDir(): string {
    return join(this.dir, 'voices')
  }
  private get markerFile(): string {
    return join(this.dir, 'vibemusic-installed.json')
  }

  onStatus(fn: (s: VoiceEngineStatus) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  onLog(fn: (line: string) => void): () => void {
    this.logListeners.add(fn)
    return () => this.logListeners.delete(fn)
  }
  private set(s: VoiceEngineStatus): void {
    this.state = s
    for (const fn of this.listeners) fn(s)
  }
  private readonly log = (line: string): void => {
    for (const fn of this.logListeners) fn(line)
  }

  async status(): Promise<VoiceEngineStatus> {
    if (this.state.state === 'checking') {
      this.set((await this.installed()) ? { state: 'ready' } : { state: 'not-installed' })
    }
    return this.state
  }

  private async installed(): Promise<boolean> {
    if (!existsSync(this.python) || !existsSync(join(this.applio, 'core.py'))) return false
    try {
      const m = JSON.parse(await readFile(this.markerFile, 'utf8')) as Marker
      return m.version === APPLIO_VERSION
    } catch {
      return false
    }
  }

  /** Instala Applio, PyTorch (CPU) y los modelos base. Conserva las voces importadas. */
  async install(): Promise<void> {
    if (this.state.state === 'installing') throw new Error('Ya se está instalando')
    const step = (s: string): void => this.set({ state: 'installing', step: s })
    try {
      step('Buscando Python…')
      const base = await pickPython(await this.findPython(), this.log)
      await rm(this.venv, { recursive: true, force: true })
      await rm(this.applio, { recursive: true, force: true })
      await mkdir(this.dir, { recursive: true })

      step('Creando el entorno…')
      await runLogged(base[0], [...base.slice(1), '-m', 'venv', this.venv], this.log)

      step(`Descargando Applio ${APPLIO_VERSION}…`)
      const res = await fetch(APPLIO_ZIP)
      if (!res.ok) throw new Error(`No se pudo descargar Applio (${res.status})`)
      const zip = join(this.dir, 'applio.zip')
      await writeFile(zip, new Uint8Array(await res.arrayBuffer()))
      const tmp = join(this.dir, 'applio-tmp')
      await rm(tmp, { recursive: true, force: true })
      await runLogged(this.python, ['-m', 'zipfile', '-e', zip, tmp], this.log)
      await rename(join(tmp, `Applio-${APPLIO_VERSION}`), this.applio)
      await rm(tmp, { recursive: true, force: true })
      await rm(zip, { force: true })

      const pip = (args: string[]): Promise<void> =>
        runLogged(this.python, ['-m', 'pip', '--disable-pip-version-check', ...args], this.log)
      step('Instalando PyTorch (CPU, ~200 MB)…')
      await pip(['install', 'torch==2.11.0', 'torchaudio==2.11.0', '--index-url', TORCH_CPU])

      step('Instalando Applio (~1 GB)…')
      const req = join(this.dir, 'requirements-vibemusic.txt')
      await writeFile(
        req,
        engineRequirements(await readFile(join(this.applio, 'requirements-engine.txt'), 'utf8'))
      )
      await pip(['install', '-r', req])

      step('Descargando los modelos base (~600 MB)…')
      await runLogged(
        this.python,
        ['core.py', 'prerequisites', '--no-pretraineds-hifigan', '--models', '--no-exe'],
        this.log,
        { cwd: this.applio }
      )

      const marker: Marker = { version: APPLIO_VERSION, installedAt: new Date().toISOString() }
      await writeFile(this.markerFile, JSON.stringify(marker, null, 2))
      this.log('✓ "Mi voz" instalado.')
      this.set({ state: 'ready' })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.log(`✗ ${message}`)
      this.set({ state: 'error', error: `La instalación falló: ${message}` })
      throw new Error(message, { cause: err })
    }
  }

  /** Borra el motor (no las voces importadas). */
  async uninstall(): Promise<void> {
    for (const p of this.running.values()) p.kill()
    await rm(this.venv, { recursive: true, force: true })
    await rm(this.applio, { recursive: true, force: true })
    await rm(this.markerFile, { force: true })
    this.set({ state: 'not-installed' })
  }

  async listVoices(): Promise<VoiceModel[]> {
    if (!existsSync(this.voicesDir)) return []
    const out: VoiceModel[] = []
    const dirs = (await readdir(this.voicesDir, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
    for (const id of dirs) {
      const files = await this.voiceFiles(id)
      if (!files) continue
      let name = id
      try {
        name = (
          JSON.parse(await readFile(join(this.voicesDir, id, 'voice.json'), 'utf8')) as {
            name: string
          }
        ).name
      } catch {
        // sin metadatos: el nombre es la carpeta
      }
      out.push({ id, name, hasIndex: !!files.index })
    }
    return out
  }

  private async voiceFiles(id: string): Promise<{ pth: string; index: string | null } | null> {
    const dir = join(this.voicesDir, id)
    if (!existsSync(dir)) return null
    const files = await readdir(dir)
    const pth = files.find((f) => f.toLowerCase().endsWith('.pth'))
    const index = files.find((f) => f.toLowerCase().endsWith('.index'))
    return pth ? { pth: join(dir, pth), index: index ? join(dir, index) : null } : null
  }

  /**
   * Importa una voz: un .zip (con el .pth y el .index dentro) o los archivos sueltos.
   * Si hay varios .pth, se queda con el más reciente por nombre (el de más épocas).
   */
  async importVoice(paths: string[], name?: string): Promise<VoiceModel> {
    if (paths.length === 0) throw new Error('No se eligió ningún archivo')
    const zip = paths.find((p) => extname(p).toLowerCase() === '.zip')
    const staging = join(this.dir, 'import-tmp')
    await rm(staging, { recursive: true, force: true })
    await mkdir(staging, { recursive: true })
    try {
      let files: string[]
      if (zip) {
        if (!existsSync(this.python)) {
          throw new Error('Instala primero "Mi voz" (Ajustes) para poder importar un .zip')
        }
        await runLogged(this.python, ['-m', 'zipfile', '-e', zip, staging], this.log)
        files = await listFilesDeep(staging)
      } else {
        files = paths
      }
      const pths = files
        .filter((f) => f.toLowerCase().endsWith('.pth'))
        // Los checkpoints de entrenamiento (G_*.pth, D_*.pth) no son la voz.
        .filter((f) => !/^[GD]_/.test(basename(f)))
        .sort()
      const pth = pths.at(-1)
      if (!pth) throw new Error('No hay ningún modelo de voz (.pth) en lo que elegiste')
      const index = files
        .filter((f) => f.toLowerCase().endsWith('.index'))
        .sort((a, b) => Number(/added/i.test(b)) - Number(/added/i.test(a)))[0]

      const display = (name ?? basename(pth, extname(pth)).replace(/_\d+e_\d+s$/, '')).trim()
      let id = voiceId(display)
      const taken = new Set((await this.listVoices()).map((v) => v.id))
      for (let n = 2; taken.has(id); n++) id = `${voiceId(display)}-${n}`
      const dest = join(this.voicesDir, id)
      await mkdir(dest, { recursive: true })
      await copyFile(pth, join(dest, 'model.pth'))
      if (index) await copyFile(index, join(dest, 'model.index'))
      await writeFile(join(dest, 'voice.json'), JSON.stringify({ name: display }, null, 2))
      this.log(`✓ Voz "${display}" importada${index ? '' : ' (sin .index: algo menos fiel)'}.`)
      return { id, name: display, hasIndex: !!index }
    } finally {
      await rm(staging, { recursive: true, force: true })
    }
  }

  async removeVoice(id: string): Promise<void> {
    if (!/^[a-z0-9-]+$/.test(id)) throw new Error('Voz no válida')
    await rm(join(this.voicesDir, id), { recursive: true, force: true })
  }

  /**
   * Convierte `input` (WAV) a la voz `voice` y escribe `output` (WAV). En CPU tarda
   * unas 2–3 veces la duración del audio. `onStage` informa del paso actual.
   */
  async convert(
    requestId: string,
    input: string,
    output: string,
    voice: string,
    opts: VoiceConvertOptions,
    onStage: (stage: string) => void
  ): Promise<void> {
    if (!(await this.installed())) {
      throw new Error('"Mi voz" no está instalado. Instálalo en Ajustes → Mi voz.')
    }
    const model = await this.voiceFiles(voice)
    if (!model) throw new Error(`No existe la voz "${voice}". Impórtala en Ajustes → Mi voz.`)
    onStage('Cargando el modelo de voz…')
    const tail: string[] = []
    await new Promise<void>((resolve, reject) => {
      const p = spawn(this.python, inferArgs(input, output, model, opts), {
        cwd: this.applio,
        windowsHide: true,
        env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' }
      })
      this.running.set(requestId, p)
      const onData = (d: Buffer): void => {
        for (const line of d
          .toString()
          .split(/\r?\n|\r/)
          .filter((l) => l.trim())) {
          tail.push(line)
          if (tail.length > 8) tail.shift()
          this.log(line)
          if (/Converting audio/i.test(line)) onStage('Convirtiendo a tu voz…')
        }
      }
      p.stdout?.on('data', onData)
      p.stderr?.on('data', onData)
      p.on('error', reject)
      p.on('exit', (code, signal) => {
        this.running.delete(requestId)
        if (signal || code === null) reject(new Error('Cancelado'))
        else if (code !== 0 || !existsSync(output)) {
          reject(new Error(`La conversión de voz falló. ${tail.slice(-2).join(' ')}`.trim()))
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

async function listFilesDeep(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await listFilesDeep(full)))
    else out.push(full)
  }
  return out
}
