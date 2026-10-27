// Tipos de la búsqueda web del productor, compartidos entre main y renderer.

export interface WebResult {
  title: string
  url: string
  snippet: string
}

export interface WebPage {
  url: string
  title: string
  text: string
}
