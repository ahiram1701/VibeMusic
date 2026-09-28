import { describe, expect, it } from 'vitest'
import { encodeWav } from './wav'

describe('encodeWav', () => {
  it('escribe una cabecera RIFF/WAVE válida', () => {
    const left = new Float32Array([0, 0.5, -0.5, 1])
    const right = new Float32Array([0, -1, 1, 0])
    const bytes = encodeWav([left, right], 48000)
    const view = new DataView(bytes.buffer)
    const text = (o: number): string => String.fromCharCode(...bytes.slice(o, o + 4))

    expect(text(0)).toBe('RIFF')
    expect(text(8)).toBe('WAVE')
    expect(view.getUint16(22, true)).toBe(2) // canales
    expect(view.getUint32(24, true)).toBe(48000)
    expect(view.getUint32(40, true)).toBe(4 * 2 * 2) // frames * canales * bytes
    expect(bytes.length).toBe(44 + 16)
  })

  it('recorta y convierte muestras a 16 bits', () => {
    const bytes = encodeWav([new Float32Array([1, -1, 2])], 44100)
    const view = new DataView(bytes.buffer)
    expect(view.getInt16(44, true)).toBe(32767)
    expect(view.getInt16(46, true)).toBe(-32768)
    expect(view.getInt16(48, true)).toBe(32767)
  })
})
