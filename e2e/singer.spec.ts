import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'

// Cantante local de punta a punta: el productor (LLM falso) compone una canción con
// melodía, el instrumental se genera con Demo y OpenUtau canta la voz en este equipo.
// Necesita el cantante ya instalado: VIBE_SINGER_IT_DIR=<carpeta>. No corre en CI.

const singerDir = process.env['VIBE_SINGER_IT_DIR']
test.skip(!singerDir, 'Define VIBE_SINGER_IT_DIR con un cantante local instalado')

let app: ElectronApplication
let workDir: string

test.beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'vibe-e2e-singer-'))
  app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      VIBE_USER_DATA: join(workDir, 'userdata'),
      VIBE_ENGINE_DIR: join(workDir, 'engine'),
      VIBE_VOICE_DIR: join(workDir, 'voice'),
      VIBE_SINGER_DIR: singerDir!,
      VIBE_PROJECTS_DIR: workDir,
      VIBE_FAKE_LLM: '1'
    }
  })
})

test.afterAll(async () => {
  await app?.close()
  await rm(workDir, { recursive: true, force: true })
})

test('el productor compone con melodía y el cantante local la canta en su pista', async () => {
  test.setTimeout(5 * 60_000)
  const page = await app.firstWindow()
  await page.getByRole('button', { name: 'Nuevo proyecto' }).click()
  await page.getByRole('button', { name: 'Crear' }).click()

  await page.getByRole('tab', { name: 'Productor' }).click()
  await page.getByPlaceholder(/Describe/).fill('Haz una canción corta y canta la letra')
  await page.keyboard.press('Enter')

  await expect(page.getByText('Listo: canción cantada.')).toBeVisible({ timeout: 4 * 60_000 })
  // La voz va en su propia pista, debajo del instrumental.
  await expect(page.getByText('Voz · Hanami').first()).toBeVisible()
  await expect(page.locator('ol li').first()).toContainText('voz cantada')

  // La letra aparece en el editor, con el aviso del cantante local.
  await page.getByRole('tab', { name: 'Letra' }).click()
  await expect(page.locator('textarea').nth(1)).toHaveValue('Ay amor, ven a bailar')
  await expect(page.getByText(/vuelve a cantar la pista de voz/)).toBeVisible()
})
