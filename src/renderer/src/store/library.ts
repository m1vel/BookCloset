import { create } from 'zustand'
import type { BookRecord, Collection } from '../../../shared/types'
import { bc } from '../api'
import { useUi } from './ui'
import { tNow } from '../i18n'

interface LibraryState {
  books: BookRecord[]
  collections: Collection[]
  annotationCounts: Record<string, number>
  coverVersion: Record<string, number>
  loaded: boolean
  indexing: { done: number; total: number } | null
  load: () => Promise<void>
  importPaths: (paths: string[]) => Promise<BookRecord[]>
  update: (id: string, patch: Partial<BookRecord>) => Promise<void>
  remove: (ids: string[]) => Promise<void>
  addCollection: (name: string) => Collection
  renameCollection: (id: string, name: string) => void
  deleteCollection: (id: string) => void
  toggleInCollection: (bookId: string, collectionId: string) => void
  reindex: (ids: string[]) => Promise<void>
  refreshCounts: () => Promise<void>
}

const uid = () => Math.random().toString(36).slice(2, 10)

export const useLibrary = create<LibraryState>((set, get) => ({
  books: [],
  collections: [],
  annotationCounts: {},
  coverVersion: {},
  loaded: false,
  indexing: null,

  load: async () => {
    const data = await bc.library.get()
    set({ books: data.books, collections: data.collections, loaded: true })
    get().refreshCounts()
    // finish indexing books that were imported but not processed (e.g. app was closed)
    const pending = data.books.filter(b => !b.indexed).map(b => b.id)
    if (pending.length) get().reindex(pending)
  },

  refreshCounts: async () => {
    set({ annotationCounts: await bc.library.annotationCounts() })
  },

  importPaths: async paths => {
    const ui = useUi.getState()
    const toastId = ui.toast({ kind: 'progress', text: tNow('lib.importing') })
    try {
      const r = await bc.library.import(paths)
      set(s => ({ books: [...s.books, ...r.added] }))
      ui.dismiss(toastId)
      const parts: string[] = []
      if (r.added.length) parts.push(tNow('lib.added', { n: r.added.length }))
      if (r.duplicates.length) parts.push(tNow('lib.duplicates', { n: r.duplicates.length }))
      if (parts.length) ui.toast({ kind: r.added.length ? 'success' : 'info', text: parts.join(' · ') })
      if (r.failed.length) {
        const names = r.failed.map(f => f.path.split(/[\\/]/).pop()).slice(0, 3).join(', ')
        ui.toast({ kind: 'error', text: tNow('lib.failed', { names }) })
      }
      if (r.added.length) await get().reindex(r.added.map(b => b.id))
      return [...r.added, ...r.duplicates]
    } catch (e: any) {
      ui.dismiss(toastId)
      ui.toast({ kind: 'error', text: String(e?.message ?? e) })
      return []
    }
  },

  reindex: async ids => {
    const { extractMetadata } = await import('../formats/metadata')
    const ui = useUi.getState()
    const total = ids.length
    let toastId: number | undefined
    set({ indexing: { done: 0, total } })
    for (let i = 0; i < ids.length; i++) {
      if (total > 1) toastId = ui.toast({ kind: 'progress', text: tNow('lib.indexing', { done: i + 1, total }), progress: i / total }, toastId)
      const book = get().books.find(b => b.id === ids[i])
      if (!book) continue
      try {
        const { patch, cover, color } = await extractMetadata(book)
        if (cover) {
          await bc.book.saveCover(book.id, cover, color)
          patch.hasCover = true
          if (color) patch.coverColor = color
          set(s => ({ coverVersion: { ...s.coverVersion, [book.id]: Date.now() } }))
        }
        await get().update(book.id, { ...patch, indexed: true })
      } catch (e) {
        console.warn('index failed', book.fileName, e)
        await get().update(book.id, { indexed: true })
      }
      set({ indexing: { done: i + 1, total } })
    }
    if (toastId) ui.dismiss(toastId)
    set({ indexing: null })
  },

  update: async (id, patch) => {
    set(s => ({ books: s.books.map(b => (b.id === id ? { ...b, ...patch } : b)) }))
    await bc.library.update(id, patch)
  },

  remove: async ids => {
    set(s => ({ books: s.books.filter(b => !ids.includes(b.id)) }))
    await bc.library.remove(ids)
  },

  addCollection: name => {
    const c: Collection = { id: uid(), name, createdAt: Date.now() }
    const collections = [...get().collections, c]
    set({ collections })
    bc.library.setCollections(collections)
    return c
  },
  renameCollection: (id, name) => {
    const collections = get().collections.map(c => (c.id === id ? { ...c, name } : c))
    set({ collections })
    bc.library.setCollections(collections)
  },
  deleteCollection: id => {
    const collections = get().collections.filter(c => c.id !== id)
    set(s => ({
      collections,
      books: s.books.map(b => ({ ...b, collections: b.collections.filter(c => c !== id) })),
    }))
    bc.library.setCollections(collections)
  },
  toggleInCollection: (bookId, collectionId) => {
    const b = get().books.find(b => b.id === bookId)
    if (!b) return
    const has = b.collections.includes(collectionId)
    get().update(bookId, {
      collections: has ? b.collections.filter(c => c !== collectionId) : [...b.collections, collectionId],
    })
  },
}))
