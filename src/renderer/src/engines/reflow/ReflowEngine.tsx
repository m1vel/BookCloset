import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import type { Annotation, ReaderPrefs } from '../../../../shared/types'
import type { BookMeta, FoliateBook, TocItem } from '../../formats/types'
import type { EngineController, EngineEvents, SearchHit } from '../types'
import { HIGHLIGHT_COLORS } from '../types'
import type { PageThemeDef } from '../page-themes'
import { bookCss } from './book-css'
import { hyphenateDocument, loadHyphenator, sniffLang, type Hyphenator } from './hyphenate'
import { sanitizeHtml } from '../../formats/sanitize'
import '../../vendor/foliate-js/view.js'
import { Overlayer } from '../../vendor/foliate-js/overlayer.js'
import * as CFI from '../../vendor/foliate-js/epubcfi.js'

interface Props {
  book: FoliateBook
  meta: BookMeta
  prefs: ReaderPrefs
  theme: PageThemeDef
  accent: string
  initialLocation?: string | number | null
  initialFraction?: number
  annotations: Annotation[]
  events: EngineEvents
}

const EPUB_NS = 'http://www.idpf.org/2007/ops'

function isFootnoteLink(a: HTMLAnchorElement) {
  const type = `${a.getAttributeNS(EPUB_NS, 'type') ?? ''} ${a.getAttribute('epub:type') ?? ''} ${a.getAttribute('type') ?? ''}`
  const role = a.getAttribute('role') ?? ''
  if (/noteref|note|footnote|endnote/.test(type) || /doc-noteref|doc-footnote/.test(role)) return true
  if (/backlink/.test(type) || /doc-backlink/.test(role)) return false
  const href = a.getAttribute('href') ?? ''
  const text = (a.textContent ?? '').trim()
  const supLike = !!a.closest('sup') || !!a.querySelector('sup')
    || ['super', 'top', 'text-top'].includes(getComputedStyle(a).verticalAlign)
  return href.includes('#') && (supLike || /^[[(]?\d{1,3}[\])]?$|^\*{1,3}$/.test(text))
}

const clean = (s: string | null | undefined) => (s ?? '').replace(/\u00AD/g, '').replace(/\s+/g, ' ').trim()

/** Text of the paragraph holding the selection, widened with neighbours when it is short. */
function selectionContext(range: Range): string {
  const node = range.commonAncestorContainer
  const el = (node.nodeType === 1 ? node : node.parentElement) as Element | null
  const block = el?.closest('p, li, blockquote, dd, td, h1, h2, h3, h4, pre') ?? el
  if (!block) return ''
  let text = clean(block.textContent)
  if (text.length < 320) {
    const prev = clean(block.previousElementSibling?.textContent)
    const next = clean(block.nextElementSibling?.textContent)
    text = [prev, text, next].filter(Boolean).join(String.fromCharCode(10))
  }
  return text.slice(0, 1500)
}

function extractNote(el: Element | null): string | null {
  if (!el) return null
  let block: Element = el
  const INLINE = /^(a|span|sup|sub|em|strong|i|b|small|big)$/i
  while (INLINE.test(block.localName) && block.parentElement && block.parentElement.localName !== 'body') block = block.parentElement
  if (INLINE.test(block.localName) && el.nextElementSibling) block = el.nextElementSibling
  // FB2 notes: <section id><h1>N</h1><p>…</p></section> → drop the number title
  const clone = block.cloneNode(true) as Element
  clone.querySelectorAll('.title, header').forEach(t => t.remove())
  clone.querySelectorAll('a[href]').forEach(a => {
    const t = (a.textContent ?? '').trim()
    if (/^(↩|↑|\^|back|назад|←)/i.test(t)) a.remove()
  })
  const html = clone.innerHTML.trim()
  return html ? sanitizeHtml(html) : null
}

export const ReflowEngine = forwardRef<EngineController, Props>(function ReflowEngine(
  { book, meta, prefs, theme, accent, initialLocation, initialFraction, annotations, events }, ref,
) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<any>(null)
  const eventsRef = useRef(events)
  eventsRef.current = events
  const annRef = useRef<Annotation[]>(annotations)
  const drawn = useRef(new Map<string, Annotation>())
  const indexCache = useRef(new Map<string, number>())
  const hyRef = useRef<Hyphenator | null>(null)
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs
  const lastCfi = useRef<string | null>(null)
  const tocRef = useRef<TocItem[]>([])
  const annotationClicked = useRef(0)
  const accentRef = useRef(accent)
  accentRef.current = accent

  const annIndex = (cfi: string) => {
    if (indexCache.current.has(cfi)) return indexCache.current.get(cfi)!
    const idx = viewRef.current?.resolveNavigation(cfi)?.index ?? -1
    indexCache.current.set(cfi, idx)
    return idx
  }

  const applyLayout = (view: any) => {
    const r = view?.renderer
    if (!r) return
    const p = prefsRef.current
    if (view.isFixedLayout) return
    r.setAttribute('flow', p.flow)
    r.setAttribute('margin', `${p.margin}px`)
    r.setAttribute('gap', `${p.gap}%`)
    r.setAttribute('max-inline-size', `${p.maxWidth}px`)
    r.setAttribute('max-column-count', String(p.columns))
    r.setAttribute('max-block-size', '2400px')
    if (p.animated && p.flow === 'paginated') r.setAttribute('animated', '')
    else r.removeAttribute('animated')
    if (p.flow === 'paginated') view.setAttribute('autohide-cursor', '')
    else view.removeAttribute('autohide-cursor')
  }

  const applyStyles = (view: any) => {
    view?.renderer?.setStyles?.(bookCss(prefsRef.current, theme, accent))
  }

  const updateMarginals = (view: any, detail: any) => {
    const r = view.renderer
    if (!r?.heads || prefsRef.current.flow !== 'paginated') return
    const chapter = detail.tocItem?.label ?? ''
    const title = meta.title ?? ''
    const heads: HTMLElement[] = r.heads
    const feet: HTMLElement[] = r.feet
    if (heads.length > 1) {
      heads[0].textContent = title
      heads[heads.length - 1].textContent = chapter
    } else if (heads[0]) heads[0].textContent = chapter || title
    const loc = detail.location
    if (loc && feet.length) {
      const pageLabel = `${loc.current + 1} / ${loc.total}`
      const pct = `${Math.round((detail.fraction ?? 0) * 100)}%`
      if (feet.length > 1) {
        feet[0].textContent = pageLabel
        feet[feet.length - 1].textContent = pct
      } else feet[0].textContent = `${pageLabel} · ${pct}`
    }
  }

  // open / re-open when the book or hyphenation changes
  useEffect(() => {
    let disposed = false
    const host = hostRef.current!
    const view = document.createElement('foliate-view') as any
    view.className = 'foliate'
    viewRef.current = view
    drawn.current.clear()
    indexCache.current.clear()

    const onRelocate = (e: any) => {
      const d = e.detail
      // during the first layout pass (zero-size container) foliate may report Infinity/NaN
      if (!Number.isFinite(d.fraction) || d.fraction < 0 || d.fraction > 1.0001) return
      lastCfi.current = d.cfi
      updateMarginals(view, d)
      const loc = d.location
      eventsRef.current.onRelocate({
        fraction: d.fraction ?? 0,
        page: loc ? loc.current + 1 : undefined,
        pages: loc?.total,
        chapter: d.tocItem?.label,
        location: d.cfi,
        chapterTimeLeft: d.time ? d.time.section * 60 : undefined,
        bookTimeLeft: d.time ? d.time.total * 60 : undefined,
        atEnd: (d.fraction ?? 0) > 0.995,
      })
    }

    const onLoad = (e: any) => {
      const { doc, index } = e.detail as { doc: Document; index: number }
      if (prefsRef.current.hyphenate && hyRef.current) {
        try { hyphenateDocument(doc, hyRef.current) } catch (err) { console.warn('hyphenation failed', err) }
      }
      const frame = () => (doc.defaultView?.frameElement as HTMLElement | null)?.getBoundingClientRect() ?? new DOMRect()
      const toApp = (r: DOMRect) => {
        const f = frame()
        return new DOMRect(r.left + f.left, r.top + f.top, r.width, r.height)
      }
      const checkSelection = () => {
        const sel = doc.getSelection()
        if (!sel || sel.isCollapsed || !sel.rangeCount) return eventsRef.current.onSelection(null)
        const text = sel.toString().replace(/\u00AD/g, '').trim()
        if (!text) return eventsRef.current.onSelection(null)
        const range = sel.getRangeAt(0)
        let cfi: string | undefined
        try { cfi = view.getCFI(index, range) } catch { /* ignore */ }
        const rects = Array.from(range.getClientRects()).filter(r => r.width > 0)
        const vw = frame()
        // keep only rects within the visible part of the iframe
        const host = hostRef.current!.getBoundingClientRect()
        const visible = rects.map(toApp).filter(r => r.right > host.left && r.left < host.right)
        const first = visible[0] ?? toApp(range.getBoundingClientRect())
        const last = visible[visible.length - 1] ?? first
        const top = Math.min(first.top, last.top)
        const bottom = Math.max(first.bottom, last.bottom)
        const left = Math.min(...visible.map(r => r.left), first.left)
        const right = Math.max(...visible.map(r => r.right), last.right)
        void vw
        eventsRef.current.onSelection({
          text, cfi, rect: new DOMRect(left, top, right - left, bottom - top),
          chapter: view.lastLocation?.tocItem?.label,
          context: selectionContext(range),
        })
      }
      doc.addEventListener('pointerup', () => setTimeout(checkSelection, 20))
      doc.addEventListener('keyup', e => { if (e.shiftKey || e.key === 'Shift') checkSelection() })
      doc.addEventListener('selectionchange', () => {
        const sel = doc.getSelection()
        if (!sel || sel.isCollapsed) eventsRef.current.onSelection(null)
      })
      doc.addEventListener('keydown', e => eventsRef.current.onKey(e))
      doc.addEventListener('pointermove', e => {
        const f = frame()
        eventsRef.current.onActivity()
        window.dispatchEvent(new CustomEvent('reader-pointer', { detail: { x: e.clientX + f.left, y: e.clientY + f.top } }))
      })
      doc.addEventListener('click', e => {
        if (e.detail > 1 || e.button !== 0) return
        if ((e.target as Element)?.closest?.('a[href]')) return
        const sel = doc.getSelection()
        if (sel && !sel.isCollapsed) return
        const x = e.clientX + frame().left
        const stamp = Date.now()
        setTimeout(() => {
          if (annotationClicked.current >= stamp - 5) return
          const r = hostRef.current!.getBoundingClientRect()
          const rel = (x - r.left) / r.width
          eventsRef.current.onTap(rel < 0.28 ? 'left' : rel > 0.72 ? 'right' : 'center')
        }, 0)
      })
      let wheelLock = 0
      doc.addEventListener('wheel', e => {
        eventsRef.current.onActivity()
        if (e.ctrlKey) return
        const now = Date.now()
        if (prefsRef.current.flow !== 'paginated') {
          // scrolled mode shows one section at a time: continue into the next/previous one at the edges
          const r = view.renderer
          if (now < wheelLock || !r) return
          if (e.deltaY > 0 && r.viewSize - r.end <= 4) { wheelLock = now + 700; view.next() }
          else if (e.deltaY < 0 && r.start <= 2) { wheelLock = now + 700; view.prev() }
          return
        }
        e.preventDefault()
        if (now < wheelLock) return
        const d = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX
        if (Math.abs(d) < 4) return
        wheelLock = now + 380
        d > 0 ? view.next() : view.prev()
      }, { passive: false })
    }

    const onCreateOverlay = (e: any) => {
      const { index } = e.detail
      for (const a of annRef.current) {
        if (a.cfi && a.kind !== 'bookmark' && annIndex(a.cfi) === index) {
          view.addAnnotation({ value: a.cfi, color: a.color, style: a.style, kind: a.kind })
          drawn.current.set(a.cfi, a)
        }
      }
    }
    const onDraw = (e: any) => {
      const { draw, annotation } = e.detail
      const color = HIGHLIGHT_COLORS[annotation.color as keyof typeof HIGHLIGHT_COLORS] ?? HIGHLIGHT_COLORS.yellow
      if (annotation.style === 'underline') draw(Overlayer.underline, { color, width: 2 })
      else if (annotation.style === 'squiggly') draw(Overlayer.squiggly, { color, width: 2 })
      else draw(Overlayer.highlight, { color })
    }
    const onShowAnnotation = (e: any) => {
      const { value, range } = e.detail
      annotationClicked.current = Date.now()
      const a = annRef.current.find(x => x.cfi === value)
      if (!a) return
      const doc = range.startContainer?.ownerDocument as Document | undefined
      const f = (doc?.defaultView?.frameElement as HTMLElement | null)?.getBoundingClientRect() ?? new DOMRect()
      const r = range.getBoundingClientRect()
      eventsRef.current.onAnnotationClick(a.id, new DOMRect(r.left + f.left, r.top + f.top, r.width, r.height))
    }
    const onLink = (e: any) => {
      const { a, href } = e.detail
      if (!isFootnoteLink(a)) return
      e.preventDefault()
      ;(async () => {
        try {
          const target = await Promise.resolve(book.resolveHref(href))
          if (!target) return
          const doc = await book.sections[target.index].createDocument()
          const el = target.anchor?.(doc)
          const html = extractNote(el && el.nodeType ? el : null)
          const f = (a.ownerDocument.defaultView?.frameElement as HTMLElement | null)?.getBoundingClientRect() ?? new DOMRect()
          const r = a.getBoundingClientRect()
          if (html) eventsRef.current.onFootnote?.(html, new DOMRect(r.left + f.left, r.top + f.top, r.width, r.height))
          else view.goTo(href)
        } catch {
          view.goTo(href)
        }
      })()
    }

    view.addEventListener('relocate', onRelocate)
    view.addEventListener('load', onLoad)
    view.addEventListener('create-overlay', onCreateOverlay)
    view.addEventListener('draw-annotation', onDraw)
    view.addEventListener('show-annotation', onShowAnnotation)
    view.addEventListener('link', onLink)
    host.append(view)

    ;(async () => {
      try {
        const lang = meta.language || sniffLang(await sampleText(book))
        hyRef.current = await loadHyphenator(lang)
        if (disposed) return
        await view.open(book)
        if (disposed) return
        applyLayout(view)
        applyStyles(view)
        const toc = (book.toc ?? []) as TocItem[]
        tocRef.current = toc
        eventsRef.current.onReady({ toc, sectionFractions: view.getSectionFractions?.() })
        const loc = lastCfi.current ?? initialLocation
        if (typeof loc === 'string' && loc.startsWith('epubcfi')) await view.init({ lastLocation: loc })
        else if (initialFraction && initialFraction > 0) await view.goToFraction(initialFraction)
        else await view.init({ showTextStart: false })
      } catch (err) {
        if (!disposed) eventsRef.current.onError(err)
      }
    })()

    return () => {
      disposed = true
      try { view.close() } catch { /* ignore */ }
      view.remove()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book, prefs.hyphenate])

  // layout & style updates
  useEffect(() => { applyLayout(viewRef.current) }, [prefs.flow, prefs.margin, prefs.gap, prefs.maxWidth, prefs.columns, prefs.animated])
  // re-style only when a reading preference actually changed (the settings object is cloned on every update)
  const styleKey = JSON.stringify(prefs)
  useEffect(() => { applyStyles(viewRef.current) }, [styleKey, theme, accent])

  // annotations diff
  useEffect(() => {
    annRef.current = annotations
    const view = viewRef.current
    if (!view?.renderer) return
    const wanted = new Map(annotations.filter(a => a.cfi && a.kind !== 'bookmark').map(a => [a.cfi!, a]))
    for (const [cfi, a] of drawn.current) {
      const w = wanted.get(cfi)
      if (!w || w.color !== a.color || w.style !== a.style) {
        view.deleteAnnotation({ value: cfi })
        drawn.current.delete(cfi)
      }
    }
    for (const [cfi, a] of wanted) {
      if (drawn.current.has(cfi)) continue
      view.addAnnotation({ value: cfi, color: a.color, style: a.style, kind: a.kind })
      drawn.current.set(cfi, a)
    }
  }, [annotations])

  useImperativeHandle(ref, (): EngineController => ({
    next: () => viewRef.current?.next(),
    prev: () => viewRef.current?.prev(),
    goTo: async target => { await viewRef.current?.goTo(target) },
    goToFraction: async f => { await viewRef.current?.goToFraction(f) },
    async search(query, onHits, onProgress, signal) {
      const view = viewRef.current
      if (!view) return
      let n = 0
      for await (const r of view.search({ query, matchCase: false, matchDiacritics: false, matchWholeWords: false, draw: Overlayer.outline, drawOptions: { color: accentRef.current, width: 2, radius: 4 } })) {
        if (signal.aborted) break
        if (r === 'done') break
        if (r.progress != null) onProgress(r.progress)
        if (r.subitems) {
          onHits(r.subitems.map((s: any) => ({
            id: `s${n++}`, target: s.cfi, section: r.label,
            excerpt: { pre: s.excerpt.pre.replace(/\u00AD/g, ''), match: s.excerpt.match.replace(/\u00AD/g, ''), post: s.excerpt.post.replace(/\u00AD/g, '') },
          } as SearchHit)))
        }
      }
    },
    clearSearch: () => viewRef.current?.clearSearch(),
    showSearchHit: hit => { viewRef.current?.goTo(hit.target) },
    setAnnotations: () => { /* handled by prop diffing */ },
    clearSelection: () => viewRef.current?.deselect?.(),
    bookmarkLocation() {
      const view = viewRef.current
      const loc = view?.lastLocation
      if (!loc?.cfi) return null
      const text = loc.range?.toString?.().replace(/\u00AD/g, '').replace(/\s+/g, ' ').trim().slice(0, 140)
      return { cfi: CFI.collapse(loc.cfi), text }
    },
    isBookmarked(list) {
      const cfi = viewRef.current?.lastLocation?.cfi
      if (!cfi) return null
      const start = CFI.collapse(cfi)
      const end = CFI.collapse(cfi, true)
      return list.find(a => a.kind === 'bookmark' && a.cfi
        && CFI.compare(a.cfi, start) >= 0 && CFI.compare(a.cfi, end) <= 0) ?? null
    },
    focus: () => { try { viewRef.current?.renderer?.focusView?.() } catch { /* ignore */ } },
  }), [])

  return <div ref={hostRef} className="reflow-host" />
})

async function sampleText(book: FoliateBook): Promise<string> {
  try {
    const sec = book.sections.find((s: any) => s.linear !== 'no' && s.size > 2000) ?? book.sections[0]
    const doc = await sec?.createDocument?.()
    return doc?.body?.textContent?.slice(0, 4000) ?? ''
  } catch {
    return ''
  }
}
