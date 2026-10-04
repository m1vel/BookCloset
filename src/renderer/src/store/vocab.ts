import { create } from 'zustand'
import type { VocabEntry } from '../../../shared/types'
import { bc } from '../api'
import { newSrs, schedule, type Grade } from '../vocab/srs'

interface VocabState {
  entries: VocabEntry[]
  loaded: boolean
  /** bumps every minute so due counts refresh */
  now: number
  load: () => Promise<void>
  add: (e: Omit<VocabEntry, 'id' | 'createdAt' | 'srs'>) => VocabEntry
  update: (id: string, patch: Partial<VocabEntry>) => void
  remove: (id: string) => void
  grade: (id: string, g: Grade) => void
  find: (term: string, lang: string) => VocabEntry | undefined
}

const uid = () => Math.random().toString(36).slice(2, 11)
export const normTerm = (s: string) => s.trim().toLocaleLowerCase().replace(/\s+/g, ' ')

let loading: Promise<void> | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
const persist = (entries: VocabEntry[]) => {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => bc.vocab.set(entries), 250)
}

export const useVocab = create<VocabState>((set, get) => ({
  entries: [],
  loaded: false,
  now: Date.now(),
  load: () => (loading ??= (async () => {
    set({ entries: await bc.vocab.get(), loaded: true, now: Date.now() })
    setInterval(() => set({ now: Date.now() }), 60_000)
  })()),
  add: e => {
    const now = Date.now()
    const entry: VocabEntry = { ...e, id: uid(), createdAt: now, srs: newSrs(now) }
    const entries = [entry, ...get().entries]
    // new cards are due immediately: move the clock so counts include them
    set({ entries, now })
    persist(entries)
    return entry
  },
  update: (id, patch) => {
    const entries = get().entries.map(x => (x.id === id ? { ...x, ...patch } : x))
    set({ entries, now: Date.now() })
    persist(entries)
  },
  remove: id => {
    const entries = get().entries.filter(x => x.id !== id)
    set({ entries })
    persist(entries)
  },
  grade: (id, g) => {
    const now = Date.now()
    const entries = get().entries.map(x => (x.id === id ? { ...x, srs: schedule(x.srs, g, now) } : x))
    set({ entries, now })
    persist(entries)
  },
  find: (term, lang) => {
    const k = normTerm(term)
    return get().entries.find(x => x.lang === lang && normTerm(x.term) === k)
  },
}))

/** The sentence of `context` that contains `term` (falls back to a trimmed window). */
export function sentenceAround(context: string | undefined, term: string, lang: string) {
  if (!context) return undefined
  const text = context.replace(/\s+/g, ' ').trim()
  const at = text.toLocaleLowerCase().indexOf(term.trim().toLocaleLowerCase())
  if (at < 0) return text.length > 220 ? text.slice(0, 217) + '…' : text
  try {
    for (const { index, segment } of new Intl.Segmenter(lang, { granularity: 'sentence' }).segment(text)) {
      if (at >= index && at < index + segment.length) {
        const s = segment.trim()
        return s.length > 260 ? '…' + text.slice(Math.max(0, at - 110), at + term.length + 110).trim() + '…' : s
      }
    }
  } catch { /* unsupported locale */ }
  return text.slice(Math.max(0, at - 110), at + term.length + 110)
}

/** Anki import file (Notes in plain text, tab separated, HTML allowed, tags column). */
export function ankiExport(entries: VocabEntry[]) {
  const esc = (s: string) => s.replace(/[\t\r\n]+/g, ' ').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const bold = (ctx: string, term: string) => {
    const i = ctx.toLocaleLowerCase().indexOf(term.toLocaleLowerCase())
    return i < 0 ? esc(ctx) : `${esc(ctx.slice(0, i))}<b>${esc(ctx.slice(i, i + term.length))}</b>${esc(ctx.slice(i + term.length))}`
  }
  const lines = ['#separator:tab', '#html:true', '#tags column:3']
  for (const e of entries) {
    const back = [
      esc(e.translation),
      e.meanings ? `<br><small>${esc(e.meanings)}</small>` : '',
      e.context ? `<br><br><i>${bold(e.context, e.term)}</i>` : '',
      e.bookTitle ? `<br><small>— ${esc(e.bookTitle)}</small>` : '',
    ].join('')
    lines.push([esc(e.term), back, `bookcloset lang::${e.lang}`].join('\t'))
  }
  return lines.join('\n') + '\n'
}
