import { useEffect, useState } from 'react'
import { formatPosition, type GridResolution } from '@shared/timeline'
import { engine } from '../audio/engine'
import { useProject } from '../store/project'
import { useUi } from '../store/ui'

const GRIDS: { value: GridResolution; label: string }[] = [
  { value: 'bar', label: 'Compás' },
  { value: 'beat', label: '1/4' },
  { value: 'half', label: '1/8' },
  { value: 'quarter', label: '1/16' },
  { value: 'off', label: 'Libre' }
]

export function Transport(): React.JSX.Element | null {
  const { project, commit, importAudio, exportWav } = useProject()
  const { grid, setGrid, zoom } = useUi()
  const [playing, setPlaying] = useState(false)
  const [pos, setPos] = useState(0)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    let raf = 0
    const tick = (): void => {
      setPos(engine.positionSec)
      setPlaying(engine.playing)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.code !== 'Space' || (e.target as HTMLElement).closest('input, textarea')) return
      e.preventDefault()
      const p = useProject.getState().project
      if (!p) return
      if (engine.playing) engine.stop()
      else void engine.play(p)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!project) return null

  const btn = 'rounded px-3 py-1 text-sm hover:bg-line'

  return (
    <div className="flex items-center gap-2">
      <button
        className={`${btn} w-20 bg-accent/80 font-medium hover:bg-accent`}
        onClick={() => (playing ? engine.stop() : void engine.play(project))}
        title="Espacio"
      >
        {playing ? '■ Stop' : '▶ Play'}
      </button>
      <button className={btn} onClick={() => engine.seek(project, 0)} title="Al inicio">
        ⏮
      </button>
      <span className="w-16 font-mono text-sm tabular-nums">{formatPosition(pos, project)}</span>

      <label className="ml-4 flex items-center gap-1 text-sm text-muted">
        BPM
        <input
          key={project.bpm}
          type="number"
          min={40}
          max={240}
          defaultValue={project.bpm}
          className="w-16 rounded border border-line bg-bg px-2 py-0.5 text-white"
          onBlur={(e) => {
            const bpm = Math.round(Number(e.target.value))
            if (bpm >= 40 && bpm <= 240 && bpm !== project.bpm) {
              void commit({ ...project, bpm }, `Tempo cambiado a ${bpm} BPM`)
            } else e.target.value = String(project.bpm)
          }}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
      </label>

      <label className="ml-2 flex items-center gap-1 text-sm text-muted">
        Rejilla
        <select
          value={grid}
          onChange={(e) => setGrid(e.target.value as GridResolution)}
          className="rounded border border-line bg-bg px-1 py-0.5 text-white"
        >
          {GRIDS.map((g) => (
            <option key={g.value} value={g.value}>
              {g.label}
            </option>
          ))}
        </select>
      </label>

      <button className={btn} onClick={() => zoom(0.8)} title="Alejar">
        −
      </button>
      <button className={btn} onClick={() => zoom(1.25)} title="Acercar">
        +
      </button>

      <div className="ml-auto flex gap-2">
        <button className={`${btn} border border-line`} onClick={importAudio}>
          Importar audio…
        </button>
        <button
          className={`${btn} border border-line disabled:opacity-50`}
          disabled={exporting || project.tracks.length === 0}
          onClick={async () => {
            setExporting(true)
            try {
              await exportWav()
            } finally {
              setExporting(false)
            }
          }}
        >
          {exporting ? 'Exportando…' : 'Exportar WAV'}
        </button>
      </div>
    </div>
  )
}
