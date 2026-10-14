import { useEffect, useState } from 'react'

/** Hora actual que se refresca cada `everyMs` (para "hace 3 min" y cronómetros). */
export function useNow(everyMs: number, active = true): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setNow(Date.now()), everyMs)
    return () => clearInterval(timer)
  }, [everyMs, active])
  return now
}
