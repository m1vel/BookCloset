import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Annotation, PagedPrefs } from '../../../../shared/types'
import type { PagedDocument, TocItem } from '../../formats/types'
import type { EngineController, EngineEvents, SearchHit } from '../types'
import { sentencesIn, paintSpeech } from '../../speech/segment'
import { detectLanguage } from '../../translation'
import { HIGHLIGHT_COLORS } from '../types'
import type { PageThemeDef } from '../page-themes'

interface Props {
  doc: PagedDocument
  prefs: PagedPrefs
  theme: PageThemeDef
  initialPage: number
  annotations: Annotation[]
  events: EngineEvents
  setPrefs: (p: Partial<PagedPrefs>) => void
}

const PAD = 28
const GAP = 18

type Rect = { x: number; y: number; w: number; h: number }

function flattenToc(items: TocItem[], out: { label: string; page: number }[] = []) {
  for (const it of items) {
    if (typeof it.href === 'number') out.push({ label: it.label, page: it.href })
    if (it.subitems) flattenToc(it.subitems, out)
  }
  return out
}

/** Merge per-glyph rects into line rects (page-normalised). */
function mergeRects(rects: Rect[]): Rect[] {
  const sorted = [...rects].sort((a, b) => a.y - b.y || a.x - b.x)
  const out: Rect[] = []
  for (const r of sorted) {
    const last = out[out.length - 1]
    if (last && Math.abs(last.y - r.y) < r.h * 0.5 && r.x <= last.x + last.w + 0.02) {
      const x2 = Math.max(last.x + last.w, r.x + r.w)
      last.y = Math.min(last.y, r.y)
      last.h = Math.max(last.h, r.h)
      last.w = x2 - last.x
    } else out.push({ ...r })
  }
  return out
}

/** Finds `query` in a text layer and returns client rects of every match. */
function findInTextLayer(layer: Element, query: string): DOMRect[][] {
  const nodes: { node: Text; start: number }[] = []
  let text = ''
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.nodeValue ?? ''
    if (text && !/\s$/.test(text) && !/^\s/.test(t)) text += ' '
    nodes.push({ node: n as Text, start: text.length })
    text += t
  }
  const hay = text.toLocaleLowerCase().replace(/\s+/g, ' ')
  const needle = query.toLocaleLowerCase().replace(/\s+/g, ' ').trim()
  if (!needle) return []
  const locate = (pos: number, end: boolean) => {
    for (let i = nodes.length - 1; i >= 0; i--) {
      if (nodes[i].start <= pos || i === 0) {
        const len = nodes[i].node.length
        return { node: nodes[i].node, offset: Math.max(0, Math.min(len, pos - nodes[i].start + (end ? 0 : 0))) }
      }
    }
    return null
  }
  const out: DOMRect[][] = []
  let idx = hay.indexOf(needle)
  while (idx >= 0 && out.length < 200) {
    const a = locate(idx, false), b = locate(idx + needle.length, true)
    if (a && b) {
      const range = document.createRange()
      range.setStart(a.node, a.offset)
      range.setEnd(b.node, b.offset)
      out.push(Array.from(range.getClientRects()))
    }
    idx = hay.indexOf(needle, idx + needle.length)
  }
  return out
}

interface PageProps {
  doc: PagedDocument
  index: number
  width: number
  height: number
  top?: number
  left?: number
  highlights: Annotation[]
  search: { query: string; active: boolean } | null
  version: number
}

const PageView = memo(function PageView({ doc, index, width, height, top, left, highlights, search, version }: PageProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [rendered, setRendered] = useState(false)
  const [hits, setHits] = useState<Rect[]>([])

  useEffect(() => {
    const host = ref.current!
    const ctrl = new AbortController()
    const t = setTimeout(() => {
      doc.render(index, host, width, height, ctrl.signal)
        .then(() => { if (!ctrl.signal.aborted) setRendered(true) })
        .catch(e => console.warn('render failed', index, e))
    }, rendered ? 140 : 0)
    return () => { clearTimeout(t); ctrl.abort() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, index, Math.round(width), Math.round(height), version])

  // search matches inside the text layer
  useEffect(() => {
    if (!search?.query || !rendered) { setHits([]); return }
    const host = ref.current!
    const tryFind = () => {
      const layer = host.querySelector('.textLayer')
      if (!layer || !layer.childNodes.length) return false
      const hr = host.getBoundingClientRect()
      const rects = findInTextLayer(layer, search.query).flat()
        .map(r => ({ x: (r.left - hr.left) / hr.width, y: (r.top - hr.top) / hr.height, w: r.width / hr.width, h: r.height / hr.height }))
      setHits(mergeRects(rects))
      return true
    }
    if (!tryFind()) {
      const t = setTimeout(tryFind, 400)
      return () => clearTimeout(t)
    }
  }, [search?.query, rendered, width])

  return (
    <div
      ref={ref}
      className={`page ${rendered ? 'ready' : ''}`}
      data-page={index}
      style={{ width, height, top, left, position: top != null ? 'absolute' : 'relative' }}
    >
      {!rendered && <div className="page-placeholder"><span>{index + 1}</span></div>}
      <div className="hl-layer" aria-hidden="true">
        {highlights.flatMap(a => (a.rects ?? []).map((r, i) => (
          <div key={a.id + i} className={`hl ${a.style ?? 'highlight'}`} data-ann={a.id}
            style={{
              left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%`,
              '--hl': HIGHLIGHT_COLORS[a.color ?? 'yellow'],
            } as React.CSSProperties} />
        )))}
        {hits.map((r, i) => (
          <div key={'s' + i} className={`search-hit ${search?.active ? 'active' : ''}`}
            style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }} />
        ))}
      </div>
    </div>
  )
})

export const PagedEngine = forwardRef<EngineController, Props>(function PagedEngine(
  { doc, prefs, theme, initialPage, annotations, events, setPrefs }, ref,
) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [sizeVersion, setSizeVersion] = useState(0)
  const [page, setPage] = useState(Math.max(0, Math.min(initialPage, doc.numPages - 1)))
  const [scrollTop, setScrollTop] = useState(0)
  const [search, setSearch] = useState<{ query: string; page: number } | null>(null)
  const tocFlat = useRef<{ label: string; page: number }[]>([])
  const eventsRef = useRef(events)
  eventsRef.current = events
  const pageRef = useRef(page)
  pageRef.current = page
  const restored = useRef(false)
  const rtl = prefs.rtl

  useEffect(() => {
    doc.onSizeChange?.(() => setSizeVersion(v => v + 1))
    ;(async () => {
      const toc = await doc.getOutline().catch(() => [])
      tocFlat.current = flattenToc(toc).sort((a, b) => a.page - b.page)
      eventsRef.current.onReady({ toc })
    })()
  }, [doc])

  useLayoutEffect(() => {
    const el = scrollRef.current!
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setBox({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  const mode = prefs.mode
  const availW = Math.max(100, box.w - PAD * 2)
  const availH = Math.max(100, box.h - PAD * 2)

  // ---------- layout: scroll mode
  const scrollLayout = useMemo(() => {
    if (mode !== 'scroll' || !box.w) return null
    const items: { i: number; w: number; h: number; top: number; left: number }[] = []
    let y = PAD
    for (let i = 0; i < doc.numPages; i++) {
      const s = doc.getSize(i)
      let w: number
      if (prefs.fit === 'width') w = Math.min(availW, doc.kind === 'images' ? 1400 : 1180)
      else if (prefs.fit === 'page') w = Math.min(availW, availH * (s.width / s.height))
      else w = s.width * prefs.zoom
      const h = w * (s.height / s.width)
      items.push({ i, w, h, top: y, left: Math.max(PAD, (box.w - w) / 2) })
      y += h + GAP
    }
    return { items, total: y + PAD - GAP, width: Math.max(box.w, ...items.map(it => it.w + PAD * 2)) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, box.w, box.h, prefs.fit, prefs.zoom, doc, sizeVersion])

  // ---------- layout: slides (single / spread)
  const slides = useMemo(() => {
    if (mode === 'scroll') return []
    const out: number[][] = []
    if (mode === 'single') for (let i = 0; i < doc.numPages; i++) out.push([i])
    else {
      let i = 0
      if (prefs.coverAlone) { out.push([0]); i = 1 }
      for (; i < doc.numPages; i += 2) out.push(i + 1 < doc.numPages ? [i, i + 1] : [i])
    }
    return out
  }, [mode, doc.numPages, prefs.coverAlone])
  const slideIndex = mode === 'scroll' ? 0 : Math.max(0, slides.findIndex(s => s.includes(page)))
  const slide = slides[slideIndex] ?? [page]
  const slideSizes = useMemo(() => {
    if (mode === 'scroll' || !box.w) return []
    const sizes = slide.map(i => doc.getSize(i))
    const totalAspect = sizes.reduce((a, s) => a + s.width / s.height, 0)
    let h: number
    if (prefs.fit === 'width') h = (availW - GAP * (slide.length - 1)) / totalAspect
    else if (prefs.fit === 'page') h = Math.min(availH, (availW - GAP * (slide.length - 1)) / totalAspect)
    else h = sizes[0].height * prefs.zoom
    return sizes.map(s => ({ w: h * (s.width / s.height), h }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, slide.join(','), box.w, box.h, prefs.fit, prefs.zoom, sizeVersion])

  // ---------- relocation
  const chapterOf = (p: number) => {
    let label: string | undefined
    for (const t of tocFlat.current) { if (t.page <= p) label = t.label; else break }
    return label
  }
  useEffect(() => {
    if (!box.w) return
    const n = doc.numPages
    const last = mode === 'scroll' ? page : slide[slide.length - 1]
    eventsRef.current.onRelocate({
      fraction: n <= 1 ? 1 : page / (n - 1),
      page: page + 1,
      pages: n,
      chapter: chapterOf(page),
      location: page,
      atEnd: last >= n - 1,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, box.w, doc])

  // restore position once the layout exists
  useLayoutEffect(() => {
    if (restored.current || !scrollLayout) return
    restored.current = true
    const it = scrollLayout.items[page]
    if (it) scrollRef.current!.scrollTop = it.top - PAD / 2
  }, [scrollLayout, page])

  // keep the current page in view when the layout changes (zoom, resize)
  const prevLayout = useRef(scrollLayout)
  useLayoutEffect(() => {
    if (!scrollLayout || !prevLayout.current || prevLayout.current === scrollLayout) { prevLayout.current = scrollLayout; return }
    const el = scrollRef.current!
    const old = prevLayout.current.items[pageRef.current]
    const nu = scrollLayout.items[pageRef.current]
    if (old && nu) {
      const within = (el.scrollTop - old.top) / old.h
      el.scrollTop = nu.top + within * nu.h
    }
    prevLayout.current = scrollLayout
  }, [scrollLayout])

  const onScroll = useCallback(() => {
    const el = scrollRef.current!
    setScrollTop(el.scrollTop)
    eventsRef.current.onActivity()
    if (!scrollLayout) return
    const mid = el.scrollTop + el.clientHeight * 0.35
    let lo = 0, hi = scrollLayout.items.length - 1
    while (lo < hi) {
      const m = (lo + hi + 1) >> 1
      if (scrollLayout.items[m].top <= mid) lo = m
      else hi = m - 1
    }
    if (lo !== pageRef.current) setPage(lo)
  }, [scrollLayout])

  const visible = useMemo(() => {
    if (!scrollLayout) return []
    const top = scrollTop - box.h * 0.8
    const bottom = scrollTop + box.h * 1.8
    return scrollLayout.items.filter(it => it.top + it.h >= top && it.top <= bottom)
  }, [scrollLayout, scrollTop, box.h])

  // ---------- navigation
  const goToPage = useCallback((p: number) => {
    const target = Math.max(0, Math.min(doc.numPages - 1, p))
    if (mode === 'scroll' && scrollLayout) {
      scrollRef.current!.scrollTo({ top: scrollLayout.items[target].top - PAD / 2 })
    }
    setPage(target)
  }, [doc.numPages, mode, scrollLayout])

  const step = useCallback((dir: 1 | -1) => {
    const el = scrollRef.current!
    if (mode === 'scroll') {
      el.scrollBy({ top: dir * el.clientHeight * 0.88, behavior: 'smooth' })
      return
    }
    // zoomed in beyond the viewport: scroll inside the slide first
    if (el.scrollHeight > el.clientHeight + 4) {
      const atEdge = dir > 0 ? el.scrollTop + el.clientHeight >= el.scrollHeight - 4 : el.scrollTop <= 4
      if (!atEdge) { el.scrollBy({ top: dir * el.clientHeight * 0.88, behavior: 'smooth' }); return }
    }
    const next = slides[slideIndex + dir]
    if (next) {
      setPage(next[0])
      el.scrollTop = dir > 0 ? 0 : el.scrollHeight
    }
  }, [mode, slides, slideIndex])

  useEffect(() => {
    (doc as any).onLink = (t: { page?: number; url?: string }) => {
      if (t.url) window.bc.openExternal(t.url)
      else if (t.page != null) goToPage(t.page)
    }
  }, [doc, goToPage])

  // ---------- zoom (ctrl + wheel)
  const effectiveZoom = useCallback(() => {
    const s = doc.getSize(pageRef.current)
    if (mode === 'scroll') {
      const it = scrollLayout?.items[pageRef.current]
      return it ? it.w / s.width : 1
    }
    return slideSizes[0] ? slideSizes[0].w / doc.getSize(slide[0]).width : 1
  }, [doc, mode, scrollLayout, slideSizes, slide])

  useEffect(() => {
    const el = scrollRef.current!
    const onWheel = (e: WheelEvent) => {
      eventsRef.current.onActivity()
      if (e.ctrlKey) {
        e.preventDefault()
        const z = effectiveZoom() * (e.deltaY < 0 ? 1.1 : 1 / 1.1)
        setPrefs({ fit: 'custom', zoom: Math.max(0.2, Math.min(6, z)) })
        return
      }
      if (mode !== 'scroll' && el.scrollHeight <= el.clientHeight + 4) {
        e.preventDefault()
        if (Math.abs(e.deltaY) < 4) return
        const now = Date.now()
        if (now < (onWheel as any).lock) return
        ;(onWheel as any).lock = now + 320
        step(e.deltaY > 0 ? 1 : -1)
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [effectiveZoom, setPrefs, mode, step])

  // ---------- selection & taps
  const selectionFromWindow = useCallback(() => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !sel.rangeCount) { eventsRef.current.onSelection(null); return false }
    const range = sel.getRangeAt(0)
    const pageEl = (range.startContainer.parentElement as Element | null)?.closest('.page') as HTMLElement | null
    if (!pageEl || !scrollRef.current!.contains(pageEl)) return false
    const text = sel.toString().replace(/\s+/g, ' ').trim()
    if (!text) { eventsRef.current.onSelection(null); return false }
    const pr = pageEl.getBoundingClientRect()
    const rects = mergeRects(Array.from(range.getClientRects())
      .filter(r => r.width > 0 && r.height > 0 && r.top < pr.bottom && r.bottom > pr.top)
      .map(r => ({ x: (r.left - pr.left) / pr.width, y: (r.top - pr.top) / pr.height, w: r.width / pr.width, h: r.height / pr.height })))
    const br = range.getBoundingClientRect()
    const p = Number(pageEl.dataset.page)
    // context: the text-layer text around the selection
    const full = (pageEl.querySelector('.textLayer')?.textContent ?? '').replace(/\s+/g, ' ')
    const at = full.indexOf(text.slice(0, 40))
    const context = at >= 0 ? full.slice(Math.max(0, at - 450), at + text.length + 450) : ''
    eventsRef.current.onSelection({ text, rect: br, page: p, rects, chapter: chapterOf(p), context })
    return true
  }, [])

  const onPointerUp = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    setTimeout(() => {
      if (selectionFromWindow()) return
      const target = e.target as HTMLElement
      if (target.closest('a')) return
      // click on a highlight?
      const pageEl = target.closest('.page') as HTMLElement | null
      if (pageEl) {
        const pr = pageEl.getBoundingClientRect()
        const x = (e.clientX - pr.left) / pr.width, y = (e.clientY - pr.top) / pr.height
        const hit = annotations.find(a => a.page === Number(pageEl.dataset.page) && a.rects?.some(r => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h))
        if (hit) {
          const r = hit.rects![0]
          eventsRef.current.onAnnotationClick(hit.id, new DOMRect(pr.left + r.x * pr.width, pr.top + r.y * pr.height, r.w * pr.width, r.h * pr.height))
          return
        }
      }
      const box = scrollRef.current!.getBoundingClientRect()
      const rel = (e.clientX - box.left) / box.width
      eventsRef.current.onTap(mode === 'scroll' ? 'center' : rel < 0.28 ? 'left' : rel > 0.72 ? 'right' : 'center')
    }, 10)
  }

  useImperativeHandle(ref, (): EngineController => ({
    async speech(where) {
      if (!doc.hasText) return null
      let p = pageRef.current
      let from: { node: Node; offset: number } | null = null
      const sel = window.getSelection()
      if (where === 'start' && sel && !sel.isCollapsed) {
        const pageEl = (sel.anchorNode as Node | null)?.parentElement?.closest('[data-page]') as HTMLElement | null
        if (pageEl && scrollRef.current?.contains(pageEl)) {
          p = Number(pageEl.dataset.page)
          const r0 = sel.getRangeAt(0)
          from = { node: r0.startContainer, offset: r0.startOffset }
        }
        sel.removeAllRanges()
      }
      if (where === 'next') {
        if (p >= doc.numPages - 1) return null
        p += 1
        goToPage(p)
      }
      // the text layer appears once the page is rendered
      let layer: HTMLElement | null = null
      for (let i = 0; i < 40; i++) {
        layer = scrollRef.current?.querySelector(`[data-page="${p}"] .textLayer`) as HTMLElement | null
        if (layer?.textContent?.trim()) break
        await new Promise(res => setTimeout(res, 100))
      }
      // PDFs rarely declare a language: detect it from the page text
      const sample = layer?.textContent || (await doc.getText?.(p).catch(() => '')) || ''
      const lang = (await doc.getMeta().catch(() => null))?.language || detectLanguage(sample) || 'en'
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--page-accent').trim() || '#c46a2b'
      const reveal = () => { if (pageRef.current !== p && !slides[slideIndex]?.includes(p)) goToPage(p) }
      if (layer?.textContent?.trim()) {
        const units = sentencesIn(layer, lang, from).map(s => ({
          text: s.text,
          mark: (w?: [number, number]) => paintSpeech(document, s.range, w ? s.sub(w[0], w[1]) : null, accent),
          unmark: () => paintSpeech(document, null, null, accent),
          reveal,
        }))
        return { lang, units }
      }
      // no text layer on screen: speak the page text without highlighting
      const text = (await doc.getText?.(p).catch(() => '')) ?? ''
      const seg = new Intl.Segmenter(lang, { granularity: 'sentence' })
      const units = [...seg.segment(text.replace(/\s+/g, ' '))].map(x => x.segment.trim()).filter(x => /[\p{L}\p{N}]/u.test(x))
        .map(t => ({ text: t, mark: () => {}, unmark: () => {}, reveal }))
      return { lang, units }
    },
    scrollStep: px => {
      const el = scrollRef.current
      if (mode !== 'scroll' || !el) return null
      const before = el.scrollTop
      el.scrollTop = before + px
      return el.scrollTop !== before ? 'moved' : 'edge'
    },
    next: () => step(1),
    prev: () => step(-1),
    goTo: async t => goToPage(typeof t === 'number' ? t : Number(t)),
    goToFraction: async f => goToPage(Math.round(f * (doc.numPages - 1))),
    async search(query, onHits, onProgress, signal) {
      const q = query.toLocaleLowerCase().replace(/\s+/g, ' ').trim()
      if (!q || !doc.getText) return
      let n = 0
      for (let i = 0; i < doc.numPages; i++) {
        if (signal.aborted) return
        const text = (await doc.getText(i).catch(() => '')).replace(/\s+/g, ' ')
        const lower = text.toLocaleLowerCase()
        const hits: SearchHit[] = []
        let idx = lower.indexOf(q)
        while (idx >= 0 && hits.length < 50) {
          hits.push({
            id: `p${n++}`, target: i, section: chapterOf(i),
            excerpt: { pre: text.slice(Math.max(0, idx - 50), idx), match: text.slice(idx, idx + q.length), post: text.slice(idx + q.length, idx + q.length + 50) },
          })
          idx = lower.indexOf(q, idx + q.length)
        }
        if (hits.length) onHits(hits)
        if (i % 5 === 0) {
          onProgress((i + 1) / doc.numPages)
          await new Promise(r => setTimeout(r, 0))
        }
      }
      onProgress(1)
      setSearch(s => (s ? { ...s, query } : { query, page: -1 }))
    },
    clearSearch: () => setSearch(null),
    showSearchHit: hit => {
      const p = Number(hit.target)
      setSearch({ query: hit.excerpt.match, page: p })
      goToPage(p)
    },
    setAnnotations: () => {},
    clearSelection: () => window.getSelection()?.removeAllRanges(),
    bookmarkLocation: () => ({ page: pageRef.current, text: undefined }),
    isBookmarked: list => list.find(a => a.kind === 'bookmark' && a.page === pageRef.current) ?? null,
    focus: () => scrollRef.current?.focus(),
  }), [step, goToPage, doc, mode, slides, slideIndex])

  const hlFor = (i: number) => annotations.filter(a => a.page === i && a.kind !== 'bookmark')
  const searchFor = (i: number) => (search?.query ? { query: search.query, active: search.page === i } : null)
  const invert = theme.dark && prefs.invertInDark && doc.kind !== 'images'

  return (
    <div
      ref={scrollRef}
      tabIndex={0}
      className={`paged-scroll mode-${mode} ${invert ? 'invert' : ''} ${rtl ? 'rtl' : ''}`}
      onScroll={mode === 'scroll' ? onScroll : () => eventsRef.current.onActivity()}
      onPointerUp={onPointerUp}
      onKeyDown={e => eventsRef.current.onKey(e.nativeEvent)}
      onPointerMove={() => eventsRef.current.onActivity()}
    >
      {mode === 'scroll' && scrollLayout ? (
        <div className="paged-canvas" style={{ height: scrollLayout.total, width: scrollLayout.width }}>
          {visible.map(it => (
            <PageView key={it.i} doc={doc} index={it.i} width={it.w} height={it.h} top={it.top} left={it.left}
              highlights={hlFor(it.i)} search={searchFor(it.i)} version={sizeVersion} />
          ))}
        </div>
      ) : mode !== 'scroll' ? (
        <div className="paged-slide" style={{ flexDirection: rtl ? 'row-reverse' : 'row', minHeight: '100%' }}>
          {slide.map((i, k) => slideSizes[k] && (
            <PageView key={i} doc={doc} index={i} width={slideSizes[k].w} height={slideSizes[k].h}
              highlights={hlFor(i)} search={searchFor(i)} version={sizeVersion} />
          ))}
        </div>
      ) : null}
    </div>
  )
})
