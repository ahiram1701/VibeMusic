import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import type { UpdateStatus } from '../src/shared/update'
import pkg from '../package.json'

// Actualizaciones: novedades tras actualizar, progreso de la descarga y Ajustes.
// Arranque propio: los ajustes guardados simulan venir de una versión anterior.

let workDir: string
let app: ElectronApplication | undefined

/** Abre la app y la recuerda para cerrarla en afterAll aunque la prueba falle. */
const launch = async (): Promise<ElectronApplication> =>
  (app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      VIBE_USER_DATA: join(workDir, 'userdata'),
      VIBE_ENGINE_DIR: join(workDir, 'engine'),
      VIBE_PROJECTS_DIR: workDir,
      VIBE_FAKE_LLM: '1'
    }
  }))

const sendStatus = (target: ElectronApplication, status: UpdateStatus): Promise<void> =>
  target.evaluate(({ BrowserWindow }, s) => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('app:update-status', s)
  }, status)

test.beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'vibe-e2e-upd-'))
  await mkdir(join(workDir, 'userdata'), { recursive: true })
  await writeFile(
    join(workDir, 'userdata', 'settings.json'),
    JSON.stringify({
      lastRunVersion: '0.0.1',
      pendingReleaseNotes: {
        version: pkg.version,
        notes:
          '<h2>Novedades</h2><ul><li><strong>Barra de descarga</strong> <script>window.hacked = 1</script>' +
          '<a href="javascript:alert(1)">truco</a> <a href="https://example.com">enlace</a></li></ul>' +
          "<h2>What's Changed</h2><ul><li>Bump algo by @dependabot</li></ul>"
      }
    })
  )
})

test.afterAll(async () => {
  await app?.close()
  // Windows tarda un poco en soltar los archivos de la app cerrada.
  await rm(workDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

test('tras actualizar muestra las novedades una sola vez, sin código ni la lista de PRs', async () => {
  let electronApp = await launch()
  let page = await electronApp.firstWindow()
  const dialog = page.getByRole('dialog', { name: `Novedades de VibeMusic ${pkg.version}` })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('Barra de descarga')
  await expect(dialog).not.toContainText("What's Changed")
  await expect(dialog.getByRole('link', { name: 'enlace' })).toHaveAttribute(
    'href',
    'https://example.com'
  )
  // El enlace javascript: queda como texto y el <script> no se ejecuta.
  await expect(dialog.getByRole('link', { name: 'truco' })).toHaveCount(0)
  expect(await page.evaluate(() => (window as { hacked?: number }).hacked)).toBeUndefined()
  await dialog.getByRole('button', { name: 'Entendido' }).click()
  await expect(dialog).toBeHidden()

  const saved = JSON.parse(await readFile(join(workDir, 'userdata', 'settings.json'), 'utf8'))
  expect(saved.lastRunVersion).toBe(pkg.version)

  // Al volver a abrir la misma versión ya no aparece.
  await electronApp.close()
  electronApp = await launch()
  page = await electronApp.firstWindow()
  await expect(page.getByRole('button', { name: 'Nuevo proyecto' })).toBeVisible()
  await page.waitForTimeout(500)
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // Descarga: barra con progreso; ocultarla no oculta luego el aviso de "lista".
  const card = page.getByRole('status')
  await expect(async () => {
    await sendStatus(electronApp, { state: 'downloading', version: '9.9.9', percent: 45 })
    await expect(card).toContainText('Descargando VibeMusic 9.9.9', { timeout: 500 })
  }).toPass()
  await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '45')
  await expect(card).toContainText('45 %')
  await page.getByRole('button', { name: 'Ocultar' }).click()
  await expect(card).toHaveCount(0)
  await sendStatus(electronApp, { state: 'downloading', version: '9.9.9', percent: 80 })
  await expect(card).toHaveCount(0)
  await sendStatus(electronApp, { state: 'ready', version: '9.9.9' })
  await expect(page.getByRole('button', { name: 'Reiniciar ahora' })).toBeVisible()

  // Ajustes → Actualizaciones refleja el mismo estado.
  await page.getByRole('button', { name: 'Nuevo proyecto' }).click()
  await page.getByRole('button', { name: 'Crear' }).click()
  await page.getByRole('button', { name: '⚙ Ajustes' }).click()
  const section = page.getByRole('region', { name: 'Actualizaciones' })
  await expect(section).toContainText(`Versión ${pkg.version}`)
  await expect(section).toContainText('La versión 9.9.9 está lista')
  await expect(section.getByRole('button', { name: 'Reiniciar e instalar' })).toBeVisible()

  await sendStatus(electronApp, { state: 'error', error: 'getaddrinfo ENOTFOUND github.com' })
  await expect(section).toContainText('No se pudo comprobar: sin conexión a internet.')
  await expect(section.getByRole('button', { name: 'Buscar actualizaciones' })).toBeEnabled()

  // En desarrollo, el proceso principal informa de que no hay actualizaciones.
  await section.getByRole('button', { name: 'Buscar actualizaciones' }).click()
  await expect(section).toContainText('solo funcionan en la app instalada')
  await expect(section.getByRole('button', { name: /actualizaciones|instalar/i })).toHaveCount(0)
})
