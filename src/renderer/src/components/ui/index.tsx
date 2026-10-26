import { useEffect, type ReactNode } from 'react'
import { X, type LucideIcon } from 'lucide-react'

// Componentes base de la interfaz: botones, campos, modales y teclas. Así todos los
// botones de la app tienen el mismo tamaño, colores, foco y estado deshabilitado.

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-white hover:brightness-110',
  secondary: 'border border-line bg-raised text-text hover:bg-line',
  ghost: 'text-text hover:bg-line',
  danger: 'text-danger hover:bg-danger/10'
}
const SIZES: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-xs gap-1.5',
  md: 'h-8 px-3 text-sm gap-2'
}

export function buttonClass(variant: Variant = 'secondary', size: Size = 'md'): string {
  return `inline-flex shrink-0 items-center justify-center rounded-md font-medium transition-colors disabled:pointer-events-none disabled:opacity-40 ${VARIANTS[variant]} ${SIZES[size]}`
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon: Icon,
  className = '',
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: Size
  icon?: LucideIcon
}): React.JSX.Element {
  return (
    <button type="button" className={`${buttonClass(variant, size)} ${className}`} {...props}>
      {Icon && <Icon size={size === 'sm' ? 14 : 16} aria-hidden />}
      {children}
    </button>
  )
}

/** Botón solo con icono: la etiqueta es obligatoria (lector de pantalla y tooltip). */
export function IconButton({
  icon: Icon,
  label,
  hint,
  active,
  size = 'md',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: LucideIcon
  label: string
  /** Atajo que se añade al tooltip, p. ej. "Espacio". */
  hint?: string
  /** Botón de alternar (Seguir, mostrar paneles): se ve pulsado. */
  active?: boolean
  size?: Size
}): React.JSX.Element {
  const box = size === 'sm' ? 'h-7 w-7' : 'h-8 w-8'
  return (
    <button
      type="button"
      aria-label={label}
      title={hint ? `${label} (${hint})` : label}
      {...(active !== undefined && { 'aria-pressed': active })}
      className={`inline-flex shrink-0 items-center justify-center rounded-md transition-colors hover:bg-line disabled:pointer-events-none disabled:opacity-40 ${box} ${active ? 'bg-line text-white' : 'text-muted hover:text-text'} ${className}`}
      {...props}
    >
      <Icon size={size === 'sm' ? 15 : 17} aria-hidden />
    </button>
  )
}

/** Elemento de un menú contextual: icono + texto. */
export function MenuItem({
  icon: Icon,
  danger,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: LucideIcon
  danger?: boolean
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="menuitem"
      className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-line ${danger ? 'text-danger' : 'text-text'}`}
      {...props}
    >
      <Icon size={15} aria-hidden className={danger ? '' : 'text-muted'} />
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  )
}

/** Clase de inputs y selects. */
export const fieldClass =
  'rounded-md border border-line bg-bg px-2 py-1 text-sm text-text placeholder:text-muted/70 focus:border-accent focus:outline-none'

/** Separador vertical entre grupos de la cabecera. */
export function Divider(): React.JSX.Element {
  return <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-line" />
}

export function Kbd({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <kbd className="inline-flex min-w-6 items-center justify-center rounded border border-line border-b-2 bg-raised px-1.5 py-0.5 font-sans text-[11px] text-text">
      {children}
    </kbd>
  )
}

/**
 * Ventana modal: fondo oscuro, se cierra con Esc o con clic fuera (salvo `locked`, p. ej.
 * mientras exporta), título y botón de cerrar.
 */
export function Modal({
  title,
  onClose,
  width = 520,
  locked,
  children
}: {
  title: string
  onClose(): void
  width?: number
  locked?: boolean
  children: ReactNode
}): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !locked) {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, locked])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && !locked && onClose()}
    >
      <div
        role="dialog"
        aria-label={title}
        className="flex max-h-[calc(100vh-32px)] max-w-full flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-2xl"
        style={{ width }}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <IconButton
            icon={X}
            label={`Cerrar ${title.toLowerCase()}`}
            size="sm"
            onClick={onClose}
            disabled={locked}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      </div>
    </div>
  )
}
