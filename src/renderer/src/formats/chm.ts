import { bc } from '../api'
import type { BookMeta, FoliateBook, TocItem } from './types'
import { decodeText, sniffMarkupCharset, escapeHtml } from './encoding'
import { sanitizeDocument } from './sanitize'

interface SitemapEntry { name: string; local?: string; children: SitemapEntry[] }

/** Parses an HTML Help sitemap (.hhc) into a tree. */
function parseSitemap(html: string): SitemapEntry[] {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const walk = (ul: Element): SitemapEntry[] => {
    const out: SitemapEntry[] = []
    let last: SitemapEntry | null = null
    for (const child of Array.from(ul.children)) {
      const tag = child.localName
      if (tag === 'li' || tag === 'object') {
        const obj = tag === 'object' ? child : child.querySelector(':scope > object')
        if (obj) {
          const params = new Map(Array.from(obj.querySelectorAll('param')).map(p =>
            [p.getAttribute('name')?.toLowerCase() ?? '', p.getAttribute('value') ?? '']))
          last = { name: params.get('name') ?? '', local: params.get('local') || undefined, children: [] }
          out.push(last)
        }
        // some writers nest <ul> inside <li>
        const nested = child.querySelector(':scope > ul')
        if (nested && last) last.children.push(...walk(nested))
      } else if (tag === 'ul' && last) last.children.push(...walk(child))
    }
    return out
  }
  const root = doc.querySelector('ul')
  return root ? walk(root) : []
}

const normPath = (p: string) => p.replace(/\\/g, '/').replace(/^\.?\//, '').replace(/^\/+/, '').toLowerCase()

export async function openChm(bookId: string, fallbackTitle: string): Promise<{ book: FoliateBook; meta: BookMeta }> {
  const listing = await bc.book.extract(bookId)
  const files = listing.files
  const byLower = new Map(files.map(f => [f.path.toLowerCase(), f.path]))
  const fetchBytes = async (path: string) => new Uint8Array(await (await fetch(listing.baseUrl + encodeURI(path))).arrayBuffer())

  const hhc = files.find(f => f.path.toLowerCase().endsWith('.hhc'))
  let tree: SitemapEntry[] = []
  if (hhc) {
    const bytes = await fetchBytes(hhc.path)
    tree = parseSitemap(decodeText(bytes, sniffMarkupCharset(bytes)).text)
  }

  // reading order: TOC order, then any other HTML pages
  const order: string[] = []
  const seen = new Set<string>()
  const addPage = (local?: string) => {
    if (!local) return
    const path = normPath(local.split('#')[0])
    const real = byLower.get(path)
    if (real && !seen.has(path)) { seen.add(path); order.push(real) }
  }
  const visit = (items: SitemapEntry[]) => { for (const it of items) { addPage(it.local); visit(it.children) } }
  visit(tree)
  if (!order.length) {
    for (const f of files) if (/\.html?$/i.test(f.path) && !f.path.startsWith('#') && !f.path.startsWith('$')) addPage(f.path)
  }
  if (!order.length) throw new Error('CHM has no pages')

  const indexOf = new Map(order.map((p, i) => [p.toLowerCase(), i]))
  const toc: TocItem[] = []
  const toToc = (items: SitemapEntry[]): TocItem[] => items.map(it => {
    const [path, frag] = (it.local ?? '').split('#')
    const idx = path ? indexOf.get(normPath(path)) : undefined
    return {
      label: it.name,
      href: idx != null ? `${idx}${frag ? '#' + frag : ''}` : '',
      subitems: it.children.length ? toToc(it.children) : null,
    }
  })
  toc.push(...toToc(tree))

  const resolveLink = (href: string, fromPath: string) => {
    if (/^[a-z]+:/i.test(href) && !href.startsWith('bc:')) return null
    let target = href
    if (href.startsWith(listing.baseUrl)) target = href.slice(listing.baseUrl.length)
    const [p, frag] = target.split('#')
    const dir = fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/') + 1) : ''
    const abs = p ? normPath(new URL(p, 'http://x/' + dir).pathname.slice(1)) : normPath(fromPath)
    const idx = indexOf.get(decodeURIComponent(abs))
    return idx != null ? { index: idx, id: frag } : null
  }

  const docCache = new Map<number, string>()
  const buildDoc = async (i: number) => {
    if (docCache.has(i)) return docCache.get(i)!
    const path = order[i]
    const bytes = await fetchBytes(path)
    const { text } = decodeText(bytes, sniffMarkupCharset(bytes))
    const doc = new DOMParser().parseFromString(text, 'text/html')
    sanitizeDocument(doc)
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : ''
    const base = doc.createElement('base')
    base.href = listing.baseUrl + encodeURI(dir)
    doc.head.prepend(base)
    // links to other pages become "index#id" hrefs understood by the book
    for (const a of Array.from(doc.querySelectorAll('a[href]'))) {
      const r = resolveLink(a.getAttribute('href')!, path)
      if (r) a.setAttribute('href', `${r.index}${r.id ? '#' + r.id : ''}`)
    }
    const str = '<!DOCTYPE html>' + doc.documentElement.outerHTML
    docCache.set(i, str)
    return str
  }

  const sizes = order.map(p => files.find(f => f.path === p)?.size ?? 1000)
  const urls = new Map<number, string>()
  const sections = order.map((_p, i) => ({
    id: i,
    load: async () => {
      if (!urls.has(i)) urls.set(i, URL.createObjectURL(new Blob([await buildDoc(i)], { type: 'text/html' })))
      return urls.get(i)!
    },
    unload: () => {
      const u = urls.get(i)
      if (u) URL.revokeObjectURL(u)
      urls.delete(i)
    },
    createDocument: async () => new DOMParser().parseFromString(await buildDoc(i), 'text/html'),
    size: Math.max(200, sizes[i] * 0.5),
    linear: 'yes',
  }))

  const title = tree[0]?.name && tree.length === 1 ? tree[0].name : fallbackTitle
  const meta: BookMeta = { title, language: undefined }
  const book: FoliateBook = {
    metadata: { title, author: [] },
    sections,
    toc,
    dir: 'ltr',
    getCover: () => null,
    resolveHref: (href: string) => {
      if (/^\d+(#.*)?$/.test(href)) {
        const [a, id] = href.split('#')
        return { index: Number(a), anchor: (d: Document) => (id ? d.getElementById(id) ?? d.querySelector(`[name="${CSS.escape(id)}"]`) : null) }
      }
      return null
    },
    splitTOCHref: (href: string) => {
      const [a, b] = String(href).split('#')
      return [Number(a), b ?? null]
    },
    getTOCFragment: (doc: Document, id: string) => doc.getElementById(id) ?? doc.querySelector(`[name="${CSS.escape(id)}"]`),
    isExternal: (uri: string) => /^(https?|mailto|ftp):/i.test(uri),
    destroy: () => sections.forEach(s => s.unload()),
  }
  void escapeHtml
  return { book, meta }
}
