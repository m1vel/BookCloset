import { useEffect, useRef } from 'react'
import { bc } from '../../api'
import type { Relocation } from '../../engines/types'
import { useLibrary } from '../../store/library'

const IDLE_MS = 2 * 60_000
const FLUSH_MS = 60_000

/**
 * Tracks active reading time: counts only while the window is visible & focused and the
 * reader interacted within the last two minutes. Sessions are flushed every minute and on exit.
 */
export function useReadingSession(bookId: string, getProgress: () => number) {
  const state = useRef({ start: Date.now(), seconds: 0, pages: 0, from: -1, lastActive: Date.now(), lastTick: Date.now() })
  const activity = () => { state.current.lastActive = Date.now() }
  const pageTurn = () => { state.current.pages++; activity() }

  useEffect(() => {
    const s = state.current
    s.from = getProgress()
    const tick = () => {
      const now = Date.now()
      const dt = (now - s.lastTick) / 1000
      s.lastTick = now
      if (document.visibilityState === 'visible' && document.hasFocus() && now - s.lastActive < IDLE_MS) s.seconds += Math.min(dt, 5)
    }
    const flush = () => {
      tick()
      const progress = getProgress()
      if (s.seconds >= 5) {
        bc.stats.add({
          bookId, start: s.start, end: Date.now(), seconds: Math.round(s.seconds),
          progressFrom: s.from < 0 ? progress : s.from, progressTo: progress, pages: s.pages,
        })
        useLibrary.setState(st => ({
          books: st.books.map(b => (b.id === bookId ? { ...b, readingSeconds: (b.readingSeconds ?? 0) + Math.round(s.seconds) } : b)),
        }))
      }
      s.start = Date.now()
      s.seconds = 0
      s.pages = 0
      s.from = progress
    }
    const t1 = setInterval(tick, 1000)
    const t2 = setInterval(flush, FLUSH_MS)
    const onAct = () => activity()
    window.addEventListener('keydown', onAct)
    window.addEventListener('pointermove', onAct)
    window.addEventListener('beforeunload', flush)
    return () => {
      clearInterval(t1)
      clearInterval(t2)
      window.removeEventListener('keydown', onAct)
      window.removeEventListener('pointermove', onAct)
      window.removeEventListener('beforeunload', flush)
      flush()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId])

  return { activity, pageTurn }
}

/** Debounced persistence of progress & location into the library. */
export function useProgressSaver(bookId: string) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef<Relocation | null>(null)
  const save = () => {
    const r = latest.current
    if (!r) return
    const lib = useLibrary.getState()
    const book = lib.books.find(b => b.id === bookId)
    if (!book) return
    const patch: any = { progress: Math.max(0, Math.min(1, r.fraction)), location: r.location }
    if (book.status === 'new') patch.status = 'reading'
    lib.update(bookId, patch)
  }
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
    save()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId])
  return (r: Relocation) => {
    latest.current = r
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(save, 800)
  }
}
