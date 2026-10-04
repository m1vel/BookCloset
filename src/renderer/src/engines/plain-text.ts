/** Readable plain text of a DOM subtree: line breaks between blocks, no injected translations. */
const BLOCK = new Set([
  'P', 'DIV', 'SECTION', 'ARTICLE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'PRE',
  'DD', 'DT', 'TR', 'TABLE', 'FIGURE', 'FIGCAPTION', 'HEADER', 'FOOTER', 'ASIDE', 'HR', 'UL', 'OL',
])
const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'RT', 'RP'])
const INVISIBLE = new RegExp('[' + String.fromCharCode(0xad, 0x200b, 0xfeff) + ']', 'g')

export function plainText(root: Node): string {
  let out = ''
  const visit = (n: Node) => {
    if (n.nodeType === 3 || n.nodeType === 4) { out += (n as Text).data; return }
    if (n.nodeType !== 1 && n.nodeType !== 11) return
    const el = n as Element
    const tag = n.nodeType === 1 ? el.tagName.toUpperCase() : ''
    if (SKIP.has(tag) || (n.nodeType === 1 && el.hasAttribute('data-bc-tr'))) return
    if (tag === 'BR') { out += '\n'; return }
    const block = BLOCK.has(tag)
    if (block && out && !out.endsWith('\n')) out += '\n'
    for (let c = n.firstChild; c; c = c.nextSibling) visit(c)
    if (block && !out.endsWith('\n')) out += '\n'
  }
  visit(root)
  return out
    .replace(INVISIBLE, '')
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Keeps the end of `parts` (most recent text) within `max` characters. */
export function tail(parts: string[], max: number) {
  let text = parts.filter(Boolean).join('\n\n')
  const trimmed = text.length > max
  if (trimmed) {
    text = text.slice(text.length - max)
    // start at a paragraph boundary
    const nl = text.indexOf('\n')
    if (nl > 0 && nl < 2000) text = text.slice(nl + 1)
  }
  return { text, trimmed }
}
