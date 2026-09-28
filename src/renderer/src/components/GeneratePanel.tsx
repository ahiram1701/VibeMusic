import { useEffect, useState } from 'react'
import type { ProviderId } from '@shared/generation'
import { secondsToBeats, type TrackRole } from '@shared/project'
import { barsToSeconds } from '@shared/prompt'
import { engine } from '../audio/engine'
import { ROLE_LABELS } from '../labels'
import { useGeneration, type JobView } from '../store/generation'
import { useProject } from '../store/project'

const BAR_OPTIONS = [1, 2, 4, 8, 16]
const EXAMPLES = [
  'lo-fi hip hop, vinilo cálido, relajado',
  'techno minimal, bombo contundente, hi-hats metálicos',
  'bossa nova, guitarra acústica suave',
  'synthwave años 80, sintetizadores brillantes'
]

export function GeneratePanel({ onOpenSettings }: { onOpenSettings(): void }): React.JSX.Element {
  const { project } = useProject()
  const { providers, settings, jobs, init, generate } = useGeneration()
  const [prompt, setPrompt] = useState('')
  const [role, setRole] = useState<TrackRole>('drums')
  const [bars, setBars] = useState(4)
  const [trackId, setTrackId] = useState<string | null>(null)
  const [providerId, setProviderId] = useState<ProviderId | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void init()
  }, [init])

  const provider =
    providers.find((p) => p.id === (providerId ?? settings?.defaultProvider)) ?? providers[0]
  const seconds = project ? barsToSeconds(bars, project) : 0
  const tooLong = !!provider && seconds > provider.capabilities.maxDurationSec
  const canGenerate = !!project && !!provider?.ready && prompt.trim().length > 0 && !tooLong

  const submit = async (): Promise<void> => {
    if (!canGenerate || !project || !provider) return
    setError(null)
    // Se coloca al inicio del compás donde está el cursor de reproducción.
    const perBar = project.timeSignature[0]
    const beat = secondsToBeats(engine.positionSec, project.bpm)
    try {
      await generate({
        prompt,
        role,
        bars,
        providerId: provider.id,
        atBeat: Math.floor(beat / perBar) * perBar,
        trackId: trackId && project.tracks.some((t) => t.id === trackId) ? trackId : null
      })
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
          : String(err)
      )
    }
  }

  const views = Object.values(jobs).sort((a, b) => b.job.createdAt - a.job.createdAt)
  const field = 'rounded border border-line bg-bg px-2 py-1 text-sm text-white'

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-3">
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void submit()
        }}
        rows={3}
        placeholder={`Describe el sonido… p. ej. "${EXAMPLES[0]}"`}
        className={`${field} resize-none`}
      />
      <div className="flex flex-wrap gap-1">
        {EXAMPLES.slice(1).map((ex) => (
          <button
            key={ex}
            className="rounded-full border border-line px-2 py-0.5 text-[11px] text-muted hover:text-white"
            onClick={() => setPrompt(ex)}
          >
            {ex.split(',')[0]}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs text-muted">
        <label className="flex flex-col gap-1">
          Tipo
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as TrackRole)}
            className={field}
          >
            {Object.entries(ROLE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Duración
          <select value={bars} onChange={(e) => setBars(Number(e.target.value))} className={field}>
            {BAR_OPTIONS.map((b) => (
              <option key={b} value={b}>
                {b} {b === 1 ? 'compás' : 'compases'}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Pista
          <select
            value={trackId ?? ''}
            onChange={(e) => setTrackId(e.target.value || null)}
            className={field}
          >
            <option value="">Nueva pista</option>
            {project?.tracks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Motor
          <select
            value={provider?.id ?? ''}
            onChange={(e) => setProviderId(e.target.value as ProviderId)}
            className={field}
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
                {p.ready ? '' : ' (sin configurar)'}
              </option>
            ))}
          </select>
        </label>
      </div>

      {provider && !provider.ready && (
        <p className="text-xs text-amber-400">
          {provider.notReadyReason}.{' '}
          <button className="underline" onClick={onOpenSettings}>
            Abrir ajustes
          </button>
        </p>
      )}
      {tooLong && (
        <p className="text-xs text-amber-400">
          {bars} compases son {seconds.toFixed(1)} s; {provider?.label} admite hasta{' '}
          {provider?.capabilities.maxDurationSec} s.
        </p>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}

      <button
        className="rounded-md bg-accent py-1.5 text-sm font-medium hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        disabled={!canGenerate}
        onClick={submit}
        title="Ctrl+Enter"
      >
        Generar {bars} {bars === 1 ? 'compás' : 'compases'} ({seconds.toFixed(1)} s)
      </button>

      <ul className="min-h-0 flex-1 space-y-1.5 overflow-auto">
        {views.map((v) => (
          <JobRow key={v.job.id} view={v} />
        ))}
      </ul>
    </div>
  )
}

function JobRow({ view }: { view: JobView }): React.JSX.Element {
  const { cancel, retry, dismiss } = useGeneration()
  const { job, added, localError } = view
  const active = job.status === 'queued' || job.status === 'running'
  const failed = job.status === 'error' || !!localError
  const pct = job.progress === null ? null : Math.round(job.progress * 100)

  const stage = localError
    ? `No se pudo añadir: ${localError}`
    : job.status === 'error'
      ? job.error
      : job.status === 'done'
        ? added
          ? 'Añadido al timeline'
          : 'Procesando audio…'
        : job.stage

  return (
    <li className="rounded-md border border-line bg-bg p-2 text-xs">
      <div className="flex items-start justify-between gap-2">
        <span className="line-clamp-2 text-white" title={job.spec.prompt}>
          <span className="text-muted">{ROLE_LABELS[job.spec.role]} · </span>
          {job.spec.prompt}
        </span>
        {active ? (
          <button className="shrink-0 text-muted hover:text-red-400" onClick={() => cancel(job.id)}>
            Cancelar
          </button>
        ) : (
          <button
            className="shrink-0 text-muted hover:text-white"
            onClick={() => dismiss(job.id)}
            title="Quitar de la lista"
          >
            ✕
          </button>
        )}
      </div>
      <div
        className={`mt-1 ${failed ? 'text-red-400' : added ? 'text-emerald-400' : 'text-muted'}`}
      >
        {stage}
        {failed && (
          <button className="ml-2 text-accent underline" onClick={() => retry(job.id)}>
            Reintentar
          </button>
        )}
      </div>
      {active && (
        <div className="mt-1.5 h-1 overflow-hidden rounded bg-line">
          <div
            className={`h-full bg-accent transition-[width] ${pct === null ? 'w-1/3 animate-pulse' : ''}`}
            style={pct === null ? undefined : { width: `${pct}%` }}
          />
        </div>
      )}
    </li>
  )
}
