import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, ListBullets, MagnifyingGlass, Quotes, BookmarkSimple, TextAa, CornersOut, CornersIn, CaretLeft, CaretRight,
  WarningCircle, PlayCircle, PauseCircle, Eyeglasses, SpeakerHigh,
} from '@phosphor-icons/react'
import type { Annotation, HighlightColor } from '../../../../shared/types'
import { useLibrary } from '../../store/library'
import { useSettings } from '../../store/settings'
import { useUi } from '../../store/ui'
import { useT, formatDuration } from '../../i18n'
import { bc } from '../../api'
import type { BookSource, TocItem } from '../../formats/types'
import type { EngineController, EngineEvents, Relocation, SelectionInfo } from '../../engines/types'
import { PAGE_THEMES, applyReaderChrome, resolvePageTheme } from '../../engines/page-themes'
import { IconButton, Popover } from '../../components/ui'
import { ReaderPanel, type PanelTab, type SearchState } from './Panels'
import { ReflowAppearance, PagedAppearance } from './Appearance'
import { SelectionMenu, AnnotationMenu, NoteEditor, FootnotePopup } from './Floating'
import { useProgressSaver, useReadingSession } from './hooks'
import { TranslatePopover } from './TranslatePopover'
import { useAppearance } from '../../store/appearance'
import { nextInSeries } from '../../library/series'
import { ReflowEngine } from '../../engines/reflow/ReflowEngine'
import { PagedEngine } from '../../engines/paged/PagedEngine'
import { openBookById } from '../open'
import { useAutoRead, AutoReadBar, FocusRuler, stepValue, SPEED_STEPS, PAGE_STEPS } from './AutoRead'
import { useReadAloud, ReadAloudBar } from './ReadAloud'

const uid = () => Math.random().toString(36).slice(2, 11)

export default function ReaderView({ bookId, target }: { bookId: string; target?: string | number }) {
  const t = useT()
  const book = useLibrary(s => s.books.find(b => b.id === bookId))
  const lang = useSettings(s => s.settings.lang)
  const appearance = useAppearance()
  const uiTheme = appearance.ui
  const reader = useSettings(s => s.settings.reader)
  const docPrefs = useSettings(s => s.settings.paged)
  const comicPrefs = useSettings(s => s.settings.comic)
  const setReader = useSettings(s => s.setReader)
  const setDocPrefs = useSettings(s => s.setPaged)
  const setComicPrefs = useSettings(s => s.setComic)
  const fullscreen = useUi(s => s.fullscreen)
  const navigate = useUi(s => s.navigate)

  const [source, setSource] = useState<BookSource | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [toc, setToc] = useState<TocItem[]>([])
  const [ticks, setTicks] = useState<number[]>([])
  const [reloc, setReloc] = useState<Relocation | null>(null)
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [panel, setPanel] = useState<PanelTab | null>(null)
  const [appearanceEl, setAppearanceEl] = useState<HTMLElement | null>(null)
  const [chrome, setChrome] = useState(true)
  const [selection, setSelection] = useState<SelectionInfo | null>(null)
  const [annMenu, setAnnMenu] = useState<{ id: string; rect: DOMRect } | null>(null)
  const annMenuRef = useRef<{ id: string; rect: DOMRect } | null>(null)
  annMenuRef.current = annMenu
  const [noteEdit, setNoteEdit] = useState<{ rect: DOMRect; quote?: string; initial?: string; id?: string; sel?: SelectionInfo } | null>(null)
  const [footnote, setFootnote] = useState<{ html: string; rect: DOMRect } | null>(null)
  const [translation, setTranslation] = useState<SelectionInfo | null>(null)
  const [trTarget, setTrTarget] = useState<string | undefined>(undefined)
  const translationRef = useRef<SelectionInfo | null>(null)
  translationRef.current = translation
  const trSettings = useSettings(s => s.settings.translation)
  const [search, setSearch] = useState<SearchState>({ query: '', hits: [], progress: 0, running: false })
  const [searchNonce, setSearchNonce] = useState(0)
  const [scrub, setScrub] = useState<number | null>(null)
  const autoPrefs = useSettings(s => s.settings.autoRead)
  const updateSettings = useSettings(s => s.update)
  const [auto, setAuto] = useState(false)
  const [autoHold, setAutoHold] = useState(false)
  const [focusMode, setFocusMode] = useState(false)
  const focusRef = useRef(false)
  focusRef.current = focusMode
  const stageRef = useRef<HTMLDivElement>(null)
  const ctrl = useRef<EngineController>(null)
  const raRef = useRef<ReturnType<typeof useReadAloud> | null>(null)
  const relocRef = useRef<Relocation | null>(null)
  const endToastShown = useRef(false)
  const endToastId = useRef<number | null>(null)
  const initialRecord = useRef(book)
  useEffect(() => () => { if (endToastId.current) useUi.getState().dismiss(endToastId.current) }, [])

  const isComic = source?.kind === 'paged' && source.doc.kind === 'images'
  const paged = isComic ? comicPrefs : docPrefs
  const setPaged = isComic ? setComicPrefs : setDocPrefs
  const themeName = resolvePageTheme(appearance.page, uiTheme)
  const theme = PAGE_THEMES[themeName]
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--page-accent').trim() || theme.accent

  // ---------------------------------------------------------------- open the book
  useEffect(() => {
    let cancelled = false
    let src: BookSource | null = null
    const record = initialRecord.current
    if (!record) return
    ;(async () => {
      try {
        const { openRecord } = await import('../../formats/open')
        src = await openRecord(record)
        if (cancelled) return destroy(src)
        setSource(src)
      } catch (e: any) {
        console.error(e)
        if (!cancelled) setError(String(e?.message ?? e))
      }
    })()
    bc.annotations.get(bookId).then(list => { if (!cancelled) setAnnotations(list) })
    return () => {
      cancelled = true
      if (src) setTimeout(() => destroy(src!), 0)
    }
  }, [bookId])

  // ---------------------------------------------------------------- page theme → chrome tokens & title bar
  useEffect(() => {
    applyReaderChrome(themeName, uiTheme)
    bc.win.titlebar('#00000000', theme.fg)
    return () => applyReaderChrome(null, uiTheme)
  }, [themeName, uiTheme])

  // ---------------------------------------------------------------- stats & progress
  const session = useReadingSession(bookId, () => relocRef.current?.fraction ?? book?.progress ?? 0)
  const saveProgress = useProgressSaver(bookId)

  // ---------------------------------------------------------------- chrome autohide
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pinned = !!(panel || appearanceEl || selection || annMenu || noteEdit || !source || error || scrub != null)
  const pinnedRef = useRef(pinned)
  pinnedRef.current = pinned
  const scheduleHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => { if (!pinnedRef.current) setChrome(false) }, 2600)
  }, [])
  useEffect(() => { if (pinned) setChrome(true); else scheduleHide() }, [pinned, scheduleHide])
  useEffect(() => {
    const onPointer = (x: number, y: number) => {
      const edge = focusRef.current ? 18 : 84
      if (y < edge || y > window.innerHeight - (focusRef.current ? 18 : 96) || (panel && x < 380)) {
        setChrome(true)
        scheduleHide()
      }
    }
    const a = (e: PointerEvent) => onPointer(e.clientX, e.clientY)
    const b = (e: Event) => { const d = (e as CustomEvent).detail; onPointer(d.x, d.y) }
    window.addEventListener('pointermove', a)
    window.addEventListener('reader-pointer', b)
    return () => { window.removeEventListener('pointermove', a); window.removeEventListener('reader-pointer', b) }
  }, [panel, scheduleHide])

  // search outlines live only while the search tab is open
  useEffect(() => { if (panel !== 'search') ctrl.current?.clearSearch() }, [panel])

  // ---------------------------------------------------------------- annotations persistence
  const saveAnnotations = useCallback((list: Annotation[]) => {
    setAnnotations(list)
    bc.annotations.set(bookId, list).then(() => useLibrary.getState().refreshCounts())
  }, [bookId])

  const isRtl = source?.kind === 'paged' ? (paged.rtl || !!(source.doc as any).rtl) : source?.meta.rtl
  const goLeft = () => { (isRtl ? ctrl.current?.next() : ctrl.current?.prev()); raRef.current?.followNavigation() }
  const goRight = () => { (isRtl ? ctrl.current?.prev() : ctrl.current?.next()); raRef.current?.followNavigation() }

  // ---------------------------------------------------------------- keyboard
  const toggleBookmark = useCallback(() => {
    const c = ctrl.current
    if (!c) return
    const existing = c.isBookmarked(annotations)
    if (existing) return saveAnnotations(annotations.filter(a => a.id !== existing.id))
    const loc = c.bookmarkLocation()
    if (!loc) return
    const now = Date.now()
    saveAnnotations([...annotations, {
      id: uid(), bookId, kind: 'bookmark', cfi: loc.cfi, page: loc.page, text: loc.text,
      chapter: relocRef.current?.chapter, progress: relocRef.current?.fraction, createdAt: now, updatedAt: now,
    }])
  }, [annotations, bookId, saveAnnotations])

  const onKey = useCallback((e: KeyboardEvent) => {
    // the paged engine forwards its keydown and the same event then bubbles to window: handle once
    if ((e as any).__bcHandled) return
    ;(e as any).__bcHandled = true
    session.activity()
    const k = e.key
    const target = e.target as HTMLElement | null
    if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return
    if (e.ctrlKey && k.toLowerCase() === 'f') { e.preventDefault(); setPanel('search'); return }
    if (e.ctrlKey && k.toLowerCase() === 't' && selection && trSettings.enabled) { e.preventDefault(); openTranslation(selection); return }
    if (e.ctrlKey && (k.toLowerCase() === 'b' || k.toLowerCase() === 'd')) { e.preventDefault(); toggleBookmark(); return }
    if (e.ctrlKey && (k === '=' || k === '+')) {
      e.preventDefault()
      if (source?.kind === 'paged') setPaged({ fit: 'custom', zoom: Math.min(6, paged.zoom * 1.15) })
      else setReader({ fontSize: Math.min(34, reader.fontSize + 1) })
      return
    }
    if (e.ctrlKey && k === '-') {
      e.preventDefault()
      if (source?.kind === 'paged') setPaged({ fit: 'custom', zoom: Math.max(0.2, paged.zoom / 1.15) })
      else setReader({ fontSize: Math.max(12, reader.fontSize - 1) })
      return
    }
    if (e.ctrlKey && k === '0') { e.preventDefault(); if (source?.kind === 'paged') setPaged({ fit: 'width' }); return }
    if (e.ctrlKey || e.altKey || e.metaKey) return
    // layout-independent letters (Russian keyboard)
    if (e.code === 'KeyS' && !e.shiftKey) { e.preventDefault(); toggleAuto(); return }
    if (e.code === 'KeyR' && !e.shiftKey) { e.preventDefault(); toggleReadAloud(); return }
    const reading = raRef.current
    if (reading && reading.status !== 'idle' && k === ' ') { e.preventDefault(); reading.toggle(); return }
    if (e.code === 'KeyF' && !e.shiftKey) { e.preventDefault(); toggleFocus(); return }
    if (auto) {
      if (k === ' ') { e.preventDefault(); setAutoHold(h => !h); return }
      if (k === '+' || k === '=' || e.code === 'NumpadAdd') { e.preventDefault(); changeSpeed(1); return }
      if (k === '-' || e.code === 'NumpadSubtract') { e.preventDefault(); changeSpeed(-1); return }
    }
    if (focusMode && autoPrefs.ruler && (k === 'ArrowDown' || k === 'ArrowUp')) {
      e.preventDefault()
      window.dispatchEvent(new CustomEvent('ruler-step', { detail: k === 'ArrowDown' ? 1 : -1 }))
      return
    }
    switch (k) {
      case 'ArrowRight': e.preventDefault(); goRight(); break
      case 'ArrowLeft': e.preventDefault(); goLeft(); break
      case 'ArrowDown': if (source?.kind === 'reflow' && reader.flow === 'paginated') { e.preventDefault(); ctrl.current?.next() } break
      case 'ArrowUp': if (source?.kind === 'reflow' && reader.flow === 'paginated') { e.preventDefault(); ctrl.current?.prev() } break
      case 'PageDown': case ' ':
        e.preventDefault()
        if (e.shiftKey) ctrl.current?.prev(); else ctrl.current?.next()
        break
      case 'PageUp': e.preventDefault(); ctrl.current?.prev(); break
      case 'Home': e.preventDefault(); ctrl.current?.goToFraction(0); break
      case 'End': e.preventDefault(); ctrl.current?.goToFraction(1); break
      case 'F11': e.preventDefault(); bc.win.fullscreen(); break
      case 'Escape':
        if (reading && reading.status !== 'idle' && !(translation || annMenu || footnote || noteEdit || selection || panel)) { reading.stop(); break }
        if (auto && !(translation || annMenu || footnote || noteEdit || selection || panel)) { setAuto(false); break }
        if (focusMode && !(translation || annMenu || footnote || noteEdit || selection || panel)) { setFocusMode(false); break }
        if (translation || annMenu || footnote || noteEdit) { setTranslation(null); setAnnMenu(null); setFootnote(null); setNoteEdit(null) }
        else if (selection) { ctrl.current?.clearSelection(); setSelection(null) }
        else if (panel) setPanel(null)
        else if (fullscreen) bc.win.fullscreen(false)
        else exit()
        break
      case 't': case 'T': setPanel(p => (p === 'toc' ? null : 'toc')); break
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, reader, paged, selection, panel, fullscreen, toggleBookmark, isRtl, trSettings.enabled, translation, annMenu, footnote, noteEdit, auto, focusMode, autoPrefs])
  const onKeyRef = useRef(onKey)
  onKeyRef.current = onKey
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (document.querySelector('.dialog-backdrop')) return
      onKeyRef.current(e)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  // ---------------------------------------------------------------- engine events
  const events: EngineEvents = useMemo(() => ({
    onReady: ({ toc, sectionFractions }) => {
      setToc(toc)
      setTicks(sectionFractions ?? [])
      if (target != null) setTimeout(() => ctrl.current?.goTo(target), 60)
      setTimeout(() => ctrl.current?.focus(), 100)
    },
    onRelocate: r => {
      const prev = relocRef.current
      relocRef.current = r
      setReloc(r)
      saveProgress(r)
      const moved = !!prev && prev.location !== r.location
      if (moved) session.pageTurn()
      setFootnote(null)
      // offer to mark the book as finished only when the reader actually turned to the last page
      if (r.atEnd && moved && !endToastShown.current) {
        endToastShown.current = true
        const b = useLibrary.getState().books.find(x => x.id === bookId)
        if (b && b.status !== 'finished') {
          endToastId.current = useUi.getState().toast({
            kind: 'info', text: t('reader.endOfBook'), sub: t('reader.finishedQ'),
            action: { label: t('book.markFinished'), run: () => {
              const lib = useLibrary.getState()
              lib.update(bookId, { status: 'finished', progress: 1, finishedAt: Date.now() })
              const me = lib.books.find(x => x.id === bookId)
              const next = me && nextInSeries(me, lib.books)
              if (next) useUi.getState().toast({
                kind: 'info', text: t('reader.nextBook', { title: next.title }), sticky: true,
                action: { label: t('reader.readNext'), run: () => openBookById(next.id) },
              })
            } },
          })
        }
      }
    },
    onSelection: s => {
      if (s) { setAnnMenu(null); setTranslation(null) }
      const single = !!s && s.text.length <= 40 && !/\s/.test(s.text.trim())
      if (s && single && trSettings.enabled && trSettings.autoWord) { setSelection(s); openTranslation(s); return }
      setSelection(s)
    },
    onAnnotationClick: (id, rect) => { setSelection(null); setAnnMenu({ id, rect }) },
    onTap: zone => {
      session.activity()
      if (footnote || translationRef.current || annMenuRef.current) { setFootnote(null); setTranslation(null); setAnnMenu(null); return }
      const pagedTurn = source?.kind === 'paged' ? paged.mode !== 'scroll' : reader.flow === 'paginated'
      if (zone === 'left' && pagedTurn) goLeft()
      else if (zone === 'right' && pagedTurn) goRight()
      else setChrome(c => !c)
    },
    onKey: e => onKeyRef.current(e),
    onActivity: () => session.activity(),
    onFootnote: (html, rect) => setFootnote({ html, rect }),
    onError: e => setError(String((e as any)?.message ?? e)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [source, reader.flow, paged.mode, footnote, isRtl, trSettings.enabled, trSettings.autoWord])

  // ---------------------------------------------------------------- auto-read & focus mode
  const continuous = source?.kind === 'paged' ? paged.mode === 'scroll' : reader.flow === 'scrolled'
  const dialogOpen = useUi(s => !!(s.quoteCard || s.confirmReq || s.promptReq))
  const [hidden, setHidden] = useState(document.hidden)
  useEffect(() => {
    const on = () => setHidden(document.hidden)
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])
  const uiBusy = !!(panel || appearanceEl || selection || annMenu || noteEdit || translation || footnote || scrub != null || !source || error)
  const autoPaused = autoHold || uiBusy || dialogOpen || hidden
  const autoProgress = useAutoRead({
    ctrl, relocRef, running: auto, paused: autoPaused, continuous, prefs: autoPrefs,
    onActivity: () => session.activity(),
    onEnd: () => { setAuto(false); useUi.getState().toast({ kind: 'info', text: t('auto.ended') }) },
  })
  const ra = useReadAloud({
    ctrl,
    onActivity: () => session.activity(),
    onStop: reason => useUi.getState().toast(reason === 'notext'
      ? { kind: 'info', text: t('tts.noText') }
      : reason === 'novoice' ? { kind: 'error', text: t('tts.noVoices') }
      : reason === 'sleep' ? { kind: 'info', text: t('tts.sleepDone') }
      : { kind: 'info', text: t('tts.ended') }),
  })
  raRef.current = ra
  function toggleReadAloud() {
    if (ra.status === 'idle') { setAuto(false); ra.start() } else ra.stop()
  }
  function toggleAuto() {
    if (!auto) ra.stop()
    setAuto(a => !a)
    setAutoHold(false)
  }
  function toggleFocus() {
    setFocusMode(f => {
      if (!f) {
        setChrome(false)
        useUi.getState().toast({ kind: 'info', text: t('focus.on'), sub: t('focus.hint') })
      }
      return !f
    })
  }
  function changeSpeed(dir: 1 | -1) {
    updateSettings(s => {
      if (continuous) s.autoRead.speed = stepValue(SPEED_STEPS, s.autoRead.speed, dir)
      else s.autoRead.pageSeconds = stepValue(PAGE_STEPS, s.autoRead.pageSeconds, dir === 1 ? -1 : 1)
    })
  }
  const rulerHeight = Math.round(source?.kind === 'paged'
    ? 30 * autoPrefs.rulerLines + 12
    : reader.fontSize * reader.lineHeight * autoPrefs.rulerLines + 14)
  const dimColor = useMemo(() => {
    const m = /^#?([0-9a-f]{6})$/i.exec(theme.bg)
    const n = m ? parseInt(m[1], 16) : 0
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${theme.dark ? 0.78 : 0.72})`
  }, [theme.bg, theme.dark])

  // ---------------------------------------------------------------- selection actions
  const addHighlight = (color: HighlightColor, note?: string, sel = selection) => {
    if (!sel) return
    const now = Date.now()
    saveAnnotations([...annotations, {
      id: uid(), bookId, kind: note ? 'note' : 'highlight', color, style: 'highlight',
      cfi: sel.cfi, page: sel.page, rects: sel.rects, text: sel.text, note, chapter: sel.chapter ?? relocRef.current?.chapter,
      progress: relocRef.current?.fraction, createdAt: now, updatedAt: now,
    }])
    ctrl.current?.clearSelection()
    setSelection(null)
  }
  const openTranslation = (s: SelectionInfo | null) => {
    if (!s) return
    setTranslation(s)
  }
  const copy = (text: string) => {
    navigator.clipboard.writeText(text)
    useUi.getState().toast({ kind: 'success', text: t('common.copied') })
  }
  const exportNotes = () => {
    if (!book) return
    const notes = annotations.filter(a => a.kind !== 'bookmark')
    let md = `# ${book.title}\n\n${book.authors.length ? `_${book.authors.join(', ')}_\n\n` : ''}`
    let chapter = ''
    for (const a of notes) {
      if (a.chapter && a.chapter !== chapter) { chapter = a.chapter; md += `## ${chapter}\n\n` }
      md += `> ${(a.text ?? '').replace(/\n+/g, '\n> ')}\n\n`
      if (a.note) md += `${a.note}\n\n`
    }
    bc.saveText(`${book.title} — notes.md`, md)
  }

  const exit = () => {
    const last = useUi.getState().lastLibraryRoute
    navigate(last.name === 'reader' ? { name: 'library', filter: { kind: 'all' } } : last)
  }

  if (!book) return null
  const annotation = annMenu ? annotations.find(a => a.id === annMenu.id) : null
  const bookmarked = !!(reloc && ctrl.current?.isBookmarked(annotations))
  const pct = Math.round((scrub ?? reloc?.fraction ?? book.progress) * 100)
  const pagedMode = source?.kind === 'paged'
  const stageInset = panel ? 'panel-open' : ''

  return (
    <div className={`reader ${chrome ? 'chrome-on' : 'chrome-off'} ${theme.dark ? 'is-dark' : ''} ${focusMode ? 'focus-mode' : ''} ${auto ? 'auto-on' : ''}`} style={{ background: theme.bg, color: theme.fg }}>
      {/* top bar */}
      <header className="reader-top drag-region">
        <div className="rt-left no-drag">
          <IconButton label={t('reader.back')} onClick={exit}><ArrowLeft size={19} /></IconButton>
          <IconButton label={t('reader.toc')} shortcut="T" active={panel === 'toc'} onClick={() => setPanel(p => (p === 'toc' ? null : 'toc'))}><ListBullets size={19} /></IconButton>
          <IconButton label={t('reader.search')} shortcut="Ctrl F" active={panel === 'search'} onClick={() => setPanel(p => (p === 'search' ? null : 'search'))}><MagnifyingGlass size={19} /></IconButton>
        </div>
        <div className="rt-title">
          <div className="rt-book truncate">{book.title}</div>
          {reloc?.chapter && <div className="rt-chapter truncate">{reloc.chapter}</div>}
        </div>
        <div className="rt-right no-drag">
          <IconButton label={ra.status !== 'idle' ? t('tts.stop') : t('tts.title')} shortcut="R" active={ra.status !== 'idle'} onClick={toggleReadAloud}>
            <SpeakerHigh size={20} />
          </IconButton>
          <IconButton label={auto ? t('auto.stop') : t('auto.start')} shortcut="S" active={auto} onClick={toggleAuto}>
            {auto ? <PauseCircle size={20} /> : <PlayCircle size={20} />}
          </IconButton>
          <IconButton label={focusMode ? t('focus.off') : t('focus.title')} shortcut="F" active={focusMode} onClick={toggleFocus}>
            <Eyeglasses size={20} />
          </IconButton>
          <IconButton label={t('reader.notes')} active={panel === 'notes'} onClick={() => setPanel(p => (p === 'notes' ? null : 'notes'))}><Quotes size={19} /></IconButton>
          <IconButton label={bookmarked ? t('reader.removeBookmark') : t('reader.addBookmark')} shortcut="Ctrl B" active={bookmarked} onClick={toggleBookmark}>
            <BookmarkSimple size={19} weight={bookmarked ? 'fill' : 'regular'} />
          </IconButton>
          <IconButton label={t('reader.appearance')} active={!!appearanceEl} onClick={e => setAppearanceEl(appearanceEl ? null : e.currentTarget)}><TextAa size={20} /></IconButton>
          <IconButton label={t('reader.fullscreen')} shortcut="F11" onClick={() => bc.win.fullscreen()}>
            {fullscreen ? <CornersIn size={19} /> : <CornersOut size={19} />}
          </IconButton>
        </div>
      </header>

      {/* stage */}
      <div ref={stageRef} className={`reader-stage ${stageInset} ${pagedMode ? 'is-paged' : 'is-reflow'} flow-${reader.flow}`}>
        {source?.kind === 'reflow' && (
          <ReflowEngine ref={ctrl} book={source.book} meta={{ ...source.meta, title: book.title }} prefs={reader}
            theme={theme} accent={accent} initialLocation={typeof book.location === 'string' ? book.location : null}
            initialFraction={book.progress} annotations={annotations} events={events} />
        )}
        {source?.kind === 'paged' && (
          <PagedEngine ref={ctrl} doc={source.doc} prefs={{ ...paged, rtl: paged.rtl || !!(source.doc as any).rtl }} theme={theme}
            initialPage={typeof book.location === 'number' ? book.location : Math.round(book.progress * (source.doc.numPages - 1))}
            annotations={annotations} events={events} setPrefs={setPaged} />
        )}
        {!source && !error && <LoadingBook title={book.title} />}
        {focusMode && autoPrefs.ruler && source && (
          <FocusRuler stage={stageRef} height={rulerHeight} color={dimColor} accent={accent}
            guided={auto && !continuous ? autoProgress : null}
            onOverflow={dir => (dir > 0 ? ctrl.current?.next() : ctrl.current?.prev())} />
        )}
        {appearance.warmth > 0 && <div className="warm-filter" style={{ opacity: appearance.warmth }} aria-hidden="true" />}
        {error && (
          <div className="reader-error rise-in">
            <WarningCircle size={42} weight="duotone" />
            <h2 className="display">{t('reader.openError')}</h2>
            <p>{error === 'CALIBRE_NOT_FOUND' || /CALIBRE_NOT_FOUND/.test(error) ? t('reader.calibreNeeded') : t('reader.openErrorHint')}</p>
            <code className="err-detail">{error}</code>
            <button className="btn primary" onClick={exit}><ArrowLeft size={16} /> {t('reader.back')}</button>
          </div>
        )}
        {source && (pagedMode ? paged.mode !== 'scroll' : reader.flow === 'paginated') && (
          <>
            <button className="edge-nav left" aria-label="prev" onClick={goLeft}><CaretLeft size={22} weight="bold" /></button>
            <button className="edge-nav right" aria-label="next" onClick={goRight}><CaretRight size={22} weight="bold" /></button>
          </>
        )}
      </div>

      {ra.status !== 'idle' && source && <ReadAloudBar ra={ra} />}
      {auto && source && (
        <AutoReadBar continuous={continuous} prefs={autoPrefs} paused={autoPaused} manualPause={autoHold} progressRef={autoProgress}
          focus={focusMode} onToggle={() => setAutoHold(h => !h)} onSpeed={changeSpeed}
          onRuler={() => updateSettings(s => { s.autoRead.ruler = !s.autoRead.ruler })} onClose={() => setAuto(false)} />
      )}

      {/* bottom bar */}
      <footer className="reader-bottom">
        <div className="rb-chapter truncate">{reloc?.chapter ?? ''}</div>
        <ProgressScrubber value={reloc?.fraction ?? book.progress} ticks={ticks}
          onScrub={setScrub} onCommit={f => { setScrub(null); ctrl.current?.goToFraction(f); ra.followNavigation() }} />
        <div className="rb-meta tabular">
          {reloc?.page && reloc.pages ? <span>{t('reader.page', { cur: reloc.page, total: reloc.pages })}</span> : null}
          <span className="rb-pct">{pct}%</span>
          {reloc?.chapterTimeLeft != null && reloc.chapterTimeLeft > 0 && (
            <span className="rb-time">{t('reader.chapterLeft', { time: formatDuration(reloc.chapterTimeLeft, lang) })}</span>
          )}
        </div>
      </footer>

      {panel && (
        <ReaderPanel tab={panel} setTab={setPanel} onClose={() => { setPanel(null); ctrl.current?.focus() }} toc={toc}
          currentChapter={reloc?.chapter} annotations={annotations} controller={ctrl.current}
          onNavigate={target => { ctrl.current?.goTo(target); ra.followNavigation(); if (window.innerWidth < 1100) setPanel(null) }}
          onDelete={id => saveAnnotations(annotations.filter(a => a.id !== id))}
          onEditNote={a => setNoteEdit({ rect: new DOMRect(window.innerWidth / 2, window.innerHeight / 2, 0, 0), quote: a.text, initial: a.note, id: a.id })}
          onExport={exportNotes} search={search} setSearch={setSearch} paged={pagedMode} searchNonce={searchNonce} />
      )}

      <Popover anchor={appearanceEl} open={!!appearanceEl} onClose={() => setAppearanceEl(null)} placement="bottom-end" className="appearance-pop">
        {pagedMode ? <PagedAppearance prefs={paged} setPrefs={setPaged} /> : <ReflowAppearance />}
      </Popover>

      {selection && !noteEdit && !translation && (
        <SelectionMenu rect={selection.rect}
          onHighlight={c => addHighlight(c)}
          onNote={() => setNoteEdit({ rect: selection.rect, quote: selection.text, sel: selection })}
          onCopy={() => { copy(selection.text); ctrl.current?.clearSelection(); setSelection(null) }}
          onSearch={() => {
            setSearch({ query: selection.text.slice(0, 80), hits: [], progress: 0, running: false })
            setPanel('search')
            setSearchNonce(n => n + 1)
            ctrl.current?.clearSelection()
            setSelection(null)
          }}
          onTranslate={trSettings.enabled ? () => openTranslation(selection) : undefined}
          onReadFrom={() => { setAuto(false); ra.start(); setSelection(null) }}
          onQuoteCard={() => {
            useUi.getState().showQuoteCard({ bookId, text: selection.text, chapter: selection.chapter ?? relocRef.current?.chapter })
            ctrl.current?.clearSelection()
            setSelection(null)
          }}
        />
      )}
      {annMenu && annotation && (
        <AnnotationMenu rect={annMenu.rect} color={annotation.color} style={annotation.style}
          onClose={() => setAnnMenu(null)}
          onColor={c => saveAnnotations(annotations.map(a => (a.id === annotation.id ? { ...a, color: c, updatedAt: Date.now() } : a)))}
          onStyle={s => saveAnnotations(annotations.map(a => (a.id === annotation.id ? { ...a, style: s, updatedAt: Date.now() } : a)))}
          onNote={() => { setNoteEdit({ rect: annMenu.rect, quote: annotation.text, initial: annotation.note, id: annotation.id }); setAnnMenu(null) }}
          onCopy={() => { copy(annotation.text ?? ''); setAnnMenu(null) }}
          onQuoteCard={() => { useUi.getState().showQuoteCard({ bookId, text: annotation.text ?? '', chapter: annotation.chapter }); setAnnMenu(null) }}
          onDelete={() => { saveAnnotations(annotations.filter(a => a.id !== annotation.id)); setAnnMenu(null) }}
        />
      )}
      {noteEdit && (
        <NoteEditor rect={noteEdit.rect} quote={noteEdit.quote} initial={noteEdit.initial}
          onClose={() => setNoteEdit(null)}
          onSave={text => {
            if (noteEdit.id) {
              saveAnnotations(annotations.map(a => (a.id === noteEdit.id
                ? { ...a, note: text.trim() || undefined, kind: text.trim() ? 'note' : 'highlight', updatedAt: Date.now() } : a)))
            } else if (noteEdit.sel) addHighlight('yellow', text.trim() || undefined, noteEdit.sel)
            setNoteEdit(null)
          }} />
      )}
      {footnote && <FootnotePopup rect={footnote.rect} html={footnote.html} onClose={() => setFootnote(null)} />}
      {translation && (
        <TranslatePopover
          key={translation.text}
          rect={translation.rect}
          text={translation.text}
          context={translation.context}
          title={book.title}
          target={trTarget}
          onTarget={setTrTarget}
          onClose={() => setTranslation(null)}
          onOpenSettings={() => { setTranslation(null); navigate({ name: 'settings' }) }}
          origin={{ bookId, bookTitle: book.title, cfi: translation.cfi, page: translation.page }}
          onSave={text => {
            addHighlight('blue', text, translation)
            setTranslation(null)
            useUi.getState().toast({ kind: 'success', text: t('tr.saved') })
          }}
        />
      )}
    </div>
  )
}

function destroy(src: BookSource) {
  try {
    if (src.kind === 'reflow') src.book.destroy?.()
    else src.doc.destroy()
  } catch { /* ignore */ }
}

function LoadingBook({ title }: { title: string }) {
  const t = useT()
  return (
    <div className="reader-loading fade-in">
      <div className="book-anim" aria-hidden="true">
        <span className="ba-cover" />
        <span className="ba-page p1" />
        <span className="ba-page p2" />
        <span className="ba-page p3" />
      </div>
      <div className="rl-title display">{title}</div>
      <div className="rl-sub">{t('reader.opening')}</div>
    </div>
  )
}

function ProgressScrubber({ value, ticks, onScrub, onCommit }: {
  value: number; ticks: number[]; onScrub: (f: number | null) => void; onCommit: (f: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<number | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const frac = (e: { clientX: number }) => {
    const r = ref.current!.getBoundingClientRect()
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
  }
  const shown = drag ?? value
  return (
    <div ref={ref} className={`scrubber ${drag != null ? 'dragging' : ''}`} role="slider" aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={Math.round(shown * 100)} tabIndex={-1}
      onPointerDown={e => { (e.target as Element).setPointerCapture(e.pointerId); const f = frac(e); setDrag(f); onScrub(f) }}
      onPointerMove={e => { const f = frac(e); setHover(f); if (drag != null) { setDrag(f); onScrub(f) } }}
      onPointerLeave={() => setHover(null)}
      onPointerUp={e => { if (drag != null) { const f = frac(e); setDrag(null); onCommit(f) } }}>
      <div className="sc-track">
        <div className="sc-fill" style={{ width: `${shown * 100}%` }} />
        {ticks.length < 200 && ticks.slice(1, -1).map((tk, i) => <span key={i} className="sc-tick" style={{ left: `${tk * 100}%` }} />)}
      </div>
      <div className="sc-thumb" style={{ left: `${shown * 100}%` }} />
      {hover != null && drag == null && <div className="sc-hover" style={{ left: `${hover * 100}%` }}>{Math.round(hover * 100)}%</div>}
    </div>
  )
}

export { openBookById }
