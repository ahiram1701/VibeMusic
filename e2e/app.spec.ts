import { mkdtemp, rm, writeFile } from 'node:fs/promises'
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

let app: ElectronApplication
let page: Page
let workDir: string

/** WAV de prueba: un tono de `seconds` segundos. */
async function makeWav(path: string, seconds: number, freq: number): Promise<void> {
  const sr = 48000
  const data = new Float32Array(sr * seconds)
  for (let i = 0; i < data.length; i++) data[i] = 0.3 * Math.sin((2 * Math.PI * freq * i) / sr)
  await writeFile(path, encodeWav([data, data], sr))
}

/** Sustituye los diálogos nativos de archivo por respuestas predefinidas, en orden. */
async function queueDialogs(answers: string[][]): Promise<void> {
  await app.evaluate(({ dialog }, queue) => {
    dialog.showOpenDialog = (async () => {
      const filePaths = queue.shift() ?? []
      return { canceled: filePaths.length === 0, filePaths }
    }) as typeof dialog.showOpenDialog
  }, answers)
}

const playButton = (): ReturnType<Page['getByRole']> =>
  page.getByRole('button', { name: /Play|Stop/ })

const playheadX = (): Promise<number> =>
  page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('.bg-white.w-px')
    return el ? new DOMMatrix(getComputedStyle(el).transform).m41 : -1
  })

test.beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'vibe-e2e-'))
  await makeWav(join(workDir, 'drums.wav'), 2, 110)
  await makeWav(join(workDir, 'bass.wav'), 2, 55)
  app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      VIBE_USER_DATA: join(workDir, 'userdata'),
      // Carpeta del motor local propia: las pruebas no deben ver el motor del usuario.
      VIBE_ENGINE_DIR: join(workDir, 'engine'),
      VIBE_FAKE_LLM: '1',
      // Disco lento a propósito: destapa carreras entre guardar y deshacer.
      VIBE_TEST_SAVE_DELAY_MS: '120'
    }
  })
  page = await app.firstWindow()
  // Cualquier error de la página hace fallar la prueba con un mensaje claro.
  page.on('pageerror', (e) => console.log('[pageerror]', e.message))
  page.on('console', (m) => m.type() === 'error' && console.log('[console.error]', m.text()))
})

test.afterAll(async () => {
  await app?.close()
  await rm(workDir, { recursive: true, force: true })
})

test('crear proyecto e importar dos pistas', async () => {
  await queueDialogs([
    [join(workDir, 'proyecto')],
    [join(workDir, 'drums.wav'), join(workDir, 'bass.wav')]
  ])
  await page.getByRole('button', { name: 'Nuevo proyecto' }).click()
  await expect(page.getByText('Proyecto creado')).toBeVisible()

  await page.getByRole('button', { name: 'Importar audio…' }).click()
  await expect(page.getByText(/Importado drums, bass/)).toBeVisible()
})

test('play/stop con el botón y la línea de reproducción avanza', async () => {
  await playButton().click()
  await expect(playButton()).toHaveText('■ Stop')
  const x1 = await playheadX()
  await page.waitForTimeout(600)
  const x2 = await playheadX()
  expect(x2).toBeGreaterThan(x1)

  await playButton().click()
  await expect(playButton()).toHaveText('▶ Play')
  // La línea se redibuja en el siguiente fotograma: se espera a que se asiente
  // antes de medir (en máquinas lentas, como el CI, puede tardar un poco).
  await page.waitForTimeout(150)
  const stoppedAt = await playheadX()
  await page.waitForTimeout(400)
  expect(await playheadX()).toBe(stoppedAt) // parada de verdad
})

test('Espacio alterna play/stop aunque el botón tenga el foco', async () => {
  await playButton().focus()
  await page.keyboard.press('Space')
  await expect(playButton()).toHaveText('■ Stop')
  await page.keyboard.press('Space')
  await expect(playButton()).toHaveText('▶ Play')
})

test('al llegar al final se para y vuelve al inicio', async () => {
  await page.getByRole('button', { name: '⏮' }).click()
  await playButton().click()
  await expect(playButton()).toHaveText('■ Stop')
  // Las pistas duran 2 s: debe pararse sola.
  await expect(playButton()).toHaveText('▶ Play', { timeout: 5000 })
  await expect(page.getByText('1.1', { exact: true })).toBeVisible()
  // Y se puede volver a reproducir.
  await playButton().click()
  await expect(playButton()).toHaveText('■ Stop')
  await playButton().click()
})

test('restaurar recupera exactamente cada versión', async () => {
  const mute = page.getByRole('button', { name: 'M', exact: true }).first()
  // Clics rápidos seguidos: antes se pisaban las versiones.
  await mute.click()
  await mute.click()
  await mute.click()

  const items = page.locator('ol li')
  await expect(items.filter({ hasText: /^v5 / })).toBeVisible()
  const ids = await items.locator('span.text-muted').allTextContents()
  expect(new Set(ids).size).toBe(ids.length) // sin números repetidos

  const messages = await items.allTextContents()
  expect(messages.slice(0, 3).map((m) => m.replace(/volver aquí|actual/, ''))).toEqual([
    'v5 drums: mute',
    'v4 drums: unmute',
    'v3 drums: mute'
  ])

  const restore = (v: number): Promise<void> =>
    items
      .filter({ hasText: new RegExp(`^v${v} `) })
      .getByRole('button', { name: 'volver aquí' })
      .click()

  await restore(4) // sin mute
  await expect(mute).not.toHaveClass(/bg-accent/)
  await restore(3) // con mute
  await expect(mute).toHaveClass(/bg-accent/)
  await restore(2) // recién importado, sin mute
  await expect(mute).not.toHaveClass(/bg-accent/)
  await expect(page.locator('section').getByText('bass', { exact: true })).toBeVisible()
  // v1 = proyecto vacío
  await restore(1)
  await expect(page.getByText(/importa audio/i)).toBeVisible()
})

test('deshacer y rehacer (botones y Ctrl+Z / Ctrl+Y)', async () => {
  // Venimos de "volver a v1" (proyecto vacío): deshacer recupera las pistas.
  await page.keyboard.press('Control+z')
  await expect(page.locator('section').getByText('bass', { exact: true })).toBeVisible()

  // Borrar una región y recuperarla: justo lo que "restaurar" no hacía.
  const regions = page.locator('.cursor-grab')
  await expect(regions).toHaveCount(2)
  await regions.first().click()
  await page.keyboard.press('Delete')
  await expect(regions).toHaveCount(1)
  await expect(page.locator('ol li').first()).toContainText('Región eliminada')

  await page.getByRole('button', { name: '↶ Deshacer' }).click()
  await expect(regions).toHaveCount(2)
  await expect(page.locator('ol li').first()).toContainText('Deshacer: Región eliminada')

  await page.keyboard.press('Control+y')
  await expect(regions).toHaveCount(1)
  await expect(page.locator('ol li').first()).toContainText('Rehacer: Región eliminada')
  await expect(page.getByRole('button', { name: '↷ Rehacer' })).toBeDisabled()
})

test('generar con el motor Demo añade una pista al timeline', async () => {
  const regions = page.locator('.cursor-grab')
  const before = await regions.count()

  await page.getByRole('tab', { name: 'Generar manual' }).click()
  await page.getByPlaceholder(/Describe el sonido/).fill('bajo profundo de prueba')
  await page.getByLabel('Tipo').selectOption('bass')
  await page.getByLabel('Duración').selectOption('2')
  await page.getByLabel('Motor').selectOption('demo')
  await page.getByRole('button', { name: /^Generar 2 compases/ }).click()

  await expect(page.getByText('Añadido al timeline')).toBeVisible({ timeout: 10_000 })
  await expect(regions).toHaveCount(before + 1)
  await expect(page.locator('ol li').first()).toContainText(
    'Generado bajo: "bajo profundo de prueba"'
  )

  // Es un cambio normal: se puede deshacer.
  await page.keyboard.press('Control+z')
  await expect(regions).toHaveCount(before)
})

test('Replicate sin token avisa y no deja generar', async () => {
  await page.getByLabel('Motor').selectOption('replicate')
  await expect(page.getByText(/Falta la API key de Replicate/)).toBeVisible()
  await expect(page.getByRole('button', { name: /^Generar/ })).toBeDisabled()
  await page.getByRole('button', { name: 'Abrir ajustes' }).click()
  const dialog = page.getByRole('dialog', { name: 'Ajustes' })
  await expect(dialog.getByText('sin token')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})

test('el productor (chat) mira el proyecto, pone el tempo y genera capas', async () => {
  await page.getByRole('tab', { name: 'Productor' }).click()
  const regions = page.locator('.cursor-grab')
  const before = await regions.count()

  await page.getByLabel('Mensaje para el productor').fill('hazme un beat boom bap')
  await page.keyboard.press('Enter')

  await expect(page.getByText('hazme un beat boom bap')).toBeVisible()
  await expect(page.getByText('Revisando el proyecto')).toBeVisible()
  await expect(page.getByText('Tempo 90 BPM · tonalidad A minor')).toBeVisible()
  await expect(page.getByText(/Generado batería: “boom bap drums”/)).toBeVisible({
    timeout: 15_000
  })
  await expect(page.getByText(/Generado bajo: “warm bassline”/)).toBeVisible({ timeout: 15_000 })
  await expect(
    page.getByText('Listo: batería y bajo de 2 compases a 90 BPM en La menor.')
  ).toBeVisible()

  await expect(regions).toHaveCount(before + 2)
  await expect(page.locator('input[type=number]')).toHaveValue('90')
  // Los cambios del productor quedan en el historial, marcados con 🤖.
  await expect(page.locator('ol li').filter({ hasText: '🤖 Tempo 90 BPM' })).toBeVisible()
  await expect(page.locator('ol li').filter({ hasText: '🤖 Generado bajo' })).toBeVisible()
})

test('ajustes: cualquier proveedor de LLM (Groq, personalizado)', async () => {
  await page.getByRole('button', { name: '⚙ Ajustes' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Ajustes' })
  const provider = dialog.getByLabel('Proveedor del productor')

  await provider.selectOption('groq')
  await expect(dialog.getByText(/Muy rápido y con capa gratuita/)).toBeVisible()
  await expect(dialog.getByLabel('Modelo del productor')).toHaveValue('llama-3.3-70b-versatile')
  await expect(dialog.getByRole('link', { name: 'conseguir una clave' })).toHaveAttribute(
    'href',
    'https://console.groq.com/keys'
  )
  await expect(dialog.getByLabel('API key de Groq')).toBeVisible()

  await provider.selectOption('custom')
  const url = dialog.getByLabel('URL base de la API')
  await url.fill('ftp://no-vale')
  await url.press('Enter')
  await expect(dialog.getByText(/debe empezar por http/)).toBeVisible()
  await url.fill('https://api.together.xyz/v1')
  await url.press('Enter')
  await expect(dialog.getByText(/debe empezar por http/)).toBeHidden()

  await provider.selectOption('ollama')
  await expect(dialog.getByLabel('URL base de la API')).toHaveValue('http://localhost:11434/v1')
  await expect(dialog.getByLabel(/API key de Ollama/)).toHaveCount(0) // local: sin clave

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})

test('motor local sin instalar: lo indica en ajustes y en el panel manual', async () => {
  await page.getByRole('button', { name: '⚙ Ajustes' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Ajustes' })
  await expect(dialog.getByText('Motor de audio: Local (tu equipo)')).toBeVisible()
  await expect(dialog.getByText('no instalado')).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Instalar motor local' })).toBeVisible()
  await page.keyboard.press('Escape')

  await page.getByRole('tab', { name: 'Generar manual' }).click()
  await page.getByLabel('Motor').selectOption('local')
  await expect(page.getByText(/El motor local no está instalado/)).toBeVisible()
  await page.getByLabel('Motor').selectOption('demo')
})

test('cambiar el tempo estira el audio generado y sigue ocupando los mismos compases', async () => {
  await page.getByRole('tab', { name: 'Generar manual' }).click()
  await page.getByPlaceholder(/Describe el sonido/).fill('pad para estirar')
  await page.getByLabel('Tipo').selectOption('chords')
  await page.getByLabel('Duración').selectOption('2')
  await page.getByLabel('Motor').selectOption('demo')
  await page.getByRole('button', { name: /^Generar 2 compases/ }).click()
  await expect(page.locator('ol li').first()).toContainText('pad para estirar', { timeout: 10_000 })

  const pad = page.locator('.cursor-grab').last()
  const before = (await pad.boundingBox())!.width
  const bpm = page.locator('input[type=number]')
  const current = Number(await bpm.inputValue())
  await bpm.fill(String(current - 20))
  await bpm.press('Enter')
  await expect(page.locator('ol li').first()).toContainText(`Tempo ${current - 20} BPM ·`)
  await expect(page.locator('ol li').first()).toContainText('clip(s) ajustados')
  expect(Math.abs((await pad.boundingBox())!.width - before)).toBeLessThan(2)

  // Deshacer recupera el tempo y el clip original.
  await page.keyboard.press('Control+z')
  await expect(bpm).toHaveValue(String(current))
})

test('menú de región: variación, continuar y duplicar', async () => {
  await page.getByRole('tab', { name: 'Generar manual' }).click()
  await page.getByPlaceholder(/Describe el sonido/).fill('riff para variar')
  await page.getByLabel('Tipo').selectOption('melody')
  await page.getByLabel('Duración').selectOption('2')
  await page.getByLabel('Motor').selectOption('demo')
  await page.getByRole('button', { name: /^Generar 2 compases/ }).click()
  const history = page.locator('ol li').first()
  await expect(history).toContainText('riff para variar', { timeout: 10_000 })

  const regions = page.locator('.cursor-grab')
  const count = await regions.count()
  const riff = regions.last()
  // Posición dentro de la pista (no en pantalla: el timeline puede desplazarse).
  const layout = (el: typeof riff) =>
    el.evaluate((n) => ({
      left: parseFloat((n as HTMLElement).style.left),
      width: parseFloat((n as HTMLElement).style.width),
      lane: Array.from(n.parentElement!.parentElement!.parentElement!.children).indexOf(
        n.parentElement!.parentElement!
      )
    }))
  const box = await layout(riff)

  // Variación: sustituye la región en el mismo sitio.
  await riff.click({ button: 'right' })
  const menu = page.getByRole('menu', { name: 'Acciones de la región' })
  await menu.getByLabel('Indicaciones para la IA').fill('more staccato')
  await menu.getByRole('menuitem', { name: /Variación/ }).click()
  await expect(history).toContainText('Variación de Melodía: "more staccato"', { timeout: 10_000 })
  await expect(regions).toHaveCount(count)

  // Continuar: región nueva justo después, en la misma pista.
  await regions.last().click({ button: 'right' })
  await menu.getByRole('menuitem', { name: '+2 compases' }).click()
  await expect(page.getByTestId('pending-region')).toBeVisible()
  await expect(history).toContainText('Continuación de Melodía (+2 compases)', { timeout: 10_000 })
  await expect(regions).toHaveCount(count + 1)
  const cont = await layout(regions.last())
  expect(cont.left).toBeCloseTo(box.left + box.width, 0) // justo después
  expect(cont.lane).toBe(box.lane) // en la misma pista

  // Duplicar (sin IA) y deshacer.
  await regions.last().click({ button: 'right' })
  await menu.getByRole('menuitem', { name: /Duplicar/ }).click()
  await expect(regions).toHaveCount(count + 2)
  // Ctrl+Z inmediato, mientras el guardado aún está en curso: debe deshacer
  // el duplicado (lo último), no la continuación anterior.
  await page.keyboard.press('Control+z')
  await expect(regions).toHaveCount(count + 1)
  await expect(history).toContainText('Deshacer: Melodía: región duplicada')
})

test('secciones: añadir, renombrar, redimensionar, bucle y copiar con audio', async () => {
  const sections = page.getByTestId('section')
  const before = await sections.count()
  await page.getByRole('button', { name: '+ Sección' }).click()
  await expect(sections).toHaveCount(before + 1)
  const sec = sections.last()

  // Renombrar con doble clic.
  await sec.dblclick()
  await page.getByLabel('Nombre de la sección').fill('Estribillo')
  await page.keyboard.press('Enter')
  await expect(sec).toContainText('Estribillo')
  await expect(page.locator('ol li').first()).toContainText('Sección renombrada: Estribillo')

  // Redimensionar arrastrando el borde derecho: de 8 a 1 compás.
  const box = (await sec.boundingBox())!
  const barPx = box.width / 8
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + barPx + 1, box.y + box.height / 2, { steps: 5 })
  await page.mouse.up()
  await expect(page.locator('ol li').first()).toContainText('Estribillo: 1 compás')

  // Bucle: sigue sonando pasado el final de la sección (1 compás) y no se sale de ella.
  await sec.click({ button: 'right' })
  const menu = page.getByRole('menu', { name: 'Acciones de la sección' })
  await menu.getByRole('menuitem', { name: /Repetir en bucle/ }).click()
  await expect(sec).toContainText('🔁')
  await playButton().click()
  await page.waitForTimeout(3500) // más que la sección entera
  await expect(playButton()).toHaveText('■ Stop')
  await playButton().click()
  await sec.click({ button: 'right' })
  await menu.getByRole('menuitem', { name: /Quitar bucle/ }).click()
  await expect(sec).not.toContainText('🔁')

  // Copiar al final con su audio.
  await sec.click({ button: 'right' })
  await menu.getByRole('menuitem', { name: /Copiar al final/ }).click()
  await expect(sections).toHaveCount(before + 2)
  await expect(page.locator('ol li').first()).toContainText('Sección copiada al final: Estribillo')
})

test('exportar: mezcla en MP3, una sección en WAV y pistas por separado', async () => {
  const { readFile, readdir, mkdir } = await import('node:fs/promises')
  const outDir = join(workDir, 'exportados')
  const stemsDir = join(workDir, 'stems')
  await mkdir(stemsDir, { recursive: true })
  await app.evaluate(
    ({ dialog }, paths) => {
      let n = 0
      dialog.showSaveDialog = (async () => ({
        canceled: false,
        filePath: `${paths.out}\\export-${++n}.${n === 1 ? 'mp3' : 'wav'}`
      })) as typeof dialog.showSaveDialog
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [paths.stems]
      })) as typeof dialog.showOpenDialog
    },
    { out: outDir, stems: stemsDir }
  )
  await mkdir(outDir, { recursive: true })

  const openDialog = async (): Promise<ReturnType<Page['getByRole']>> => {
    await page.getByRole('button', { name: 'Exportar…' }).click()
    return page.getByRole('dialog', { name: 'Exportar' })
  }

  // 1) Mezcla completa en MP3 320
  let dialog = await openDialog()
  await dialog.getByRole('button', { name: /Mezcla/ }).click()
  await dialog.getByLabel('Formato').selectOption('mp3')
  await dialog.getByRole('button', { name: 'Exportar', exact: true }).click()
  await expect(dialog).toBeHidden({ timeout: 30_000 })
  const mp3 = await readFile(join(outDir, 'export-1.mp3'))
  expect(mp3[0] === 0xff || mp3.subarray(0, 3).toString() === 'ID3').toBe(true)
  expect(mp3.length).toBeGreaterThan(10_000)

  // 2) Solo una sección (1 compás) en WAV: duración exacta
  dialog = await openDialog()
  await dialog.getByLabel('Formato').selectOption('wav')
  const sectionOption = dialog
    .getByLabel('Tramo')
    .locator('option', { hasText: 'Estribillo' })
    .first()
  await dialog.getByLabel('Tramo').selectOption((await sectionOption.getAttribute('value'))!)
  await dialog.getByRole('button', { name: 'Exportar', exact: true }).click()
  await expect(dialog).toBeHidden({ timeout: 30_000 })
  const wav = await readFile(join(outDir, 'export-2.wav'))
  const bpm = Number(await page.locator('input[type=number]').inputValue())
  const seconds = (wav.length - 44) / (48000 * 2 * 2)
  expect(seconds).toBeCloseTo((4 * 60) / bpm, 2) // 1 compás de 4/4

  // 3) Pistas por separado: un archivo por pista con audio, sin pisarse.
  //    El diálogo recuerda el formato anterior (WAV).
  dialog = await openDialog()
  await expect(dialog.getByLabel('Formato')).toHaveValue('wav')
  await dialog.getByRole('button', { name: /Pistas por separado/ }).click()
  const expected = Number(
    (await dialog.getByText(/archivos? \(stems\)/).textContent())!.match(/\d+/)![0]
  )
  await dialog.getByRole('button', { name: 'Exportar', exact: true }).click()
  await expect(dialog).toBeHidden({ timeout: 60_000 })
  const files = (await readdir(stemsDir)).filter((f) => f.endsWith('.wav'))
  expect(files).toHaveLength(expected)
  expect(files.every((f) => /- \d{2} /.test(f))).toBe(true)
})
