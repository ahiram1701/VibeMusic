// Estado de la actualización automática, compartido entre el proceso principal
// (que habla con electron-updater) y la interfaz (banner, Ajustes, novedades).

export type UpdateState =
  | 'disabled' // app sin instalar (desarrollo): no se busca nada
  | 'idle' // aún no se ha comprobado
  | 'checking'
  | 'downloading'
  | 'ready' // descargada: se instala al reiniciar o al cerrar
  | 'up-to-date'
  | 'error'

export interface UpdateStatus {
  state: UpdateState
  /** Versión nueva (en downloading y ready). */
  version?: string
  /** Progreso de la descarga, 0–100. */
  percent?: number
  error?: string
}

/** Novedades de la versión recién instalada, para mostrarlas una vez. */
export interface WhatsNew {
  version: string
  /** HTML de las notas del release (sin la lista de PRs), o null si no se guardaron. */
  notes: string | null
  url: string
}

const REPO_URL = 'https://github.com/ahiram1701/VibeMusic'

export const releaseUrl = (version: string): string => `${REPO_URL}/releases/tag/v${version}`

/**
 * Las notas generadas por GitHub terminan con "What's Changed" (lista de PRs en
 * inglés, incluidas las de Dependabot). Para el usuario basta con lo anterior, sin el
 * encabezado "Novedades" que ya da el título del diálogo.
 * Si no hay nada antes, se devuelven completas.
 */
export function userFacingNotes(html: string): string {
  const cut = html.search(/<h2[^>]*>\s*What(?:'|&#39;|&#x27;|’)s Changed/i)
  const kept = (cut >= 0 ? html.slice(0, cut) : html)
    .trim()
    // El diálogo ya se titula "Novedades de VibeMusic x": no repetirlo.
    .replace(/^<h2[^>]*>\s*Novedades\s*<\/h2>\s*/i, '')
  return kept || html.trim()
}

/** Texto para Ajustes. */
export function describeUpdateStatus(s: UpdateStatus): string {
  switch (s.state) {
    case 'disabled':
      return 'Las actualizaciones solo funcionan en la app instalada.'
    case 'idle':
      return 'Aún no se ha comprobado si hay versiones nuevas.'
    case 'checking':
      return 'Buscando actualizaciones…'
    case 'downloading':
      return `Descargando la versión ${s.version ?? 'nueva'}… ${Math.floor(s.percent ?? 0)} %`
    case 'ready':
      return `La versión ${s.version} está lista. Se instalará al reiniciar o al cerrar la app.`
    case 'up-to-date':
      return 'Tienes la última versión.'
    case 'error':
      return `No se pudo comprobar: ${friendlyError(s.error)}`
  }
}

function friendlyError(error = ''): string {
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ERR_INTERNET|net::|getaddrinfo/i.test(error)) {
    return 'sin conexión a internet.'
  }
  if (/404|Cannot find latest|No published versions/i.test(error)) {
    return 'no hay ninguna versión publicada.'
  }
  return error.split('\n')[0].slice(0, 160) || 'error desconocido.'
}
