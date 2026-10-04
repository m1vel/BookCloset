import { useLibrary } from '../store/library'
import { useUi } from '../store/ui'
import { authorKey, seriesKey } from '../library/series'

export function openBookById(id: string, target?: string | number) {
  const lib = useLibrary.getState()
  const b = lib.books.find(b => b.id === id)
  if (!b) return
  lib.update(id, { openedAt: Date.now(), status: b.status === 'new' ? 'reading' : b.status })
  useUi.getState().navigate({ name: 'reader', bookId: id, target })
}

export function openAuthor(name: string) {
  useUi.getState().navigate({ name: 'library', filter: { kind: 'author', key: authorKey(name), label: name } })
}

export function openSeries(name: string) {
  useUi.getState().navigate({ name: 'library', filter: { kind: 'series', key: seriesKey(name), label: name } })
}
