import { MAX_GAIN_DB, MIN_GAIN_DB } from '@shared/mixer'
import { removeTrack, updateTrack, type Track } from '@shared/project'
import { useProject } from '../store/project'

export function Mixer(): React.JSX.Element | null {
  const { project } = useProject()
  if (!project) return null

  if (project.tracks.length === 0) {
    return <div className="p-4 text-sm text-muted">Sin pistas.</div>
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
  if (!project) return <></>

  // Mientras arrastras: `preview` (se oye al instante). Al soltar: `commit` (crea versión).
  const live = (patch: Partial<Track>): void => preview(updateTrack(project, track.id, patch))
  const save = (patch: Partial<Track>, msg: string): void =>
    void commit(updateTrack(project, track.id, patch), `${track.name}: ${msg}`)

  const toggle = (on: boolean): string =>
    `w-7 rounded text-xs font-bold ${on ? 'bg-accent text-white' : 'bg-line text-muted'}`

  return (
    <div className="flex w-40 shrink-0 flex-col gap-2 rounded-md border border-line bg-bg p-2">
      <div className="flex items-center justify-between gap-1">
        <span className="truncate text-sm" title={track.name}>
          {track.name}
        </span>
        <button
          className="text-xs text-muted hover:text-red-400"
          title="Eliminar pista"
          onClick={() =>
            void commit(removeTrack(project, track.id), `Pista ${track.name} eliminada`)
          }
        >
          ✕
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
            save({ gainDb: Number(e.currentTarget.value) }, `volumen ${e.currentTarget.value} dB`)
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
          onKeyUp={(e) => save({ pan: Number(e.currentTarget.value) }, 'panorama')}
          onDoubleClick={() => save({ pan: 0 }, 'panorama al centro')}
        />
      </label>

      <div className="flex gap-1">
        <button
          className={toggle(track.mute)}
          onClick={() => save({ mute: !track.mute }, track.mute ? 'unmute' : 'mute')}
        >
          M
        </button>
        <button
          className={toggle(track.solo)}
          onClick={() => save({ solo: !track.solo }, track.solo ? 'solo off' : 'solo')}
        >
          S
        </button>
      </div>
    </div>
  )
}
