/** Minimal HTML sanitiser for metadata descriptions and converted documents. */
const DROP = new Set(['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'meta', 'link', 'base', 'frame', 'frameset', 'applet'])

export function sanitizeDocument(doc: Document) {
  for (const el of Array.from(doc.querySelectorAll('*'))) {
    if (DROP.has(el.localName)) { el.remove(); continue }
    for (const attr of Array.from(el.attributes)) {
      const n = attr.name.toLowerCase()
      if (n.startsWith('on')) el.removeAttribute(attr.name)
      else if ((n === 'href' || n === 'src' || n === 'xlink:href') && /^\s*javascript:/i.test(attr.value)) el.removeAttribute(attr.name)
    }
  }
  return doc
}

export function sanitizeHtml(html: string): string {
  if (!/[<&]/.test(html)) return html.replace(/\n/g, '<br>')
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  sanitizeDocument(doc)
  for (const el of Array.from(doc.querySelectorAll('img, style'))) el.remove()
  for (const el of Array.from(doc.querySelectorAll('[style]'))) el.removeAttribute('style')
  return doc.body.innerHTML
}
