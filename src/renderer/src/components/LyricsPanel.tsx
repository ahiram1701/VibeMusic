import { useState } from 'react'
import { hasLyrics } from '@shared/arrange'
import { sectionsOf, updateSection } from '@shared/sections'
import { cleanError, currentSinger, singFromEditor, useChat } from '../store/chat'
import { useGeneration, vocalProvider } from '../store/generation'
import { useProject } from '../store/project'
import { useSinger } from '../store/singer'

// Editor de letra: un cuadro por sección y la voz que canta. Cada cambio se guarda
// como versión (Ctrl+Z lo deshace) sin volver a generar; "Cantar de nuevo" pide una
// toma nueva con la letra actual: entera en la nube, o la pista de voz del cantante
// local (con la melodía guardada, adaptada a la letra).

const LANGUAGES: [string, string][] = [
  ['', 'Automático'],
  ['es', 'Español'],
  ['en', 'Inglés'],
  ['pt', 'Portugués'],
  ['fr', 'Francés'],
  ['it', 'Italiano'],
  ['de', 'Alemán']
]

export function LyricsPanel({ onOpenSettings }: { onOpenSettings(): void }): React.JSX.Element {
  const { project, commit } = useProject()
  // Se suscribe a los motores y ajustes para refrescar el aviso cuando cambian.
  useGeneration((s) => s.singers)
  useGeneration((s) => s.settings)
  const localStatus = useSinger((s) => s.status)
  const agentRunning = useChat((s) => s.running)
  const [singing, setSinging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!project) return <div />

  const sections = sectionsOf(project)
  const who = currentSinger()
  const cloud = vocalProvider()
  const ready = who === 'local' ? localStatus.state === 'ready' : who === 'cloud' && !!cloud?.ready
  const hasMelody = sections.some((s) => s.melody?.length)
  const problem =
    who === null
      ? 'Nadie puede cantar: instala el cantante local o configura las voces en la nube.'
      : who === 'local'
        ? localStatus.state === 'ready'
          ? null
          : 'El cantante local no está instalado.'
        : cloud?.ready
          ? null
          : `El motor de voz no está listo: ${cloud?.notReadyReason ?? 'revisa Ajustes'}.`
  const field = 'w-full rounded border border-line bg-bg px-2 py-1 text-sm text-white'

  const save = (next: typeof project, message: string): void => {
    if (next !== project) void commit(next, message)
  }

  const sing = async (): Promise<void> => {
    setError(null)
    setSinging(true)
    try {
      await singFromEditor()
    } catch (err) {
      setError(cleanError(err))
    } finally {
      setSinging(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3 text-sm">
      {problem && (
        <p className="rounded border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-300">
          {problem}{' '}
          <button className="underline" onClick={onOpenSettings}>
            Ajustes
          </button>
        </p>
      )}

      {sections.length === 0 ? (
        <p className="text-xs text-muted">
          Aún no hay secciones. Pide al productor una canción con letra (por ejemplo, &quot;una
          balada con letra sobre el mar&quot;) o crea las secciones en el timeline.
        </p>
      ) : (
        <>
          <label className="space-y-1">
            <span className="text-xs text-muted">Voz (en inglés)</span>
            <input
              key={`vocals-${project.vocals ?? ''}`}
              defaultValue={project.vocals ?? ''}
              placeholder="warm female pop vocal"
              className={field}
              onBlur={(e) => {
                const vocals = e.target.value.trim() || undefined
                if (vocals !== project.vocals) save({ ...project, vocals }, 'voz de la canción')
              }}
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted">Idioma de la letra</span>
            <select
              value={project.lyricsLanguage ?? ''}
              className={field}
              onChange={(e) =>
                save(
                  { ...project, lyricsLanguage: e.target.value || undefined },
                  'idioma de la letra'
                )
              }
            >
              {LANGUAGES.map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          {sections.map((s) => (
            <label key={s.id} className="space-y-1">
              <span className="text-xs text-muted">
                {s.name} · compases {s.startBar}–{s.startBar + s.bars - 1}
              </span>
              <textarea
                // Si el productor cambia la letra, el cuadro se rehace con la nueva.
                key={`${s.id}-${s.lyrics ?? ''}`}
                defaultValue={s.lyrics ?? ''}
                rows={Math.max(2, (s.lyrics ?? '').split('\n').length + 1)}
                placeholder="(instrumental)"
                className={`${field} resize-y leading-snug`}
                onBlur={(e) => {
                  const lyrics = e.target.value.trim()
                  if (lyrics !== (s.lyrics ?? '')) {
                    save(updateSection(project, s.id, { lyrics }), `letra de ${s.name}`)
                  }
                }}
              />
            </label>
          ))}

          <button
            className="rounded bg-accent px-3 py-2 font-medium disabled:opacity-40"
            disabled={
              singing ||
              agentRunning ||
              !ready ||
              !hasLyrics(sections) ||
              (who === 'local' && !hasMelody)
            }
            onClick={sing}
          >
            {singing ? 'Cantando… (puede tardar unos minutos)' : '🎤 Cantar de nuevo'}
          </button>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <p className="text-xs text-muted">
            {who === 'local'
              ? hasMelody
                ? 'El cantante local vuelve a cantar la pista de voz con esta letra sobre la melodía guardada (cada línea, con las notas de su frase). Para cambiar la melodía, pídeselo al productor.'
                : 'Esta canción no tiene melodía para el cantante local: pide al productor que la componga.'
              : 'La canción se canta entera, de una vez, con esta letra. Las secciones son aproximadas: el cantante sigue la letra, no los compases exactos.'}
          </p>
        </>
      )}
    </div>
  )
}
