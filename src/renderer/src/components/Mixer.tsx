import { useRef } from 'react'
import { X } from 'lucide-react'
import { MAX_GAIN_DB, MIN_GAIN_DB } from '@shared/mixer'
import { removeTrack, updateTrack, type Track } from '@shared/project'
import { useProject } from '../store/project'

export function Mixer(): React.JSX.Element | null {
  const { project } = useProject()
  if (!project) return null

  if (project.tracks.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-sm text-muted">
        Aquí aparecerán los controles de volumen, panorama, silencio (M) y solo (S) de cada pista
        cuando el productor genere música o importes audio.
      </div>
    )
  }
  return (
    <div className="flex h-full gap-2 overflow-x-auto p-3">
      {project.tracks.map((t) => (
        <ChannelStrip key={t.id} track={t} />
      ))}
    </div>
  )
}

function ChannelStrip({ track }: { track: Track }): React.JSX.Element {
  const { project, preview, commit } = useProject()
  // Con el teclado (flechas) cada pulsación mueve el control: se guarda una sola
  // versión cuando dejas de pulsar, no una por tecla.
  const keyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  if (!project) return <></>

  // Mientras arrastras: `preview` (se oye al instante). Al soltar: `commit` (crea versión).
  const live = (patch: Partial<Track>): void => preview(updateTrack(project, track.id, patch))
  const save = (patch: Partial<Track>, msg: string): void =>
    void commit(updateTrack(project, track.id, patch), `${track.name}: ${msg}`)
  const saveSoon = (patch: Partial<Track>, msg: string): void => {
    clearTimeout(keyTimer.current)
    keyTimer.current = setTimeout(() => save(patch, msg), 600)
  }

  const toggle = (on: boolean): string =>
    `h-6 w-7 rounded-md text-xs font-bold transition-colors ${on ? 'bg-accent text-white' : 'bg-line text-muted hover:text-text'}`

  return (
    <div className="flex w-40 shrink-0 flex-col gap-2 rounded-md border border-line bg-bg p-2">
      <div className="flex items-center justify-between gap-1">
        <span className="truncate text-sm" title={track.name}>
          {track.name}
        </span>
        <button
          type="button"
          className="rounded p-0.5 text-muted hover:text-danger"
          title="Eliminar pista (se puede deshacer)"
          aria-label={`Eliminar la pista ${track.name}`}
          onClick={() =>
            void commit(removeTrack(project, track.id), `Pista ${track.name} eliminada`)
          }
        >
          <X size={14} aria-hidden />
        </button>
      </div>

      <label className="text-[10px] text-muted">
        Volumen {track.gainDb <= MIN_GAIN_DB ? '-∞' : track.gainDb.toFixed(1)} dB
        <input
          type="range"
          min={MIN_GAIN_DB}
          max={MAX_GAIN_DB}
          step={0.5}
          value={track.gainDb}
          className="w-full accent-accent"
          onChange={(e) => live({ gainDb: Number(e.target.value) })}
          onPointerUp={(e) =>
            save({ gainDb: Number(e.currentTarget.value) }, `volumen ${e.currentTarget.value} dB`)
          }
          onKeyUp={(e) =>
            saveSoon(
              { gainDb: Number(e.currentTarget.value) },
              `volumen ${e.currentTarget.value} dB`
            )
          }
          onDoubleClick={() => save({ gainDb: 0 }, 'volumen a 0 dB')}
        />
      </label>

      <label className="text-[10px] text-muted">
        Pan{' '}
        {track.pan === 0
          ? 'C'
          : track.pan < 0
            ? `L${Math.round(-track.pan * 100)}`
            : `R${Math.round(track.pan * 100)}`}
        <input
          type="range"
          min={-1}
          max={1}
          step={0.05}
          value={track.pan}
          className="w-full accent-accent"
          onChange={(e) => live({ pan: Number(e.target.value) })}
          onPointerUp={(e) => save({ pan: Number(e.currentTarget.value) }, 'panorama')}
          onKeyUp={(e) => saveSoon({ pan: Number(e.currentTarget.value) }, 'panorama')}
          onDoubleClick={() => save({ pan: 0 }, 'panorama al centro')}
        />
      </label>

      <div className="flex gap-1">
        <button
          type="button"
          className={toggle(track.mute)}
          aria-pressed={track.mute}
          title="Silenciar (mute)"
          onClick={() => save({ mute: !track.mute }, track.mute ? 'unmute' : 'mute')}
        >
          M
        </button>
        <button
          type="button"
          className={toggle(track.solo)}
          aria-pressed={track.solo}
          title="Solo: oír solo esta pista"
          onClick={() => save({ solo: !track.solo }, track.solo ? 'solo off' : 'solo')}
        >
          S
        </button>
      </div>
    </div>
  )
}
