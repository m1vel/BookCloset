/**
 * Splits rendered text into sentences for read-aloud. Each sentence keeps a DOM Range (for
 * highlighting and scrolling) and can map a word inside the spoken text back to a Range.
 * Works on book documents (block elements) and on PDF/DjVu text layers (spans + <br>).
 */

export interface Sentence {
  text: string
  range: Range
  /** Range of `len` characters starting at `index` of `text` (speech boundary events). */
  sub(index: number, len: number): Range | null
}

const BLOCK = new Set([
  'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'DD', 'DT', 'TD', 'TH', 'PRE',
  'FIGCAPTION', 'CAPTION', 'DIV', 'SECTION', 'ARTICLE', 'ASIDE', 'HEADER', 'FOOTER', 'TR', 'BODY',
  'POEM', 'STANZA', 'V', 'EPIGRAPH', 'CITE', 'TITLE',
])
const SKIP = new Set(['SCRIPT', 'STYLE', 'RT', 'RP', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'MATH', 'HEAD'])
// soft hyphen (our hyphenation), zero-width space/joiners, BOM
const INVISIBLE = new RegExp('[' + String.fromCharCode(0xad, 0x200b, 0x200c, 0x200d, 0x2060, 0xfeff) + ']')
const HAS_WORD = /[\p{L}\p{N}]/u
const MAX_SENTENCE = 420

function blockOf(node: Node, root: Node): Node {
  let el = node.parentNode
  while (el && el !== root) {
    if (el.nodeType === 1 && BLOCK.has((el as Element).tagName.toUpperCase())) return el
    el = el.parentNode
  }
  return root
}

/** Long sentences are split at clause punctuation so highlighting and pausing stay fine-grained. */
function splitLong(start: number, end: number, text: string): [number, number][] {
  if (end - start <= MAX_SENTENCE) return [[start, end]]
  const out: [number, number][] = []
  let s = start
  while (end - s > MAX_SENTENCE) {
    const chunk = text.slice(s, s + MAX_SENTENCE)
    const m = [...chunk.matchAll(/[;:,—–]\s/g)].pop()
    const cut = m && m.index! > 80 ? s + m.index! + 1 : s + MAX_SENTENCE
    out.push([s, cut])
    s = cut
  }
  out.push([s, end])
  return out
}

export function sentencesIn(root: Node, lang: string, from?: { node: Node; offset: number } | null): Sentence[] {
  const doc = root.ownerDocument ?? (root as Document)
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: n => (n.nodeType === 1 && SKIP.has((n as Element).tagName.toUpperCase()) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  })
  let segmenter: Intl.Segmenter
  try { segmenter = new Intl.Segmenter(lang, { granularity: 'sentence' }) } catch { segmenter = new Intl.Segmenter('en', { granularity: 'sentence' }) }

  const out: Sentence[] = []
  // current block: cleaned text and, per cleaned char, its source text node + offset
  let text = ''
  let nodes: Text[] = []
  let offs: number[] = []
  let block: Node | null = null
  let pendingSpace = false
  // PDF/DjVu text layers: spans are positioned lines/runs; a jump to a new line is a word break
  const layer = root.nodeType === 1 && (root as Element).classList?.contains('textLayer')
  let lastSpan: Element | null = null
  let lastTop = 0

  const push = (ch: string, node: Text, off: number) => {
    text += ch
    nodes.push(node)
    offs.push(off)
  }
  const flush = () => {
    if (text.trim()) {
      for (const { index, segment } of segmenter.segment(text)) {
        const lead = segment.length - segment.trimStart().length
        const start = index + lead
        const end = index + segment.trimEnd().length
        if (end <= start || !HAS_WORD.test(segment)) continue
        for (const [a, b] of splitLong(start, end, text)) {
          const range = doc.createRange()
          range.setStart(nodes[a], offs[a])
          range.setEnd(nodes[b - 1], offs[b - 1] + 1)
          const ns = nodes, os = offs, base = a, limit = b
          out.push({
            text: text.slice(a, b),
            range,
            sub(i, len) {
              const s = base + i, e = Math.min(limit, s + Math.max(1, len))
              if (s >= limit) return null
              const r = doc.createRange()
              r.setStart(ns[s], os[s])
              r.setEnd(ns[e - 1], os[e - 1] + 1)
              return r
            },
          })
        }
      }
    }
    text = ''
    nodes = []
    offs = []
    pendingSpace = false
  }

  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === 1) {
      if ((n as Element).tagName.toUpperCase() === 'BR') pendingSpace = true
      continue
    }
    const t = n as Text
    const b = blockOf(t, root)
    if (b !== block) { flush(); block = b }
    if (layer && t.parentElement && t.parentElement !== lastSpan) {
      const r = t.parentElement.getBoundingClientRect()
      // new line: separate words unless the previous line ends with a hyphen
      if (lastSpan && Math.abs(r.top - lastTop) > r.height * 0.5 && !text.endsWith('-')) pendingSpace = true
      lastSpan = t.parentElement
      lastTop = r.top
    }
    const s = t.data
    for (let i = 0; i < s.length; i++) {
      const ch = s[i]
      if (INVISIBLE.test(ch)) continue
      if (/\s/.test(ch)) { pendingSpace = true; continue }
      if (pendingSpace && text && !text.endsWith(' ')) {
        // the space maps onto the previous character so ranges stay inside real text
        push(' ', nodes[nodes.length - 1], offs[offs.length - 1])
      }
      pendingSpace = false
      push(ch, t, i)
    }
  }
  flush()

  if (!from) return out
  // first sentence that is not entirely before the starting point
  const i = out.findIndex(s => {
    try { return s.range.comparePoint(from.node, from.offset) <= 0 } catch { return false }
  })
  return i < 0 ? [] : out.slice(i)
}

/** CSS Custom Highlight API: marks text without touching the DOM (CFIs stay valid). */
export function paintSpeech(doc: Document, sentence: Range | null, word: Range | null, color: string) {
  const win = doc.defaultView as (Window & typeof globalThis) | null
  if (!win || !('highlights' in win.CSS)) return
  if (!doc.getElementById('bc-tts-style')) {
    const st = doc.createElement('style')
    st.id = 'bc-tts-style'
    ;(doc.head ?? doc.documentElement).append(st)
  }
  const st = doc.getElementById('bc-tts-style')!
  const css = `::highlight(bc-tts){background-color:color-mix(in srgb, ${color} 20%, transparent)}`
    + `::highlight(bc-tts-word){background-color:color-mix(in srgb, ${color} 42%, transparent)}`
  if (st.textContent !== css) st.textContent = css
  const H = win.Highlight
  if (sentence) win.CSS.highlights.set('bc-tts', new H(sentence)); else win.CSS.highlights.delete('bc-tts')
  if (word) win.CSS.highlights.set('bc-tts-word', new H(word)); else win.CSS.highlights.delete('bc-tts-word')
}
