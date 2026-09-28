import { useEffect, useState } from 'react'
import { MP3_BITRATES, type Mp3Bitrate } from '@shared/mp3'
import { sectionsOf } from '@shared/sections'
import { cleanError } from '../store/chat'
import { useExport, type ExportFormat } from '../store/export'
import { useProject } from '../store/project'
import { useUi } from '../store/ui'

export function ExportDialog({ onClose }: { onClose(): void }): React.JSX.Element | null {
  const project = useProject((s) => s.project)
  const { busy, status, run, last } = useExport()
  const [format, setFormat] = useState<ExportFormat>(last.format)
  const [kbps, setKbps] = useState<Mp3Bitrate>(last.kbps)
  const [target, setTarget] = useState<'mix' | 'stems'>(last.target)
  const [sectionId, setSectionId] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !useExport.getState().busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!project) return null
  const sections = sectionsOf(project)
  const stems = project.tracks.filter((t) => !t.mute && t.regions.length > 0)
  const field = 'rounded border border-line bg-bg px-2 py-1 text-sm text-white'
  const option = (active: boolean): string =>
    `flex-1 rounded border px-3 py-2 text-left text-sm ${active ? 'border-accent bg-accent/15' : 'border-line hover:bg-line'}`

  const start = async (): Promise<void> => {
    try {
      const where = await run({ format, kbps, target, sectionId })
      if (where) {
        useUi.getState().notify(`Exportado en ${where}`)
        onClose()
      }
    } catch (err) {
      useUi.getState().notify(cleanError(err), 'error')
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <div
        role="dialog"
        aria-label="Exportar"
        className="w-[460px] max-w-[calc(100vw-32px)] space-y-4 rounded-lg border border-line bg-panel p-5 shadow-xl"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Exportar</h2>
          <button
            className="text-muted hover:text-white"
            onClick={onClose}
            disabled={busy}
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>

        <fieldset className="space-y-1">
          <legend className="mb-1 text-xs text-muted">Qué exportar</legend>
          <div className="flex gap-2">
            <button className={option(target === 'mix')} onClick={() => setTarget('mix')}>
              <strong className="block">Mezcla</strong>
              <span className="text-xs text-muted">Un archivo con la canción</span>
            </button>
            <button className={option(target === 'stems')} onClick={() => setTarget('stems')}>
              <strong className="block">Pistas por separado</strong>
              <span className="text-xs text-muted">
                {stems.length} {stems.length === 1 ? 'archivo' : 'archivos'} (stems)
              </span>
            </button>
          </div>
        </fieldset>

        <div className="grid grid-cols-2 gap-3 text-xs text-muted">
          <label className="flex flex-col gap-1">
            Formato
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as ExportFormat)}
              className={field}
            >
              <option value="mp3">MP3 (ligero)</option>
              <option value="wav">WAV (sin pérdida)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            Calidad MP3
            <select
              value={kbps}
              onChange={(e) => setKbps(Number(e.target.value) as Mp3Bitrate)}
              className={field}
              disabled={format !== 'mp3'}
            >
              {MP3_BITRATES.map((b) => (
                <option key={b} value={b}>
                  {b} kbps{b === 320 ? ' (máxima)' : b === 128 ? ' (menor tamaño)' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="col-span-2 flex flex-col gap-1">
            Tramo
            <select
              value={sectionId ?? ''}
              onChange={(e) => setSectionId(e.target.value || null)}
              className={field}
            >
              <option value="">Toda la canción</option>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  Sección: {s.name} (compases {s.startBar}–{s.startBar + s.bars - 1})
                </option>
              ))}
            </select>
          </label>
        </div>

        {target === 'stems' && (
          <p className="text-xs text-muted">
            Se exporta cada pista con su volumen y panorama, sin las silenciadas. Elegirás una
            carpeta.
          </p>
        )}

        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted" aria-live="polite">
            {busy ? status : ''}
          </span>
          <button
            className="rounded bg-accent px-4 py-1.5 text-sm font-medium disabled:opacity-40"
            disabled={
              busy || project.tracks.length === 0 || (target === 'stems' && stems.length === 0)
            }
            onClick={start}
          >
            {busy ? 'Exportando…' : 'Exportar'}
          </button>
        </div>
      </div>
    </div>
  )
}
