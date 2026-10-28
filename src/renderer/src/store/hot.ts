// En desarrollo, Vite recarga en caliente (HMR) los módulos que cambian. Un store de
// zustand recreado empieza vacío mientras el trabajo en curso (p. ej. compose_song,
// que tarda una hora) sigue escribiendo en el viejo: la interfaz parece parada y el
// chat se queda vacío. Así se conserva la misma instancia entre recargas. En la app
// empaquetada no hay HMR y simplemente se crea.

const registry = ((globalThis as { __vibeHmrKeep?: Map<string, unknown> }).__vibeHmrKeep ??=
  new Map<string, unknown>())

/** Crea el valor una vez y, con HMR, devuelve el mismo en cada recarga del módulo. */
export function keepAcrossHmr<T>(key: string, make: () => T): T {
  if (!import.meta.hot) return make()
  if (!registry.has(key)) registry.set(key, make())
  return registry.get(key) as T
}
