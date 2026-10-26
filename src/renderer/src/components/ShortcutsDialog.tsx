import { useState } from 'react'
import { Search } from 'lucide-react'
import { searchShortcuts, type ShortcutGroup } from '@shared/shortcuts'
import { fieldClass, Kbd, Modal } from './ui'

// Panel "Atajos y gestos" (F1 o ?): todos los atajos de la app, agrupados y con buscador.

const GROUPS: ShortcutGroup[] = [
  'Reproducción',
  'Edición',
  'Timeline',
  'Secciones',
  'Mezclador',
  'Productor',
  'Ventana'
]

export function ShortcutsDialog({ onClose }: { onClose(): void }): React.JSX.Element {
  const [query, setQuery] = useState('')
  const found = searchShortcuts(query)

  return (
    <Modal title="Atajos y gestos" onClose={onClose} width={640}>
      <div className="sticky top-0 z-10 border-b border-line bg-panel px-5 py-3">
        <label className="relative block">
          <Search
            size={15}
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted"
            aria-hidden
          />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar: sección, deshacer, zoom…"
            aria-label="Buscar atajos"
            className={`${fieldClass} w-full pl-8`}
          />
        </label>
      </div>
      <div className="space-y-5 px-5 py-4">
        {found.length === 0 && (
          <p className="text-sm text-muted">Ningún atajo coincide con «{query}».</p>
        )}
        {GROUPS.map((group) => {
          const items = found.filter((s) => s.group === group)
          if (items.length === 0) return null
          return (
            <section key={group}>
              <h3 className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">
                {group}
              </h3>
              <ul className="divide-y divide-line rounded-lg border border-line">
                {items.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-4 px-3 py-2">
                    <span className="text-sm">{s.description}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {s.keys.map((k, i) => (
                        <span key={k} className="flex items-center gap-1">
                          {i > 0 && <span className="text-xs text-muted">+</span>}
                          <Kbd>{k}</Kbd>
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </div>
    </Modal>
  )
}
