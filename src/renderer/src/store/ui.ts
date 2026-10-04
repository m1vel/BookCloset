import { create } from 'zustand'

export type Route =
  | { name: 'library'; filter?: LibraryFilter }
  | { name: 'reader'; bookId: string; target?: string | number }
  | { name: 'stats' }
  | { name: 'settings' }
  | { name: 'notes' }

export type LibraryFilter =
  | { kind: 'all' } | { kind: 'reading' } | { kind: 'unread' } | { kind: 'finished' }
  | { kind: 'favorites' } | { kind: 'collection'; id: string } | { kind: 'format'; format: string }
  /** `key` is authorKey()/seriesKey(); `label` is shown as the page title */
  | { kind: 'author'; key: string; label: string } | { kind: 'series'; key: string; label: string }

export interface Toast {
  id: number
  kind: 'info' | 'success' | 'error' | 'progress'
  text: string
  sub?: string
  progress?: number
  action?: { label: string; run: () => void }
  sticky?: boolean
}

export interface ConfirmRequest {
  title: string
  text?: string
  confirm: string
  danger?: boolean
  resolve: (ok: boolean) => void
}

export interface QuoteCardRequest {
  bookId: string
  text: string
  chapter?: string
}

export interface PromptRequest {
  title: string
  label: string
  value: string
  confirm: string
  resolve: (value: string | null) => void
}

interface UiState {
  route: Route
  lastLibraryRoute: Route
  toasts: Toast[]
  confirmReq: ConfirmRequest | null
  promptReq: PromptRequest | null
  detailsBookId: string | null
  quoteCard: QuoteCardRequest | null
  fullscreen: boolean
  navigate: (r: Route) => void
  toast: (t: Omit<Toast, 'id'>, id?: number) => number
  dismiss: (id: number) => void
  confirm: (r: Omit<ConfirmRequest, 'resolve'>) => Promise<boolean>
  prompt: (r: Omit<PromptRequest, 'resolve'>) => Promise<string | null>
  showDetails: (id: string | null) => void
  showQuoteCard: (r: QuoteCardRequest | null) => void
}

let toastSeq = 1
const timers = new Map<number, ReturnType<typeof setTimeout>>()

export const useUi = create<UiState>((set, get) => ({
  route: { name: 'library', filter: { kind: 'all' } },
  lastLibraryRoute: { name: 'library', filter: { kind: 'all' } },
  toasts: [],
  confirmReq: null,
  promptReq: null,
  detailsBookId: null,
  quoteCard: null,
  fullscreen: false,
  navigate: r => set(s => ({
    route: r,
    lastLibraryRoute: s.route.name !== 'reader' ? s.route : s.lastLibraryRoute,
    detailsBookId: null,
  })),
  toast: (t, existing) => {
    const id = existing ?? toastSeq++
    set(s => {
      const others = s.toasts.filter(x => x.id !== id)
      return { toasts: [...others, { ...t, id }].slice(-4) }
    })
    if (timers.has(id)) clearTimeout(timers.get(id))
    if (!t.sticky && t.kind !== 'progress') {
      timers.set(id, setTimeout(() => get().dismiss(id), t.kind === 'error' ? 7000 : 4000))
    }
    return id
  },
  dismiss: id => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })),
  confirm: r => new Promise(resolve => set({
    confirmReq: { ...r, resolve: ok => { set({ confirmReq: null }); resolve(ok) } },
  })),
  prompt: r => new Promise(resolve => set({
    promptReq: { ...r, resolve: v => { set({ promptReq: null }); resolve(v) } },
  })),
  showDetails: id => set({ detailsBookId: id }),
  showQuoteCard: r => set({ quoteCard: r }),
}))
