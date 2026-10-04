import type { BookRecord, MetaCandidate, MetaQuery } from '../../../shared/types'
import { bc } from '../api'
import { useLibrary } from '../store/library'
import { useUi } from '../store/ui'
import { tNow } from '../i18n'
import { authorKey } from './series'

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/** Title without volume/edition noise that confuses catalog search. */
export function cleanTitle(title: string) {
  return title
    .replace(/\.(epub|fb2|pdf|mobi|txt|djvu)$/i, '')
    .replace(/\s*[[(][^\])]*[\])]\s*/g, ' ')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function queryFor(book: BookRecord): MetaQuery {
  const lang = book.language?.slice(0, 2).toLowerCase()
  return { title: cleanTitle(book.title || book.fileName), author: book.authors[0], lang: lang && /^[a-z]{2}$/.test(lang) ? lang : undefined }
}

function bigrams(s: string) {
  const t = ` ${norm(s)} `
  const out = new Map<string, number>()
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2)
    out.set(g, (out.get(g) ?? 0) + 1)
  }
  return out
}

/** Sørensen–Dice coefficient over character bigrams, 0…1. */
export function similarity(a: string, b: string) {
  if (!a || !b) return 0
  const A = bigrams(a), B = bigrams(b)
  let inter = 0, total = 0
  for (const [g, n] of A) { inter += Math.min(n, B.get(g) ?? 0); total += n }
  for (const n of B.values()) total += n
  return total ? (2 * inter) / total : 0
}

/** How well a catalog entry fits the book, 0…1. Used to rank results and for unattended matching. */
export function matchScore(book: BookRecord, c: MetaCandidate) {
  const title = cleanTitle(book.title)
  // catalog titles often carry a subtitle: compare against the main part too
  const ts = Math.max(similarity(title, c.title), similarity(title, c.title.split(/[:.]/)[0]))
  if (!book.authors.length || !c.authors.length) return ts * 0.85
  const keys = new Set(book.authors.map(authorKey))
  const sameAuthor = c.authors.some(a => keys.has(authorKey(a)))
  const as = sameAuthor ? 1 : Math.max(...c.authors.map(a => similarity(a, book.authors[0])))
  return ts * 0.7 + as * 0.3
}

/** Downloads a catalog cover and stores it as the book's cover. */
export async function applyCoverFromUrl(bookId: string, url: string) {
  const bytes = await bc.meta.image(url)
  if (!bytes) return false
  const { processCover } = await import('../formats/metadata')
  const cover = await processCover(new Blob([bytes as BlobPart]))
  if (!cover) return false
  await bc.book.saveCover(bookId, cover.bytes, cover.color)
  useLibrary.setState(s => ({
    books: s.books.map(b => (b.id === bookId ? { ...b, hasCover: true, coverColor: cover.color } : b)),
    coverVersion: { ...s.coverVersion, [bookId]: Date.now() },
  }))
  return true
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
let bulkRunning = false

/** Looks up covers for books that have none; only confident matches are applied. */
export async function findMissingCovers(ids?: string[]) {
  if (bulkRunning) return
  const ui = useUi.getState()
  const books = useLibrary.getState().books
    .filter(b => !b.hasCover && (!ids || ids.includes(b.id)))
  if (!books.length) {
    ui.toast({ kind: 'info', text: tNow('online.allHaveCovers') })
    return
  }
  bulkRunning = true
  let found = 0
  let toastId: number | undefined
  try {
    for (let i = 0; i < books.length; i++) {
      const b = books[i]
      toastId = ui.toast({
        kind: 'progress', text: tNow('online.bulkProgress', { done: i + 1, total: books.length }),
        sub: b.title, progress: i / books.length,
      }, toastId)
      try {
        const list = await bc.meta.search(queryFor(b))
        const best = list
          .filter(c => c.coverUrl)
          .map(c => ({ c, s: matchScore(b, c) }))
          .sort((x, y) => y.s - x.s)[0]
        if (best && best.s >= 0.72 && await applyCoverFromUrl(b.id, best.c.coverUrl!)) found++
      } catch (e) {
        console.warn('cover lookup failed', b.title, e)
      }
      // be polite to the free catalogs
      if (i < books.length - 1) await sleep(350)
    }
  } finally {
    bulkRunning = false
    if (toastId) ui.dismiss(toastId)
  }
  ui.toast({
    kind: found ? 'success' : 'info',
    text: tNow('online.bulkDone', { found, total: books.length }),
  })
}
