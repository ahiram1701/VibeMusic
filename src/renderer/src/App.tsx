import { useEffect, useRef, useState } from 'react'
import { arrangementKey, engine } from './audio/engine'
import { ChatPanel } from './components/ChatPanel'
import { GeneratePanel } from './components/GeneratePanel'
import { History } from './components/History'
import { Mixer } from './components/Mixer'
import { RegionMenu, TaskList, Toast } from './components/RegionMenu'
import { SettingsDialog } from './components/SettingsDialog'
import { Timeline } from './components/Timeline'
import { Transport } from './components/Transport'
import { useGeneration } from './store/generation'
import { useProject } from './store/project'

export default function App(): React.JSX.Element {
  const { project, newProject, openProject } = useProject()
  const [version, setVersion] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [tab, setTab] = useState<'chat' | 'manual'>('chat')

  useEffect(() => {
    window.vibe.app.version().then(setVersion)
    void useGeneration.getState().init()
  }, [])

  // Sincroniza el motor con el proyecto: si cambian posiciones/tempo reprograma
  // las fuentes; si solo cambia la mezcla, la aplica en caliente sin cortes.
  const lastArrangement = useRef('')
  useEffect(() => {
    if (!project) return
    const key = arrangementKey(project)
    if (key !== lastArrangement.current) {
      lastArrangement.current = key
      if (engine.isPlaying()) void engine.play(project)
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

      <aside className="row-span-2 flex min-h-0 flex-col border-r border-line bg-panel">
        <div className="flex items-center gap-1 border-b border-line px-2 pt-2" role="tablist">
          {(
            [
              ['chat', 'Productor'],
              ['manual', 'Generar manual']
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`rounded-t-md px-3 py-1.5 text-xs font-medium ${
                tab === id ? 'bg-bg text-white' : 'text-muted hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
          <button
            className="ml-auto pb-1 text-xs text-muted hover:text-white"
            onClick={() => setShowSettings(true)}
          >
            ⚙ Ajustes
          </button>
        </div>
        {tab === 'chat' ? (
          <ChatPanel onOpenSettings={() => setShowSettings(true)} />
        ) : (
          <GeneratePanel onOpenSettings={() => setShowSettings(true)} />
        )}
        <History />
      </aside>

      <section className="overflow-auto">
        <Timeline />
      </section>

      <footer className="border-t border-line bg-panel">
        <Mixer />
      </footer>

      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}
      <RegionMenu />
      <TaskList />
      <Toast />
    </div>
  )
}
