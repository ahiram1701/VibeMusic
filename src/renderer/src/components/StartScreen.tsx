import { useEffect, useState } from 'react'
import type { RecentProject } from '@shared/ipc-contract'
import { folderName } from '@shared/project'
import { cleanError } from '../store/chat'
import { useProject } from '../store/project'

// Pantalla de inicio: crear un proyecto (con nombre, en su propia carpeta), abrir uno
// existente o volver a uno reciente con un clic.

export function StartScreen({ version }: { version: string }): React.JSX.Element {
  const { newProject, openProject } = useProject()
  const [recent, setRecent] = useState<RecentProject[]>([])
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.vibe.project.recent().then(setRecent)
  }, [])

  const attempt = async (fn: () => Promise<void>): Promise<void> => {
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(cleanError(err))
      void window.vibe.project.recent().then(setRecent)
    }
  }

  return (
    <main className="flex h-full flex-col items-center justify-center gap-6 p-4">
      <h1 className="text-4xl font-semibold tracking-tight">
        Vibe<span className="text-accent">Music</span>
      </h1>
      <p className="text-muted">Describe la canción. El productor la construye.</p>
      <div className="flex gap-3">
        <button
          className="rounded-md bg-accent px-4 py-2 font-medium hover:opacity-90"
          onClick={() => setCreating(true)}
        >
          Nuevo proyecto
        </button>
        <button
          className="rounded-md border border-line px-4 py-2 hover:bg-panel"
          title="Elige la carpeta de un proyecto que ya tengas"
          onClick={() => attempt(() => openProject())}
        >
          Abrir…
        </button>
      </div>

      {error && <p className="max-w-md text-center text-sm text-red-400">{error}</p>}

      {recent.length > 0 && (
        <section className="w-full max-w-md">
          <h2 className="mb-2 text-xs uppercase tracking-wide text-muted">Recientes</h2>
          <ul className="divide-y divide-line rounded-md border border-line">
            {recent.map((r) => (
              <li key={r.dir}>
                <button
                  className="block w-full px-3 py-2 text-left hover:bg-panel"
                  title={r.dir}
                  onClick={() => attempt(() => openProject(r.dir))}
                >
                  <span className="block truncate text-sm">{r.name}</span>
                  <span className="block truncate text-xs text-muted">{r.dir}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <span className="text-xs text-muted">v{version}</span>

      {creating && (
        <NewProjectDialog
          onCancel={() => setCreating(false)}
          onCreate={(name, parent) =>
            attempt(async () => {
              await newProject(name, parent)
              setCreating(false)
            })
          }
        />
      )}
    </main>
  )
}

/** Separador de rutas de la carpeta (\\ en Windows, / en macOS y Linux). */
const sep = (path: string): string => (path.includes('\\') ? '\\' : '/')

/** Nombre de la canción y dónde guardarla (por defecto Documentos/VibeMusic). */
function NewProjectDialog({
  onCancel,
  onCreate
}: {
  onCancel(): void
  onCreate(name: string, parent: string): void
}): React.JSX.Element {
  const [name, setName] = useState('Nueva canción')
  const [parent, setParent] = useState('')

  useEffect(() => {
    void window.vibe.project.defaultParent().then(setParent)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const field = 'w-full rounded border border-line bg-bg px-2 py-1 text-sm text-white'
  const ready = name.trim().length > 0 && parent.length > 0

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onMouseDown={(e) => e.target === e.currentTarget && onCancel()}
    >
      <form
        role="dialog"
        aria-label="Nuevo proyecto"
        className="w-[440px] max-w-[calc(100vw-32px)] space-y-3 rounded-lg border border-line bg-panel p-5 shadow-xl"
        onSubmit={(e) => {
          e.preventDefault()
          if (ready) onCreate(name.trim(), parent)
        }}
      >
        <h2 className="text-lg font-semibold">Nuevo proyecto</h2>
        <label className="block space-y-1 text-sm">
          <span className="text-muted">Nombre de la canción</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={field}
            autoFocus
            onFocus={(e) => e.target.select()}
          />
        </label>
        <div className="space-y-1 text-sm">
          <span className="text-muted">Se guarda en</span>
          <div className="flex items-center gap-2">
            <span className="flex-1 truncate text-xs" title={parent}>
              {parent ? `${parent}${sep(parent)}${folderName(name)}` : '…'}
            </span>
            <button
              type="button"
              className="rounded border border-line px-2 py-1 text-xs hover:bg-line"
              onClick={async () => {
                const chosen = await window.vibe.project.chooseParent(parent)
                if (chosen) setParent(chosen)
              }}
            >
              Cambiar…
            </button>
          </div>
          <p className="text-xs text-muted">
            Cada proyecto va en su propia carpeta. Si ya existe una con ese nombre, se crea otra al
            lado: nunca se sobrescribe nada.
          </p>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            className="rounded px-3 py-1.5 text-sm text-muted"
            onClick={onCancel}
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="rounded bg-accent px-4 py-1.5 text-sm font-medium disabled:opacity-40"
            disabled={!ready}
          >
            Crear
          </button>
        </div>
      </form>
    </div>
  )
}
