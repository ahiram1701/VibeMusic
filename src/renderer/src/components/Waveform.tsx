import { useEffect, useRef } from 'react'

interface Props {
  buffer: AudioBuffer | undefined
  offsetSec: number
  lengthSec: number
  width: number
  height: number
}

/** Dibuja los picos (min/max por píxel) del tramo del clip que usa la región. */
export function Waveform({
  buffer,
  offsetSec,
  lengthSec,
  width,
  height
}: Props): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const w = Math.max(1, Math.floor(width))
    canvas.width = w * dpr
    canvas.height = height * dpr
    const g = canvas.getContext('2d')
    if (!g) return
    g.scale(dpr, dpr)
    g.clearRect(0, 0, w, height)
    if (!buffer) return

    const data = buffer.getChannelData(0)
    const start = Math.floor(offsetSec * buffer.sampleRate)
    const total = Math.floor(lengthSec * buffer.sampleRate)
    const perPx = Math.max(1, Math.floor(total / w))
    const mid = height / 2

    g.fillStyle = 'rgba(255,255,255,0.75)'
    for (let x = 0; x < w; x++) {
      let min = 1
      let max = -1
      const from = start + x * perPx
      // Muestreo con paso para que clips largos no bloqueen el hilo de UI.
      const step = Math.max(1, Math.floor(perPx / 64))
      for (let i = 0; i < perPx; i += step) {
        const v = data[from + i] ?? 0
        if (v < min) min = v
        if (v > max) max = v
      }
      g.fillRect(x, mid - max * mid, 1, Math.max(1, (max - min) * mid))
    }
  }, [buffer, offsetSec, lengthSec, width, height])

  return <canvas ref={ref} style={{ width, height }} className="pointer-events-none block" />
}
