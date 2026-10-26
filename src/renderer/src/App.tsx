import { useEffect, useRef, useState } from 'react'
import { arrangementKey, engine } from './audio/engine'
import { ChatPanel } from './components/ChatPanel'
import { GeneratePanel } from './components/GeneratePanel'
import { History } from './components/History'
import { LyricsPanel } from './components/LyricsPanel'
import { Mixer } from './components/Mixer'
import { RegionMenu, TaskList, Toast } from './components/RegionMenu'
import { SettingsDialog } from './components/SettingsDialog'
import { ShortcutsDialog } from './components/ShortcutsDialog'
import { Splitter } from './components/Splitter'
import { StartScreen } from './components/StartScreen'
import { Timeline } from './components/Timeline'
import { Transport } from './components/Transport'
import { UpdateBanner } from './components/UpdateBanner'
import { WhatsNewDialog } from './components/WhatsNewDialog'
import { zoomAt } from './components/timeline-view'
import { useGeneration } from './store/generation'
import { useLayout } from './store/layout'
import { useProject } from './store/project'
import { useVoice } from './store/voice'
import { useSinger } from './store/singer'

const TABS = [
  ['chat', 'Productor'],
  ['lyrics', 'Letra'],
  ['manual', 'Generar manual']
] as const

export default function App(): React.JSX.Element {
  const { project } = useProject()
  const { sizes, showAside, showMixer, shortcutsOpen, settingsTab, openShortcuts, openSettings } =
    useLayout()
  const [version, setVersion] = useState('')
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('chat')

  useEffect(() => {
    window.vibe.app.version().then(setVersion)
    void useGeneration.getState().init()
    void useVoice.getState().init()
    void useSinger.getState().init()
  }, [])

  // F1 o ? abren los atajos desde cualquier sitio (salvo escribiendo).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const typing = !!(e.target as HTMLElement).closest('input, textarea, select')
      if (e.key === 'F1' || (e.key === '?' && !typing)) {
        e.preventDefault()
        useLayout.getState().openShortcuts(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Comandos del menú de la ventana.
  useEffect(
    () =>
      window.vibe.app.onMenuCommand((command) => {
        const layout = useLayout.getState()
        const { project: p, undo, redo, importAudio, closeProject } = useProject.getState()
        if (command === 'shortcuts') return layout.openShortcuts(true)
        if (command === 'settings') return layout.openSettings()
        if (!p) return // lo demás necesita un proyecto abierto
        switch (command) {
          case 'home':
            return closeProject()
          case 'import':
            return void importAudio()
          case 'export':
            return p.tracks.length > 0 && layout.openExport(true)
          case 'undo':
            return void undo()
          case 'redo':
            return void redo()
          case 'zoomIn':
            return zoomAt(1.25, p)
          case 'zoomOut':
            return zoomAt(0.8, p)
          case 'toggleAside':
            return layout.toggleAside()
          case 'toggleMixer':
            return layout.toggleMixer()
        }
      }),
    []
  )

  // El título de la ventana dice qué proyecto está abierto.
  const projectName = project?.name
  useEffect(() => {
    document.title = projectName ? `${projectName} — VibeMusic` : 'VibeMusic'
  }, [projectName])

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

  const dialogs = (
    <>
      {settingsTab && <SettingsDialog tab={settingsTab} onClose={() => openSettings(null)} />}
      {shortcutsOpen && <ShortcutsDialog onClose={() => openShortcuts(false)} />}
      <UpdateBanner />
      <WhatsNewDialog />
    </>
  )

  if (!project) {
    return (
      <>
        <StartScreen version={version} />
        {dialogs}
      </>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center border-b border-line bg-panel px-3">
        <Transport />
      </header>

      <div className="flex min-h-0 flex-1">
        {showAside && (
          <>
            <aside
              className="flex min-h-0 shrink-0 flex-col bg-panel"
              style={{ width: sizes.aside }}
              aria-label="Productor"
            >
              <div className="flex shrink-0 gap-1 border-b border-line px-2 pt-2" role="tablist">
                {TABS.map(([id, label]) => (
                  <button
                    key={id}
                    role="tab"
                    aria-selected={tab === id}
                    onClick={() => setTab(id)}
                    className={`rounded-t-md px-3 py-1.5 text-xs font-medium transition-colors ${
                      tab === id ? 'bg-bg text-text' : 'text-muted hover:text-text'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex min-h-0 flex-1 flex-col" role="tabpanel">
                {tab === 'chat' ? (
                  <ChatPanel onOpenSettings={() => openSettings('llm')} />
                ) : tab === 'lyrics' ? (
                  <LyricsPanel onOpenSettings={() => openSettings('voices')} />
                ) : (
                  <GeneratePanel onOpenSettings={() => openSettings('audio')} />
                )}
              </div>
              <Splitter panel="history" orientation="horizontal" grows={-1} />
              <div className="shrink-0" style={{ height: sizes.history }}>
                <History />
              </div>
            </aside>
            <Splitter panel="aside" orientation="vertical" grows={1} />
          </>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <section className="min-h-0 flex-1 overflow-auto" aria-label="Timeline">
            <Timeline />
          </section>
          {showMixer && (
            <>
              <Splitter panel="mixer" orientation="horizontal" grows={-1} />
              <footer className="shrink-0 bg-panel" style={{ height: sizes.mixer }}>
                <Mixer />
              </footer>
            </>
          )}
        </div>
      </div>

      <RegionMenu />
      <TaskList />
      <Toast />
      {dialogs}
    </div>
  )
}
