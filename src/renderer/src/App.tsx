import { useEffect, useRef, useState } from 'react'
import { arrangementKey, engine } from './audio/engine'
import { Mixer } from './components/Mixer'
import { Timeline } from './components/Timeline'
import { Transport } from './components/Transport'
import { useProject } from './store/project'

export default function App(): React.JSX.Element {
  const { project, versions, newProject, openProject, checkout } = useProject()
  const [version, setVersion] = useState('')

  useEffect(() => {
    window.vibe.app.version().then(setVersion)
  }, [])

  // Sincroniza el motor con el proyecto: si cambian posiciones/tempo reprograma
  // las fuentes; si solo cambia la mezcla, la aplica en caliente sin cortes.
  const lastArrangement = useRef('')
  useEffect(() => {
    if (!project) return
    const key = arrangementKey(project)
    if (key !== lastArrangement.current) {
      lastArrangement.current = key
      if (engine.playing) void engine.play(project)
    } else {
      engine.applyMix(project)
    }
  }, [project])

  if (!project) {
    return (
      <main className="flex h-full flex-col items-center justify-center gap-6">
        <h1 className="text-4xl font-semibold tracking-tight">
          Vibe<span className="text-accent">Music</span>
        </h1>
        <p className="text-muted">Describe la canción. El productor la construye.</p>
        <div className="flex gap-3">
          <button
            className="rounded-md bg-accent px-4 py-2 font-medium hover:opacity-90"
            onClick={() => newProject('Nueva canción')}
          >
            Nuevo proyecto
          </button>
          <button
            className="rounded-md border border-line px-4 py-2 hover:bg-panel"
            onClick={openProject}
          >
            Abrir…
          </button>
        </div>
        <span className="text-xs text-muted">v{version}</span>
      </main>
    )
  }

  return (
    <div className="grid h-full grid-cols-[340px_1fr] grid-rows-[48px_1fr_190px]">
      <header className="col-span-2 flex items-center gap-4 border-b border-line bg-panel px-4">
        <strong className="shrink-0">{project.name}</strong>
        <span className="shrink-0 text-sm text-muted">
          {project.key} · {project.timeSignature.join('/')}
        </span>
        <div className="flex-1">
          <Transport />
        </div>
      </header>

      <aside className="row-span-2 flex flex-col border-r border-line bg-panel">
        <div className="flex-1 p-4 text-sm text-muted">Chat del productor (fase 4)</div>
        <div className="border-t border-line p-3">
          <h2 className="mb-2 text-xs uppercase tracking-wide text-muted">Historial</h2>
          <ol className="max-h-48 space-y-1 overflow-auto text-sm">
            {[...versions].reverse().map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-2">
                <span className="truncate">
                  <span className="text-muted">v{v.id}</span> {v.message}
                </span>
                <button
                  className="text-xs text-accent hover:underline"
                  onClick={() => checkout(v.id)}
                >
                  restaurar
                </button>
              </li>
            ))}
          </ol>
        </div>
      </aside>

      <section className="overflow-auto">
        <Timeline />
      </section>

      <footer className="border-t border-line bg-panel">
        <Mixer />
      </footer>
    </div>
  )
}
