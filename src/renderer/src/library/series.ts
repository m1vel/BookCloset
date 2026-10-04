import type { BookRecord } from '../../../shared/types'

const norm = (s: string) => s.toLocaleLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim()

/**
 * Grouping key for an author name. Different files spell the same author differently
 * ("Александр Сергеевич Пушкин", "Пушкин", "Пушкин А. С."), so the key is the surname:
 * the last word that is not an initial.
 */
export function authorKey(name: string): string {
  const words = norm(name).split(' ').filter(w => !/^[\p{L}]\.?$|^[\p{L}]\.[\p{L}]\.?$/u.test(w))
  if (!words.length) return norm(name)
  // "Пушкин А. С." → initials were dropped above, the surname is what is left
  return words[words.length - 1]
}

export const seriesKey = (name: string) => norm(name)

export function bookHasAuthor(b: BookRecord, key: string) {
  return b.authors.some(a => authorKey(a) === key)
}

export function seriesBooks(books: BookRecord[], name: string): BookRecord[] {
  const key = seriesKey(name)
  return books
    .filter(b => b.series && seriesKey(b.series) === key)
    .sort((a, b) => (a.seriesIndex ?? 1e9) - (b.seriesIndex ?? 1e9) || a.title.localeCompare(b.title))
}

/** The next unread book of the same series, if the library has it. */
export function nextInSeries(book: BookRecord, books: BookRecord[]): BookRecord | null {
  if (!book.series) return null
  const list = seriesBooks(books, book.series)
  const i = list.findIndex(b => b.id === book.id)
  return list.slice(i + 1).find(b => b.status !== 'finished' && b.id !== book.id) ?? null
}

export interface BookGroup {
  key: string
  label: string
  books: BookRecord[]
}

/** Groups books by author (a book with two authors appears in both) or by series. */
export function groupBooks(books: BookRecord[], by: 'author' | 'series', lang: string): BookGroup[] {
  const groups = new Map<string, BookGroup>()
  const add = (key: string, label: string, b: BookRecord) => {
    const g = groups.get(key)
    if (g) {
      g.books.push(b)
      // the most complete spelling becomes the label
      if (label.length > g.label.length) g.label = label
    } else groups.set(key, { key, label, books: [b] })
  }
  for (const b of books) {
    if (by === 'series') {
      if (b.series) add(seriesKey(b.series), b.series, b)
      else add('', '', b)
    } else if (b.authors.length) for (const a of b.authors) add(authorKey(a), a, b)
    else add('', '', b)
  }
  const collator = new Intl.Collator(lang, { numeric: true, sensitivity: 'base' })
  const list = [...groups.values()]
  for (const g of list) {
    if (by === 'series') g.books.sort((a, b) => (a.seriesIndex ?? 1e9) - (b.seriesIndex ?? 1e9) || collator.compare(a.title, b.title))
  }
  // named groups alphabetically, the "unknown" bucket last
  return list.sort((a, b) => (a.key === '' ? 1 : b.key === '' ? -1 : collator.compare(a.label, b.label)))
}
