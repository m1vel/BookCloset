import type { BookMeta, FoliateBook, TocItem } from './types'
import { escapeHtml } from './encoding'
import { sanitizeDocument } from './sanitize'

export interface Chapter {
  title: string
  /** inner HTML of the chapter body */
  html: string
}

export type BookStyle = 'fiction' | 'document'

export interface HtmlBookOptions {
  chapters: Chapter[]
  meta: BookMeta
  style?: BookStyle
  css?: string
  baseHref?: string
  cover?: () => Promise<Blob | null>
  /** resolves links that are not `#id` or `index#id` (e.g. relative file links in CHM) */
  resolveLink?: (href: string, fromIndex: number) => { index: number; id?: string } | null
  toc?: TocItem[]
}

const FICTION_CSS = `
body { margin: 0; }
p { margin: 0; text-indent: 1.5em; }
p.noindent, p.center, h1 + p, h2 + p, h3 + p, h4 + p, hr + p, blockquote + p, figure + p, .bc-title + p, p:first-child { text-indent: 0; }
p.center { text-align: center; }
p.empty { height: 1em; }
.bc-title, h1, h2, h3 { text-align: center; font-weight: 600; line-height: 1.25; text-indent: 0; hyphens: none; break-after: avoid; }
h1 { font-size: 1.55em; margin: 2em 0 1.2em; }
h2 { font-size: 1.3em; margin: 1.8em 0 1em; }
h3 { font-size: 1.12em; margin: 1.4em 0 .8em; }
h4, h5, h6 { font-size: 1em; margin: 1.2em 0 .6em; text-align: center; }
blockquote { margin: 1em 0 1em 2em; font-style: italic; }
blockquote p { text-indent: 0; }
.poem { margin: 1em 0 1em 2em; white-space: pre-line; text-indent: 0; }
hr.scene { border: 0; height: auto; margin: 1.2em 0; text-align: center; }
hr.scene::after { content: '*\\2003*\\2003*'; }
img { max-width: 100%; height: auto; }
figure { margin: 1em 0; text-align: center; }
figure img, p > img:only-child { display: block; margin: 0 auto; }
figcaption { font-size: .88em; font-style: italic; opacity: .75; margin-top: .4em; }
pre, code, kbd { font-family: Consolas, 'Cascadia Mono', monospace; font-size: .88em; }
pre { white-space: pre-wrap; text-indent: 0; }
table { border-collapse: collapse; margin: 1em auto; max-width: 100%; }
td, th { border: 1px solid color-mix(in srgb, currentColor 25%, transparent); padding: .3em .6em; vertical-align: top; }
sup.fn { font-size: .7em; line-height: 0; }
`

const DOCUMENT_CSS = FICTION_CSS + `
p { text-indent: 0; margin: 0 0 .75em; }
h1, h2, h3, h4, .bc-title { text-align: start; }
blockquote { font-style: normal; padding-left: 1em; border-left: 3px solid color-mix(in srgb, currentColor 25%, transparent); margin-left: 0; }
pre { padding: .8em 1em; border-radius: 6px; background: color-mix(in srgb, currentColor 7%, transparent); }
code { padding: .1em .3em; border-radius: 4px; background: color-mix(in srgb, currentColor 7%, transparent); }
pre code { padding: 0; background: none; }
ul, ol { padding-left: 1.6em; }
li { margin: .25em 0; }
`

const MAX_SECTION_CHARS = 60_000
const TARGET_SECTION_CHARS = 36_000

const textLength = (html: string) => html.replace(/<[^>]+>/g, '').length

/** Splits an overly long chapter into several sections on top-level block boundaries. */
function splitLongHtml(html: string): string[] {
  if (textLength(html) <= MAX_SECTION_CHARS) return [html]
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  let container: Element = doc.body
  // descend through single wrappers
  while (container.children.length === 1 && container.firstElementChild!.children.length > 1) container = container.firstElementChild!
  const parts: string[] = []
  let cur = ''
  let curLen = 0
  for (const node of Array.from(container.childNodes)) {
    const s = node.nodeType === 1 ? (node as Element).outerHTML : escapeHtml(node.textContent ?? '')
    const len = node.textContent?.length ?? 0
    if (curLen + len > TARGET_SECTION_CHARS && curLen > 0) {
      parts.push(cur)
      cur = ''
      curLen = 0
    }
    cur += s
    curLen += len
  }
  if (cur) parts.push(cur)
  return parts
}

/**
 * Builds a foliate-js compatible book from HTML chapters.
 * Every chapter becomes one or more sections (blob URLs created on demand).
 */
export function makeHtmlBook(opts: HtmlBookOptions): FoliateBook {
  const lang = opts.meta.language || ''
  const css = (opts.style === 'document' ? DOCUMENT_CSS : FICTION_CSS) + (opts.css ?? '')
  const base = opts.baseHref ? `<base href="${escapeHtml(opts.baseHref)}">` : ''
  const idMap = new Map<string, number>()
  const sections: any[] = []
  const toc: TocItem[] = []
  let headingSeq = 0

  opts.chapters.forEach((ch, chIndex) => {
    const parts = splitLongHtml(ch.html)
    const firstIndex = sections.length
    const subitems: TocItem[] = []
    parts.forEach((part, pi) => {
      const index = sections.length
      const doc = new DOMParser().parseFromString(`<!DOCTYPE html><html><head></head><body>${part}</body></html>`, 'text/html')
      sanitizeDocument(doc)
      // ids for sub-headings so the TOC can point at them
      for (const h of Array.from(doc.body.querySelectorAll('h1, h2, h3'))) {
        if (!h.id) h.id = `bc-h${++headingSeq}`
        const label = h.textContent?.replace(/\s+/g, ' ').trim()
        const isChapterTitle = pi === 0 && h === doc.body.querySelector('h1, h2, h3') && label === ch.title.trim()
        if (label && !isChapterTitle && (opts.chapters.length === 1 || h.localName !== 'h1'))
          subitems.push({ label, href: `${index}#${h.id}` })
      }
      for (const el of Array.from(doc.querySelectorAll('[id]'))) if (!idMap.has(el.id)) idMap.set(el.id, index)
      for (const el of Array.from(doc.querySelectorAll('a[name]'))) {
        const n = el.getAttribute('name')!
        if (!idMap.has(n)) idMap.set(n, index)
      }
      const body = doc.body.innerHTML
      const str = `<!DOCTYPE html><html lang="${escapeHtml(lang)}"><head><meta charset="utf-8"><title>${escapeHtml(ch.title)}</title>${base}<style>${css}</style></head><body>${body}</body></html>`
      let url: string | null = null
      sections.push({
        id: index,
        load: () => {
          if (!url) url = URL.createObjectURL(new Blob([str], { type: 'text/html' }))
          return url
        },
        unload: () => {
          if (url) URL.revokeObjectURL(url)
          url = null
        },
        createDocument: () => new DOMParser().parseFromString(str, 'text/html'),
        size: Math.max(1, doc.body.textContent?.length ?? 1),
        linear: 'yes',
        resolveHref: (href: string) => href,
        chapterIndex: chIndex,
      })
    })
    if (!opts.toc) {
      toc.push({ label: ch.title || `${chIndex + 1}`, href: `${firstIndex}`, subitems: subitems.length ? subitems : null })
    }
  })

  const resolveHref = (href: string) => {
    if (/^\d+(#.*)?$/.test(href)) {
      const [a, id] = href.split('#')
      const index = Number(a)
      return { index, anchor: (doc: Document) => (id ? doc.getElementById(id) ?? doc.querySelector(`[name="${CSS.escape(id)}"]`) : null) }
    }
    if (href.startsWith('#')) {
      const id = decodeURIComponent(href.slice(1))
      const index = idMap.get(id)
      if (index == null) return null
      return { index, anchor: (doc: Document) => doc.getElementById(id) ?? doc.querySelector(`[name="${CSS.escape(id)}"]`) }
    }
    const r = opts.resolveLink?.(href, 0)
    if (r) return { index: r.index, anchor: (doc: Document) => (r.id ? doc.getElementById(r.id) : null) }
    return null
  }

  return {
    metadata: {
      title: opts.meta.title ?? '',
      author: (opts.meta.authors ?? []).map(name => ({ name })),
      language: lang,
      description: opts.meta.description,
      publisher: opts.meta.publisher,
      published: opts.meta.published,
    },
    sections,
    toc: opts.toc ?? toc,
    dir: opts.meta.rtl ? 'rtl' : 'ltr',
    getCover: opts.cover ?? (() => null),
    resolveHref,
    splitTOCHref: (href: string) => {
      if (typeof href !== 'string') return [Number(href), null]
      const [a, b] = href.split('#')
      return [Number(a), b ?? null]
    },
    getTOCFragment: (doc: Document, id: string) => doc.getElementById(id),
    isExternal: (uri: string) => /^(https?|mailto|ftp):/i.test(uri),
    destroy: () => sections.forEach(s => s.unload()),
  }
}

// ---------------------------------------------------------------- HTML → chapters
const HEADING = /^h[1-3]$/

/**
 * Splits an HTML document body into chapters at its main heading level.
 * Content before the first heading becomes a preface chapter.
 */
export function htmlToChapters(body: HTMLElement, fallbackTitle: string): Chapter[] {
  // pick the heading level that occurs at least twice, preferring the highest
  const counts = [1, 2, 3].map(l => body.querySelectorAll(`h${l}`).length)
  let level = counts.findIndex(c => c >= 2) + 1
  if (level === 0) level = counts.findIndex(c => c >= 1) + 1
  if (level === 0) return [{ title: fallbackTitle, html: body.innerHTML }]
  const tag = `h${level}`
  // find the container holding most of these headings as direct children
  const headings = Array.from(body.querySelectorAll(tag))
  const parents = new Map<Element, number>()
  for (const h of headings) parents.set(h.parentElement!, (parents.get(h.parentElement!) ?? 0) + 1)
  let container: Element = body
  let best = 0
  for (const [p, n] of parents) if (n > best) { best = n; container = p }
  // content outside the container (before/after it at body level) goes to the first/last chapter
  let before = '', after = ''
  if (container !== body) {
    let top: Element = container
    while (top.parentElement && top.parentElement !== body) top = top.parentElement
    let seen = false
    for (const node of Array.from(body.childNodes)) {
      if (node === top) { seen = true; continue }
      const s = node.nodeType === 1 ? (node as Element).outerHTML : escapeHtml(node.textContent ?? '')
      if (seen) after += s
      else before += s
    }
  }
  const chapters: Chapter[] = []
  let cur: { title: string; html: string } | null = null
  let preface = before
  for (const node of Array.from(container.childNodes)) {
    const isHeading = node.nodeType === 1 && (node as Element).localName === tag
    const html = node.nodeType === 1 ? (node as Element).outerHTML : node.nodeType === 3 ? escapeHtml(node.textContent ?? '') : ''
    if (isHeading) {
      if (cur) chapters.push(cur)
      cur = { title: (node.textContent ?? '').replace(/\s+/g, ' ').trim(), html }
    } else if (cur) cur.html += html
    else preface += html
  }
  if (cur) {
    cur.html += after
    chapters.push(cur)
  }
  if (preface.replace(/<[^>]+>/g, '').trim() || /<img/i.test(preface)) chapters.unshift({ title: fallbackTitle, html: preface })
  return chapters.length ? chapters : [{ title: fallbackTitle, html: body.innerHTML }]
}

export const isHeadingTag = (name: string) => HEADING.test(name)
