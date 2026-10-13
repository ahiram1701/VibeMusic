import { createElement, Fragment, type ReactNode } from 'react'

// Las notas del release llegan como HTML desde GitHub. En vez de inyectarlo tal cual,
// se recorre y solo se reconstruyen las etiquetas de esta lista: un <script>, un
// atributo onclick o un enlace javascript: simplemente no llegan a la pantalla.

const STYLES: Record<string, string> = {
  h1: 'mt-3 text-base font-semibold',
  h2: 'mt-3 text-base font-semibold',
  h3: 'mt-2 font-semibold',
  p: 'my-1.5',
  ul: 'my-1.5 list-disc space-y-1 pl-5',
  ol: 'my-1.5 list-decimal space-y-1 pl-5',
  li: '',
  strong: 'font-semibold',
  b: 'font-semibold',
  em: 'italic',
  i: 'italic',
  code: 'rounded bg-bg px-1 text-xs',
  blockquote: 'my-2 border-l-2 border-line pl-3 text-muted',
  a: 'text-accent underline hover:opacity-80'
}

function toReact(node: Node, key: number): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent
  if (node.nodeType !== Node.ELEMENT_NODE) return null
  const el = node as Element
  const tag = el.tagName.toLowerCase()
  const children = Array.from(el.childNodes).map(toReact)
  if (tag === 'br') return createElement('br', { key })
  // Etiqueta no permitida: se conserva su texto, sin la etiqueta.
  if (!(tag in STYLES)) return createElement(Fragment, { key }, ...children)
  if (tag === 'a') {
    const href = el.getAttribute('href') ?? ''
    if (!/^https?:\/\//i.test(href)) return createElement(Fragment, { key }, ...children)
    // target=_blank: el proceso principal lo abre en el navegador del sistema.
    return createElement(
      'a',
      { key, href, target: '_blank', rel: 'noreferrer', className: STYLES.a },
      ...children
    )
  }
  return createElement(tag, { key, className: STYLES[tag] || undefined }, ...children)
}

export function ReleaseNotes({ html }: { html: string }): React.JSX.Element {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return <div className="text-sm">{Array.from(doc.body.childNodes).map(toReact)}</div>
}
