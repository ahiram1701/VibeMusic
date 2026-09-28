import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import type { Project, Section } from '@shared/project'
import {
  appendSection,
  copySection,
  removeSection,
  sectionRangeSec,
  sectionsOf,
  updateSection
} from '@shared/sections'
import { engine } from '../audio/engine'
import { cleanError } from '../store/chat'
import { useProject } from '../store/project'
import { useUi } from '../store/ui'

export const SECTIONS_H = 26

const PALETTE = [
  '#6366f1',
  '#0ea5e9',
  '#f43f5e',
  '#10b981',
  '#f59e0b',
  '#a855f7',
  '#14b8a6',
  '#ef4444'
]

/** Mismo nombre → mismo color (todos los "Estribillo" se ven iguales). */
function colorOf(name: string): string {
  let h = 0
  for (const ch of name.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return PALETTE[h % PALETTE.length]
}

/** Aplica un cambio de secciones como versión nueva, o avisa del error (p. ej. solapes). */
async function apply(change: (p: Project) => Project, message: string): Promise<boolean> {
  const { project, commit } = useProject.getState()
  if (!project) return false
  try {
    await commit(change(project), message)
    return true
  } catch (err) {
    useUi.getState().notify(cleanError(err), 'error')
    return false
  }
}

/** Botón para añadir una sección detrás de la última (va en la columna de cabeceras). */
export function AddSectionButton(): React.JSX.Element {
  return (
    <button
      className="w-full truncate rounded px-2 py-0.5 text-left text-[11px] text-muted hover:bg-line hover:text-white"
      onClick={() => {
        const project = useProject.getState().project
        if (!project) return
        const added = appendSection(project, 8)
        const s = sectionsOf(added).at(-1)!
        void apply(
          () => added,
          `Sección añadida: ${s.name} (compás ${s.startBar}, ${s.bars} compases)`
        )
      }}
      title="Añadir una sección de 8 compases al final"
    >
      + Sección
    </button>
  )
}

/** Franja de secciones sobre la regla de compases. */
export function SectionsLane({
  project,
  width
}: {
  project: Project
  width: number
}): React.JSX.Element {
  const pxPerBeat = useUi((s) => s.pxPerBeat)
  const loop = useSyncExternalStore(engine.subscribe, engine.getLoop)
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const perBar = project.timeSignature[0]
  const barPx = perBar * pxPerBeat

  return (
    <div className="relative" style={{ width, height: SECTIONS_H }}>
      {sectionsOf(project).map((s) => (
        <SectionBlock
          key={s.id}
          project={project}
          section={s}
          barPx={barPx}
          looping={loop?.id === s.id}
          onMenu={(x, y) => setMenu({ id: s.id, x, y })}
        />
      ))}
      {menu && (
        <SectionMenu
          project={project}
          sectionId={menu.id}
          x={menu.x}
          y={menu.y}
          looping={loop?.id === menu.id}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}

function SectionBlock({
  project,
  section,
  barPx,
  looping,
  onMenu
}: {
  project: Project
  section: Section
  barPx: number
  looping: boolean
  onMenu(x: number, y: number): void
}): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [dragBars, setDragBars] = useState<number | null>(null)
  const drag = useRef<{ x: number; bars: number } | null>(null)
  const bars = dragBars ?? section.bars
  const color = colorOf(section.name)

  return (
    <div
      data-testid="section"
      className="group absolute top-0.5 bottom-0.5 flex items-center overflow-hidden rounded-sm text-[11px] font-medium text-white"
      style={{
        left: (section.startBar - 1) * barPx,
        width: bars * barPx,
        background: `${color}cc`,
        outline: looping ? '2px solid white' : undefined
      }}
      title={`${section.name} · compases ${section.startBar}–${section.startBar + section.bars - 1} (clic: ir · doble clic: renombrar · clic derecho: más)`}
      onClick={() => engine.seek(project, sectionRangeSec(project, section).startSec)}
      onDoubleClick={() => setEditing(true)}
      onContextMenu={(e) => {
        e.preventDefault()
        onMenu(e.clientX, e.clientY)
      }}
    >
      {editing ? (
        <input
          autoFocus
          defaultValue={section.name}
          aria-label="Nombre de la sección"
          className="mx-1 w-full rounded bg-black/40 px-1 text-[11px] text-white outline-none"
          onClick={(e) => e.stopPropagation()}
          onBlur={(e) => {
            setEditing(false)
            const name = e.target.value.trim()
            if (name && name !== section.name) {
              void apply(
                (p) => updateSection(p, section.id, { name }),
                `Sección renombrada: ${name}`
              )
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') setEditing(false)
          }}
        />
      ) : (
        <span className="truncate px-1.5">
          {looping && '🔁 '}
          {section.name}
          <span className="ml-1 opacity-70">{bars}</span>
        </span>
      )}

      {/* Borde derecho: arrastrar para cambiar la longitud (en compases enteros). */}
      <div
        className="absolute top-0 right-0 bottom-0 w-1.5 cursor-ew-resize bg-white/0 group-hover:bg-white/40"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => {
          e.stopPropagation()
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = { x: e.clientX, bars: section.bars }
        }}
        onPointerMove={(e) => {
          if (!drag.current) return
          setDragBars(
            Math.max(1, drag.current.bars + Math.round((e.clientX - drag.current.x) / barPx))
          )
        }}
        onPointerUp={() => {
          drag.current = null
          const to = dragBars
          setDragBars(null)
          if (to !== null && to !== section.bars) {
            void apply(
              (p) => updateSection(p, section.id, { bars: to }),
              `${section.name}: ${to} ${to === 1 ? 'compás' : 'compases'}`
            )
          }
        }}
      />
    </div>
  )
}

function SectionMenu({
  project,
  sectionId,
  x,
  y,
  looping,
  onClose
}: {
  project: Project
  sectionId: string
  x: number
  y: number
  looping: boolean
  onClose(): void
}): React.JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDown = (e: PointerEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const section = sectionsOf(project).find((s) => s.id === sectionId)
  if (!section) return null
  const item = 'block w-full rounded px-3 py-1.5 text-left text-sm hover:bg-line'
  const act = (fn: () => void): void => {
    onClose()
    fn()
  }

  // Portal a <body>: dentro de la cabecera fija, la regla de compases lo taparía
  // (contextos de apilamiento distintos), por mucho z-index que tenga.
  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label="Acciones de la sección"
      className="fixed z-50 w-56 rounded-md border border-line bg-panel p-1 shadow-xl"
      style={{
        left: Math.min(x, window.innerWidth - 230),
        top: Math.min(y, window.innerHeight - 180)
      }}
    >
      <button
        role="menuitem"
        className={item}
        onClick={() =>
          act(() =>
            engine.setLoop(
              project,
              looping ? null : { ...sectionRangeSec(project, section), id: section.id }
            )
          )
        }
      >
        {looping ? '⏹ Quitar bucle' : '🔁 Repetir en bucle'}
      </button>
      <button
        role="menuitem"
        className={item}
        onClick={() =>
          act(
            () =>
              void apply(
                (p) => copySection(p, section.id),
                `Sección copiada al final: ${section.name}`
              )
          )
        }
      >
        ⧉ Copiar al final (con su audio)
      </button>
      <button
        role="menuitem"
        className={`${item} text-red-400`}
        onClick={() =>
          act(() => {
            if (looping) engine.setLoop(project, null)
            void apply((p) => removeSection(p, section.id), `Sección eliminada: ${section.name}`)
          })
        }
      >
        🗑 Eliminar sección (el audio se queda)
      </button>
    </div>,
    document.body
  )
}
