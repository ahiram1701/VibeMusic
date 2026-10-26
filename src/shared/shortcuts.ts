// Todos los atajos de teclado y gestos de VibeMusic en un solo sitio. Los usan el
// panel "Atajos y gestos" (F1) y los tooltips de los botones, así que si cambia un
// atajo basta con cambiarlo aquí para que la ayuda no se quede desactualizada.

export type ShortcutGroup =
  'Reproducción' | 'Edición' | 'Timeline' | 'Secciones' | 'Mezclador' | 'Productor' | 'Ventana'

export interface Shortcut {
  id: string
  group: ShortcutGroup
  /** Teclas o gesto; cada elemento se dibuja como una tecla ("Mayús", "←"). */
  keys: string[]
  description: string
}

export const SHORTCUTS: Shortcut[] = [
  // Reproducción
  { id: 'play', group: 'Reproducción', keys: ['Espacio'], description: 'Reproducir / parar' },
  { id: 'start', group: 'Reproducción', keys: ['Inicio'], description: 'Ir al principio' },
  { id: 'end', group: 'Reproducción', keys: ['Fin'], description: 'Ir al final' },
  { id: 'prevBar', group: 'Reproducción', keys: ['←'], description: 'Compás anterior' },
  { id: 'nextBar', group: 'Reproducción', keys: ['→'], description: 'Compás siguiente' },
  {
    id: 'prevSection',
    group: 'Reproducción',
    keys: ['Mayús', '←'],
    description: 'Sección anterior'
  },
  {
    id: 'nextSection',
    group: 'Reproducción',
    keys: ['Mayús', '→'],
    description: 'Sección siguiente'
  },
  {
    id: 'goto',
    group: 'Reproducción',
    keys: ['Clic en el contador'],
    description: 'Escribir adónde ir: 9, 9.3 o 1:23'
  },
  // Edición
  { id: 'undo', group: 'Edición', keys: ['Ctrl', 'Z'], description: 'Deshacer' },
  { id: 'redo', group: 'Edición', keys: ['Ctrl', 'Y'], description: 'Rehacer (o Ctrl+Mayús+Z)' },
  {
    id: 'deleteRegion',
    group: 'Edición',
    keys: ['Supr'],
    description: 'Borrar la región seleccionada (también Retroceso)'
  },
  // Timeline
  {
    id: 'scrub',
    group: 'Timeline',
    keys: ['Arrastrar en la regla'],
    description: 'Mover la línea de reproducción (también el triángulo ▼)'
  },
  {
    id: 'clickLane',
    group: 'Timeline',
    keys: ['Clic en zona vacía'],
    description: 'Llevar la línea ahí y quitar la selección'
  },
  {
    id: 'free',
    group: 'Timeline',
    keys: ['Alt', 'Arrastrar'],
    description: 'Mover la línea sin ajustarse a la rejilla'
  },
  { id: 'zoom', group: 'Timeline', keys: ['Ctrl', 'Rueda'], description: 'Acercar / alejar' },
  {
    id: 'moveRegion',
    group: 'Timeline',
    keys: ['Arrastrar una región'],
    description: 'Moverla (se ajusta a la rejilla)'
  },
  {
    id: 'regionMenu',
    group: 'Timeline',
    keys: ['Clic derecho en una región'],
    description: 'Variación, continuar, separar en pistas, duplicar, borrar…'
  },
  // Secciones
  {
    id: 'sectionGo',
    group: 'Secciones',
    keys: ['Clic en una sección'],
    description: 'Ir a su principio'
  },
  {
    id: 'sectionRename',
    group: 'Secciones',
    keys: ['Doble clic en una sección'],
    description: 'Cambiarle el nombre'
  },
  {
    id: 'sectionMenu',
    group: 'Secciones',
    keys: ['Clic derecho en una sección'],
    description: 'Repetir en bucle, copiar al final, eliminar'
  },
  {
    id: 'sectionResize',
    group: 'Secciones',
    keys: ['Arrastrar su borde derecho'],
    description: 'Alargarla o acortarla por compases'
  },
  // Mezclador
  {
    id: 'mixerReset',
    group: 'Mezclador',
    keys: ['Doble clic en volumen o pan'],
    description: 'Volver a 0 dB / al centro'
  },
  // Productor
  { id: 'send', group: 'Productor', keys: ['Enter'], description: 'Enviar el mensaje' },
  { id: 'newline', group: 'Productor', keys: ['Mayús', 'Enter'], description: 'Nueva línea' },
  {
    id: 'generate',
    group: 'Productor',
    keys: ['Ctrl', 'Enter'],
    description: 'Generar (pestaña Generar manual)'
  },
  // Ventana
  { id: 'help', group: 'Ventana', keys: ['F1'], description: 'Ver estos atajos (también ?)' },
  {
    id: 'close',
    group: 'Ventana',
    keys: ['Esc'],
    description: 'Cerrar el diálogo o menú abierto'
  },
  {
    id: 'resize',
    group: 'Ventana',
    keys: ['Arrastrar un divisor'],
    description: 'Cambiar el tamaño de los paneles (doble clic: tamaño inicial)'
  }
]

/** Texto corto de un atajo para tooltips: "Mayús+←". */
export function shortcutHint(id: string): string {
  const s = SHORTCUTS.find((x) => x.id === id)
  if (!s) throw new Error(`Atajo desconocido: ${id}`)
  return s.keys.join('+')
}

/** Busca atajos por texto (descripción o teclas), sin distinguir acentos ni mayúsculas. */
export function searchShortcuts(query: string): Shortcut[] {
  const norm = (t: string): string => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const q = norm(query.trim())
  if (!q) return SHORTCUTS
  return SHORTCUTS.filter((s) =>
    norm(`${s.description} ${s.keys.join(' ')} ${s.group}`).includes(q)
  )
}
