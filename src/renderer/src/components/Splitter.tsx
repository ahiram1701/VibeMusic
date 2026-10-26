import { useLayout, type PanelSize } from '../store/layout'

// Divisor arrastrable entre dos paneles: una línea de 1 px con una zona de agarre más
// ancha. `grows` dice hacia dónde crece el panel al arrastrar: el lateral crece hacia
// la derecha (1); el mezclador y el historial, hacia arriba (-1).

const LABELS: Record<PanelSize, string> = {
  aside: 'panel del productor',
  mixer: 'mezclador',
  history: 'historial'
}

export function Splitter({
  panel,
  orientation,
  grows
}: {
  panel: PanelSize
  orientation: 'vertical' | 'horizontal'
  grows: 1 | -1
}): React.JSX.Element {
  const { sizes, setSize, resetSize } = useLayout()
  const vertical = orientation === 'vertical'

  return (
    <div
      role="separator"
      aria-orientation={orientation}
      aria-label={`Cambiar el tamaño: ${LABELS[panel]}`}
      aria-valuenow={sizes[panel]}
      title="Arrastra para cambiar el tamaño · doble clic: tamaño inicial"
      data-testid={`splitter-${panel}`}
      className={`group relative shrink-0 bg-line ${vertical ? 'h-full w-px cursor-col-resize' : 'h-px w-full cursor-row-resize'}`}
      onDoubleClick={() => resetSize(panel)}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault()
        const el = e.currentTarget
        el.setPointerCapture(e.pointerId)
        const start = vertical ? e.clientX : e.clientY
        const from = sizes[panel]
        const onMove = (ev: PointerEvent): void => {
          const delta = (vertical ? ev.clientX : ev.clientY) - start
          setSize(panel, from + grows * delta)
        }
        const onUp = (): void => {
          el.removeEventListener('pointermove', onMove)
          el.removeEventListener('pointerup', onUp)
          document.body.style.cursor = ''
        }
        document.body.style.cursor = vertical ? 'col-resize' : 'row-resize'
        el.addEventListener('pointermove', onMove)
        el.addEventListener('pointerup', onUp)
      }}
    >
      <div
        className={`absolute z-30 transition-colors group-hover:bg-accent/50 group-active:bg-accent ${vertical ? '-inset-x-1.5 inset-y-0' : '-inset-y-1.5 inset-x-0'}`}
      />
    </div>
  )
}
