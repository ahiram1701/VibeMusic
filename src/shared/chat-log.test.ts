import { describe, expect, it } from 'vitest'
import { parseSavedChat, serializeChat } from './chat-log'

describe('conversación guardada', () => {
  it('se guarda y se recupera igual', () => {
    const items = [
      { id: 'a', at: 1, kind: 'user', text: 'hazme un house tumbado' },
      { id: 'b', at: 2, kind: 'tool', name: 'compose_song', input: {}, status: 'ok' }
    ]
    const history = [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'x' }] }]
    expect(parseSavedChat(serializeChat(items, history))).toEqual({ items, history })
  })

  it('una herramienta que quedó en curso se marca como interrumpida', () => {
    const items = [{ id: 't', at: 1, kind: 'tool', name: 'compose_song', status: 'running' }]
    const saved = parseSavedChat(serializeChat(items, []))!
    expect(saved.items[0]).toMatchObject({ status: 'error', result: /interrumpió/ })
  })

  it('un archivo roto o de otra versión no se carga', () => {
    expect(parseSavedChat('{nope')).toBeNull()
    expect(parseSavedChat(JSON.stringify({ version: 2, items: [], history: [] }))).toBeNull()
  })
})
