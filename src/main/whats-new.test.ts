import { describe, expect, it } from 'vitest'
import { describeUpdateStatus, userFacingNotes } from '@shared/update'
import { computeWhatsNew, notesToHtml } from './whats-new'

const url = 'https://github.com/ahiram1701/VibeMusic/releases/tag/v0.1.5'

describe('novedades tras actualizar', () => {
  it('solo se muestran al cambiar de versión, nunca en una instalación nueva', () => {
    expect(computeWhatsNew({ current: '0.1.5' })).toBeNull()
    expect(computeWhatsNew({ current: '0.1.5', lastRun: '0.1.5' })).toBeNull()
    expect(computeWhatsNew({ current: '0.1.5', lastRun: '0.1.4' })).toEqual({
      version: '0.1.5',
      notes: null,
      url
    })
  })

  it('usa las notas guardadas de esta versión, sin la lista de PRs', () => {
    const notes =
      "<h2>Novedades</h2><ul><li>Aviso al actualizar</li></ul><h2>What's Changed</h2><ul><li>Bump x</li></ul>"
    expect(
      computeWhatsNew({ current: '0.1.5', lastRun: '0.1.4', pending: { version: '0.1.5', notes } })
    ).toEqual({
      version: '0.1.5',
      notes: '<ul><li>Aviso al actualizar</li></ul>',
      url
    })
    // La versión anterior no recordaba nada, pero sí guardó las notas.
    expect(
      computeWhatsNew({ current: '0.1.5', pending: { version: '0.1.5', notes } })?.version
    ).toBe('0.1.5')
    // Ya se abrió esta versión: aunque las notas sigan guardadas, no se repiten.
    expect(
      computeWhatsNew({ current: '0.1.5', lastRun: '0.1.5', pending: { version: '0.1.5', notes } })
    ).toBeNull()
    // Notas de otra versión: no sirven.
    expect(
      computeWhatsNew({ current: '0.1.5', lastRun: '0.1.4', pending: { version: '0.1.4', notes } })
        ?.notes
    ).toBeNull()
  })

  it('normaliza las notas de electron-updater y conserva las que solo traen la lista de PRs', () => {
    expect(notesToHtml(null)).toBeNull()
    expect(notesToHtml('<p>a</p>')).toBe('<p>a</p>')
    expect(
      notesToHtml([
        { version: '1', note: '<p>a</p>' },
        { version: '2', note: null }
      ])
    ).toBe('<p>a</p>\n')
    expect(userFacingNotes('<h2>What&#39;s Changed</h2><ul><li>x</li></ul>')).toBe(
      '<h2>What&#39;s Changed</h2><ul><li>x</li></ul>'
    )
  })

  it('describe el estado en español', () => {
    expect(describeUpdateStatus({ state: 'downloading', version: '0.1.5', percent: 45.7 })).toBe(
      'Descargando la versión 0.1.5… 45 %'
    )
    expect(
      describeUpdateStatus({ state: 'error', error: 'getaddrinfo ENOTFOUND github.com' })
    ).toBe('No se pudo comprobar: sin conexión a internet.')
    expect(describeUpdateStatus({ state: 'up-to-date' })).toBe('Tienes la última versión.')
  })
})
