// Fechas y duraciones para la interfaz (chat, historial), en castellano y con reloj de 24 h.
// Todas reciben `now` para poder probarlas con una hora fija.

type DateLike = Date | number | string

const toDate = (d: DateLike): Date => (d instanceof Date ? d : new Date(d))

const HM = new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const WEEKDAY_DAY = new Intl.DateTimeFormat('es', { weekday: 'short', day: 'numeric' })
const DAY_MONTH = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' })
const DAY_MONTH_YEAR = new Intl.DateTimeFormat('es', {
  day: 'numeric',
  month: 'short',
  year: 'numeric'
})
const FULL = new Intl.DateTimeFormat('es', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23'
})
const LONG_DAY = new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long' })

/** Días de calendario entre dos fechas (0 = mismo día, 1 = ayer…). */
function daysBetween(a: Date, b: Date): number {
  const start = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  return Math.round((start(b) - start(a)) / 86_400_000)
}

/** Hora compacta: "02:31" hoy · "ayer 02:31" · "mar 13" esta semana · "13 oct" · "13 oct 2025". */
export function shortTime(date: DateLike, now: DateLike = Date.now()): string {
  const d = toDate(date)
  const n = toDate(now)
  const days = daysBetween(d, n)
  if (days <= 0) return HM.format(d)
  if (days === 1) return `ayer ${HM.format(d)}`
  if (days < 7) return WEEKDAY_DAY.format(d).replace('.', '')
  if (d.getFullYear() === n.getFullYear()) return DAY_MONTH.format(d).replace('.', '')
  return DAY_MONTH_YEAR.format(d).replace('.', '')
}

/** "martes, 13 de octubre de 2026, 02:31". */
export function fullDate(date: DateLike): string {
  return FULL.format(toDate(date))
}

/** "Hoy", "Ayer" o "martes, 13 de octubre" (separadores de día). */
export function dayLabel(date: DateLike, now: DateLike = Date.now()): string {
  const days = daysBetween(toDate(date), toDate(now))
  if (days === 0) return 'Hoy'
  if (days === 1) return 'Ayer'
  return LONG_DAY.format(toDate(date))
}

/** ¿Caen en días distintos? */
export function differentDay(a: DateLike, b: DateLike): boolean {
  return daysBetween(toDate(a), toDate(b)) !== 0
}

/** "justo ahora", "hace 3 min", "hace 22 h", "hace 3 días". */
export function relative(date: DateLike, now: DateLike = Date.now()): string {
  const ms = toDate(now).getTime() - toDate(date).getTime()
  if (ms < 60_000) return 'justo ahora'
  const min = Math.floor(ms / 60_000)
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  if (h < 48) return `hace ${h} h`
  return `hace ${Math.floor(h / 24)} días`
}

/** Duración legible: "45 s", "12 min", "1 h 05 min". */
export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s} s`
  const min = Math.round(s / 60)
  if (min < 60) return `${min} min`
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`
}

/** Cronómetro en vivo: "0:07", "3:12", "1:05:09". */
export function stopwatch(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const mm = String(Math.floor((s % 3600) / 60))
  const ss = String(s % 60).padStart(2, '0')
  return s >= 3600 ? `${Math.floor(s / 3600)}:${mm.padStart(2, '0')}:${ss}` : `${mm}:${ss}`
}
