import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { encodeWav } from '../src/shared/wav'

/**
 * Prueba de humo de la app EMPAQUETADA (lo que se instala), no del modo desarrollo.
 * Detecta lo que solo falla fuera de dev: archivos que no entran en el paquete,
 * rutas a resources/, el worker del MP3 cargado desde file://…
 *
 *   npm run dist
 *   VIBE_PACKAGED_APP=release/0.1.0/win-unpacked/VibeMusic.exe npx playwright test packaged
 */
const exe = process.env['VIBE_PACKAGED_APP']
test.skip(!exe, 'Define VIBE_PACKAGED_APP con la ruta del ejecutable empaquetado')

let app: ElectronApplication
let page: Page
let workDir: string

test.beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'vibe-pkg-'))
  const sr = 48000
  const data = new Float32Array(sr * 2)
  for (let i = 0; i < data.length; i++) data[i] = 0.3 * Math.sin((2 * Math.PI * 220 * i) / sr)
  await writeFile(join(workDir, 'tono.wav'), encodeWav([data, data], sr))
  app = await electron.launch({
    executablePath: exe!,
    env: {
      ...process.env,
      VIBE_USER_DATA: join(workDir, 'userdata'),
      VIBE_ENGINE_DIR: join(workDir, 'engine'),
      VIBE_NO_UPDATES: '1'
    }
  })
  page = await app.firstWindow()
  page.on('pageerror', (e) => console.log('[pageerror]', e.message))
})

test.afterAll(async () => {
  await app?.close()
  await rm(workDir, { recursive: true, force: true })
})

test('arranca como app instalada y lleva el motor local dentro', async () => {
  const info = await app.evaluate(({ app }) => ({
    packaged: app.isPackaged,
    version: app.getVersion(),
    resources: process.resourcesPath
  }))
  expect(info.packaged).toBe(true)
  await expect(page.getByText(`v${info.version}`)).toBeVisible()

  const sidecar = join(info.resources, 'sidecar')
  for (const f of ['server.py', 'engine.py', 'separator.py', 'requirements.txt']) {
    expect(existsSync(join(sidecar, f)), f).toBe(true)
  }
  // Lo que no debe viajar en el instalador.
  expect(existsSync(join(sidecar, 'tests'))).toBe(false)
  expect(existsSync(join(sidecar, '.venv'))).toBe(false)
})

test('crear proyecto, importar, generar con Demo y exportar a MP3', async () => {
  const project = join(workDir, 'proyecto')
  const outDir = join(workDir, 'salida')
  await mkdir(outDir)
  await app.evaluate(
    ({ dialog }, p) => {
      const opens = [[p.project], [p.wav]]
      dialog.showOpenDialog = (async () => {
        const filePaths = opens.shift() ?? []
        return { canceled: filePaths.length === 0, filePaths }
      }) as typeof dialog.showOpenDialog
      dialog.showSaveDialog = (async () => ({
        canceled: false,
        filePath: p.mp3
      })) as typeof dialog.showSaveDialog
    },
    { project, wav: join(workDir, 'tono.wav'), mp3: join(outDir, 'mezcla.mp3') }
  )

  await page.getByRole('button', { name: 'Nuevo proyecto' }).click()
  await expect(page.getByText('Proyecto creado')).toBeVisible()
  await page.getByRole('button', { name: 'Importar audio…' }).click()
  await expect(page.getByText(/Importado tono/)).toBeVisible()

  await page.getByRole('tab', { name: 'Generar manual' }).click()
  await page.getByPlaceholder(/Describe el sonido/).fill('bajo de prueba')
  await page.getByLabel('Duración').selectOption('2')
  await page.getByLabel('Motor').selectOption('demo')
  await page.getByRole('button', { name: /^Generar 2 compases/ }).click()
  await expect(page.getByText('Añadido al timeline')).toBeVisible({ timeout: 15_000 })

  // El codificador MP3 es un worker aparte: fuera de dev se carga desde el paquete.
  await page.getByRole('button', { name: 'Exportar…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Exportar' })
  await dialog.getByLabel('Formato').selectOption('mp3')
  await dialog.getByRole('button', { name: 'Exportar', exact: true }).click()
  await expect(dialog).toBeHidden({ timeout: 30_000 })
  const mp3 = await readFile(join(outDir, 'mezcla.mp3'))
  expect(mp3.length).toBeGreaterThan(10_000)

  expect(existsSync(join(project, 'project.json'))).toBe(true)
})
