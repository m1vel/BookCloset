import type { BatchTranslateRequest, TranslateErrorCode } from '../../../../shared/types'
import { bc } from '../../api'
import { detectLanguage } from '../../translation'

/**
 * Bilingual reading: a translation is appended inside every paragraph as a block-level
 * `<span data-bc-tr>`. epubcfi.js and the text walker ignore these elements, so locations,
 * highlights and search are unaffected, and removing them restores the original document.
 */
export const TR_ATTR = 'data-bc-tr'

export interface BilingualOptions extends Omit<BatchTranslateRequest, 'texts'> {
  accent: string
}
export interface BilingualProgress {
  done: number
  total: number
  error?: { code: TranslateErrorCode; message: string }
}

const BLOCK = new Set([
  'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'DD', 'DT', 'TD', 'TH', 'PRE',
  'FIGCAPTION', 'CAPTION', 'DIV', 'SECTION', 'ARTICLE', 'ASIDE', 'HEADER', 'FOOTER', 'BODY',
])
const SKIP = new Set(['SCRIPT', 'STYLE', 'RT', 'RP', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'MATH', 'HEAD'])
const LETTERS = /\p{L}.*\p{L}/su
const SHY = new RegExp(String.fromCharCode(0xad), 'g')
const PER_REQUEST = 24

const walk = (root: Node, onText: (t: Text) => void) => {
  const doc = root.ownerDocument ?? (root as Document)
  const w = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: n => n.nodeType === 1 && (SKIP.has((n as Element).tagName.toUpperCase()) || (n as Element).hasAttribute(TR_ATTR))
      ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  })
  for (let n = w.nextNode(); n; n = w.nextNode()) if (n.nodeType === 3) onText(n as Text)
}

/** Innermost block elements that carry text, in document order. */
function leafBlocks(doc: Document) {
  const out: HTMLElement[] = []
  const seen = new Set<Element>()
  walk(doc.body, t => {
    if (!t.data.trim()) return
    let el = t.parentElement
    while (el && el !== doc.body && !BLOCK.has(el.tagName.toUpperCase())) el = el.parentElement
    if (!el || el === doc.body || seen.has(el)) return
    seen.add(el)
    out.push(el as HTMLElement)
  })
  return out
}

function ownText(el: Element) {
  let s = ''
  walk(el, t => { s += t.data })
  return s.replace(SHY, '').replace(/\s+/g, ' ').trim()
}

function ensureStyle(doc: Document, accent: string) {
  let st = doc.getElementById('bc-tr-style')
  if (!st) {
    st = doc.createElement('style')
    st.id = 'bc-tr-style'
    ;(doc.head ?? doc.documentElement).append(st)
  }
  const css = `span.bc-tr[${TR_ATTR}]{display:block;margin:.32em 0 .15em;padding:0 0 0 .7em;`
    + `border-left:2px solid color-mix(in srgb, ${accent} 50%, transparent);font-size:.86em;line-height:1.5;`
    + `font-weight:normal;font-style:normal;text-indent:0;text-align:start;letter-spacing:normal;text-transform:none;`
    + `opacity:.76;-webkit-user-select:none;user-select:none}`
    + `:is(h1,h2,h3,h4,h5,h6)>span.bc-tr[${TR_ATTR}]{font-size:.62em;margin-top:.4em}`
  if (st.textContent !== css) st.textContent = css
}

export function removeBilingual(doc: Document) {
  doc.querySelectorAll(`[${TR_ATTR}]`).forEach(e => e.remove())
  doc.documentElement.removeAttribute('data-bc-bilingual')
}

/**
 * Adds translations to every paragraph of `doc`, starting at `from` (the current page) and
 * wrapping around to the beginning of the section. Resolves when done, aborted or on an error.
 */
export async function applyBilingual(doc: Document, o: BilingualOptions, signal: AbortSignal,
  onProgress: (p: BilingualProgress) => void, from?: Node | null) {
  if (!doc.body) return
  ensureStyle(doc, o.accent)
  doc.querySelectorAll(`[${TR_ATTR}]:not([${TR_ATTR}="${o.to}"])`).forEach(e => e.remove())
  doc.documentElement.setAttribute('data-bc-bilingual', o.to)
  const target = o.to.slice(0, 2)
  let items = leafBlocks(doc)
    .filter(b => !b.querySelector(`:scope > [${TR_ATTR}]`))
    .map(b => ({ b, text: ownText(b) }))
    // nothing to do for paragraphs already in the target language (or without words)
    .filter(x => LETTERS.test(x.text) && x.text.length < 4500 && (detectLanguage(x.text) ?? '') !== target)
  if (from) {
    const i = items.findIndex(x => x.b.contains(from) || !!(from.compareDocumentPosition(x.b) & Node.DOCUMENT_POSITION_FOLLOWING))
    if (i > 0) items = [...items.slice(i), ...items.slice(0, i)]
  }
  const total = items.length
  let done = 0
  onProgress({ done, total })
  for (let k = 0; k < items.length; k += PER_REQUEST) {
    if (signal.aborted) return
    const chunk = items.slice(k, k + PER_REQUEST)
    const res = await bc.translate.batch({
      texts: chunk.map(x => x.text), to: o.to, provider: o.provider, model: o.model, folderId: o.folderId,
    })
    if (signal.aborted || !doc.defaultView) return
    res.results.forEach((tr, i) => {
      const { b, text } = chunk[i]
      if (!tr || tr === text || b.querySelector(`:scope > [${TR_ATTR}]`)) return
      const el = doc.createElement('span')
      el.className = 'bc-tr'
      el.setAttribute(TR_ATTR, o.to)
      el.setAttribute('lang', o.to)
      el.textContent = tr
      b.append(el)
    })
    done += chunk.length
    onProgress({ done: Math.min(done, total), total, error: res.error })
    if (res.error) return
  }
}
