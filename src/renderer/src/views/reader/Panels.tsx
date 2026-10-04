import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ListBullets, Quotes, BookmarkSimple, MagnifyingGlass, CaretRight, Trash, X, Export, PencilSimple, NotePencil,
} from '@phosphor-icons/react'
import type { Annotation } from '../../../../shared/types'
import type { TocItem } from '../../formats/types'
import type { EngineController, SearchHit } from '../../engines/types'
import { HIGHLIGHT_COLORS } from '../../engines/types'
import { useT, formatDate } from '../../i18n'
import { useSettings } from '../../store/settings'
import { IconButton } from '../../components/ui'

export type PanelTab = 'toc' | 'notes' | 'bookmarks' | 'search'

interface Props {
  tab: PanelTab
  setTab: (t: PanelTab) => void
  onClose: () => void
  toc: TocItem[]
  currentChapter?: string
  annotations: Annotation[]
  controller: EngineController | null
  onNavigate: (target: string | number) => void
  onDelete: (id: string) => void
  onEditNote: (a: Annotation) => void
  onExport: () => void
  search: SearchState
  setSearch: (s: SearchState) => void
  paged: boolean
  /** bump to run the search for `search.query` right away */
  searchNonce: number
}

export interface SearchState {
  query: string
  hits: SearchHit[]
  progress: number
  running: boolean
  activeId?: string
}

function TocTree({ items, current, onNavigate, depth = 0 }: { items: TocItem[]; current?: string; onNavigate: (t: string | number) => void; depth?: number }) {
  return (
    <ul className="toc-list" role={depth ? 'group' : 'tree'}>
      {items.map((it, i) => <TocNode key={i} item={it} current={current} onNavigate={onNavigate} depth={depth} />)}
    </ul>
  )
}

function containsLabel(it: TocItem, label?: string): boolean {
  if (!label) return false
  return it.label === label || !!it.subitems?.some(s => containsLabel(s, label))
}

function TocNode({ item, current, onNavigate, depth }: { item: TocItem; current?: string; onNavigate: (t: string | number) => void; depth: number }) {
  const hasKids = !!item.subitems?.length
  const [open, setOpen] = useState(() => depth === 0 && containsLabel(item, current))
  const active = item.label === current
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => { if (active) ref.current?.scrollIntoView({ block: 'center' }) }, [])
  return (
    <li role="treeitem" aria-expanded={hasKids ? open : undefined}>
      <div className={`toc-item ${active ? 'active' : ''}`} style={{ paddingLeft: 10 + depth * 16 }}>
        {hasKids ? (
          <button className={`toc-caret ${open ? 'open' : ''}`} aria-label="toggle" onClick={() => setOpen(!open)}>
            <CaretRight size={12} weight="bold" />
          </button>
        ) : <span className="toc-caret-spacer" />}
        <button ref={ref} className="toc-label" disabled={item.href === ''} onClick={() => onNavigate(item.href)}>
          {item.label || '—'}
        </button>
      </div>
      {hasKids && open && <TocTree items={item.subitems!} current={current} onNavigate={onNavigate} depth={depth + 1} />}
    </li>
  )
}

export function ReaderPanel(p: Props) {
  const t = useT()
  const lang = useSettings(s => s.settings.lang)
  const notes = useMemo(() => p.annotations.filter(a => a.kind !== 'bookmark')
    .sort((a, b) => (a.page ?? 0) - (b.page ?? 0) || (a.progress ?? 0) - (b.progress ?? 0)), [p.annotations])
  const bookmarks = useMemo(() => p.annotations.filter(a => a.kind === 'bookmark')
    .sort((a, b) => (a.page ?? 0) - (b.page ?? 0) || (a.progress ?? 0) - (b.progress ?? 0)), [p.annotations])
  const inputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => { if (p.tab === 'search') setTimeout(() => inputRef.current?.focus(), 50) }, [p.tab])

  const runSearch = async (q: string) => {
    abortRef.current?.abort()
    p.controller?.clearSearch()
    if (!q.trim() || q.trim().length < 2) { p.setSearch({ query: q, hits: [], progress: 0, running: false }); return }
    const ctrl = new AbortController()
    abortRef.current = ctrl
    let hits: SearchHit[] = []
    p.setSearch({ query: q, hits: [], progress: 0, running: true })
    await p.controller?.search(q,
      h => { hits = [...hits, ...h]; if (!ctrl.signal.aborted) p.setSearch({ query: q, hits, progress: 0, running: true }) },
      pr => { if (!ctrl.signal.aborted) p.setSearch({ query: q, hits, progress: pr, running: pr < 1 }) },
      ctrl.signal)
    if (!ctrl.signal.aborted) p.setSearch({ query: q, hits, progress: 1, running: false })
  }

  useEffect(() => {
    if (p.searchNonce) runSearch(p.search.query)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.searchNonce])
  useEffect(() => () => abortRef.current?.abort(), [])

  const grouped = useMemo(() => {
    const out: { section: string; hits: SearchHit[] }[] = []
    for (const h of p.search.hits) {
      const s = h.section ?? ''
      const last = out[out.length - 1]
      if (last && last.section === s) last.hits.push(h)
      else out.push({ section: s, hits: [h] })
    }
    return out
  }, [p.search.hits])

  const tabs: { id: PanelTab; icon: React.ReactNode; label: string; count?: number }[] = [
    { id: 'toc', icon: <ListBullets size={17} />, label: t('reader.toc') },
    { id: 'notes', icon: <Quotes size={17} />, label: t('reader.notes'), count: notes.length },
    { id: 'bookmarks', icon: <BookmarkSimple size={17} />, label: t('reader.bookmarks'), count: bookmarks.length },
    { id: 'search', icon: <MagnifyingGlass size={17} />, label: t('reader.search') },
  ]

  return (
    <aside className="reader-panel" aria-label={tabs.find(x => x.id === p.tab)?.label}>
      <div className="rp-head">
        <div className="rp-tabs" role="tablist">
          {tabs.map(tb => (
            <button key={tb.id} role="tab" aria-selected={p.tab === tb.id} className={`rp-tab ${p.tab === tb.id ? 'on' : ''}`}
              data-tip={tb.label} onClick={() => p.setTab(tb.id)}>
              {tb.icon}
              {!!tb.count && <span className="rp-count">{tb.count}</span>}
            </button>
          ))}
        </div>
        <IconButton label={t('common.close')} size="sm" onClick={p.onClose}><X size={16} /></IconButton>
      </div>
      <h3 className="rp-title display">{tabs.find(x => x.id === p.tab)?.label}</h3>

      <div className="rp-body">
        {p.tab === 'toc' && (p.toc.length
          ? <TocTree items={p.toc} current={p.currentChapter} onNavigate={p.onNavigate} />
          : <div className="rp-empty">{t('reader.noToc')}</div>)}

        {p.tab === 'notes' && (
          <>
            {notes.length > 0 && (
              <button className="btn sm rp-export" onClick={p.onExport}><Export size={14} /> {t('reader.exportNotes')}</button>
            )}
            {!notes.length && <div className="rp-empty"><NotePencil size={28} weight="duotone" /><p>{t('reader.noNotes')}</p></div>}
            <div className="note-list">
              {notes.map(a => (
                <article key={a.id} className="note-card" onClick={() => p.onNavigate(a.cfi ?? a.page ?? 0)}>
                  <div className="note-quote" style={{ '--hl': HIGHLIGHT_COLORS[a.color ?? 'yellow'] } as React.CSSProperties}>
                    {a.text}
                  </div>
                  {a.note && <div className="note-text">{a.note}</div>}
                  <div className="note-meta">
                    <span className="truncate">{a.chapter ?? (a.page != null ? `${a.page + 1}` : '')}</span>
                    <span className="note-actions">
                      <button className="icon-btn sm" aria-label={t('reader.note')} data-tip={t('reader.note')}
                        onClick={e => { e.stopPropagation(); p.onEditNote(a) }}><PencilSimple size={14} /></button>
                      <button className="icon-btn sm" aria-label={t('common.delete')} data-tip={t('common.delete')}
                        onClick={e => { e.stopPropagation(); p.onDelete(a.id) }}><Trash size={14} /></button>
                    </span>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}

        {p.tab === 'bookmarks' && (
          <>
            {!bookmarks.length && <div className="rp-empty"><BookmarkSimple size={28} weight="duotone" /><p>{t('reader.noBookmarks')}</p></div>}
            <div className="note-list">
              {bookmarks.map(a => (
                <article key={a.id} className="bm-card" onClick={() => p.onNavigate(a.cfi ?? a.page ?? 0)}>
                  <BookmarkSimple size={16} weight="fill" className="bm-icon" />
                  <div className="bm-main">
                    <div className="bm-title truncate">{a.chapter || (a.page != null ? `${t('book.pages')}: ${a.page + 1}` : '')}</div>
                    {a.text && <div className="bm-text clamp-2">{a.text}</div>}
                    <div className="faint bm-date">{formatDate(a.createdAt, lang)} · {Math.round((a.progress ?? 0) * 100)}%</div>
                  </div>
                  <button className="icon-btn sm" aria-label={t('common.delete')}
                    onClick={e => { e.stopPropagation(); p.onDelete(a.id) }}><Trash size={14} /></button>
                </article>
              ))}
            </div>
          </>
        )}

        {p.tab === 'search' && (
          <div className="search-pane">
            <form className="search-field" onSubmit={e => { e.preventDefault(); runSearch(p.search.query) }}>
              <MagnifyingGlass size={16} />
              <input ref={inputRef} className="input" placeholder={t('reader.searchPlaceholder')} value={p.search.query}
                onChange={e => p.setSearch({ ...p.search, query: e.target.value })}
                onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); p.onClose() } }} />
            </form>
            {(p.search.running || p.search.hits.length > 0 || p.search.progress === 1) && (
              <div className="search-status">
                <span>{p.search.running ? t('reader.searching') : p.search.hits.length ? t('reader.searchResults', { n: p.search.hits.length }) : t('reader.searchNone')}</span>
                {p.search.running && <div className="progress-line"><i style={{ width: `${Math.round(p.search.progress * 100)}%` }} /></div>}
              </div>
            )}
            <div className="hit-list">
              {grouped.map((g, gi) => (
                <section key={gi}>
                  {g.section && <div className="hit-section eyebrow truncate">{g.section}</div>}
                  {g.hits.map(h => (
                    <button key={h.id} className={`hit ${p.search.activeId === h.id ? 'active' : ''}`} onClick={() => {
                      p.setSearch({ ...p.search, activeId: h.id })
                      p.controller?.showSearchHit(h)
                    }}>
                      {p.paged && <span className="hit-page tabular">{Number(h.target) + 1}</span>}
                      <span className="hit-text">
                        {h.excerpt.pre}<mark>{h.excerpt.match}</mark>{h.excerpt.post}
                      </span>
                    </button>
                  ))}
                </section>
              ))}
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}
