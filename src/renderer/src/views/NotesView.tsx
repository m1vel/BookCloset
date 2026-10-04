import { useEffect, useMemo, useState } from 'react'
import { MagnifyingGlass, Quotes, X, Export, ImageSquare } from '@phosphor-icons/react'
import type { Annotation } from '../../../shared/types'
import { bc } from '../api'
import { useLibrary } from '../store/library'
import { useSettings } from '../store/settings'
import { useT, formatDate } from '../i18n'
import { HIGHLIGHT_COLORS } from '../engines/types'
import { Cover } from '../components/Cover'
import { IconButton } from '../components/ui'
import { openBookById } from './open'
import { useUi } from '../store/ui'

/** All highlights & notes across the library, grouped by book. */
export default function NotesView() {
  const t = useT()
  const lang = useSettings(s => s.settings.lang)
  const books = useLibrary(s => s.books)
  const counts = useLibrary(s => s.annotationCounts)
  const [all, setAll] = useState<Annotation[] | null>(null)
  const [q, setQ] = useState('')

  useEffect(() => {
    const ids = Object.keys(counts).filter(id => counts[id] > 0)
    Promise.all(ids.map(id => bc.annotations.get(id))).then(lists => setAll(lists.flat().filter(a => a.kind !== 'bookmark')))
  }, [counts])

  const groups = useMemo(() => {
    if (!all) return []
    const needle = q.trim().toLocaleLowerCase()
    const filtered = needle ? all.filter(a => `${a.text} ${a.note ?? ''}`.toLocaleLowerCase().includes(needle)) : all
    const map = new Map<string, Annotation[]>()
    for (const a of filtered) map.set(a.bookId, [...(map.get(a.bookId) ?? []), a])
    return [...map.entries()]
      .map(([id, list]) => ({ book: books.find(b => b.id === id), list: list.sort((a, b) => (a.progress ?? 0) - (b.progress ?? 0)) }))
      .filter(g => g.book)
      .sort((a, b) => Math.max(...b.list.map(x => x.updatedAt)) - Math.max(...a.list.map(x => x.updatedAt)))
  }, [all, q, books])

  const exportAll = () => {
    let md = `# BookCloset — ${t('nav.notes')}\n\n`
    for (const g of groups) {
      md += `## ${g.book!.title}${g.book!.authors.length ? ` — ${g.book!.authors.join(', ')}` : ''}\n\n`
      for (const a of g.list) md += `> ${(a.text ?? '').replace(/\n+/g, '\n> ')}\n\n${a.note ? a.note + '\n\n' : ''}`
    }
    bc.saveText('BookCloset notes.md', md)
  }

  return (
    <div className="notes-view">
      <header className="lib-header drag-region">
        <div className="lib-title">
          <span className="eyebrow">{all ? t('notes.count', { n: all.length }) : ''}</span>
          <h1 className="display">{t('nav.notes')}</h1>
        </div>
        <div className="lib-tools no-drag">
          <div className="search-field lib-search">
            <MagnifyingGlass size={16} />
            <input className="input" placeholder={t('lib.search')} value={q} onChange={e => setQ(e.target.value)} />
            {q && <IconButton size="sm" className="clear" label={t('common.close')} onClick={() => setQ('')}><X size={14} /></IconButton>}
          </div>
          {groups.length > 0 && <button className="btn" onClick={exportAll}><Export size={16} /> {t('common.export')}</button>}
        </div>
      </header>
      <div className="lib-scroll">
        {all && !groups.length && (
          <div className="empty rise-in"><Quotes size={44} weight="duotone" /><h3 className="display">{t('reader.noNotes')}</h3></div>
        )}
        <div className="notes-groups">
          {groups.map(({ book, list }) => (
            <section key={book!.id} className="notes-group rise-in">
              <button className="ng-book" onClick={() => openBookById(book!.id)}>
                <Cover book={book!} />
              </button>
              <div className="ng-main">
                <h2 className="display ng-title">{book!.title}</h2>
                <div className="muted ng-author">{book!.authors.join(', ')}</div>
                <div className="ng-list">
                  {list.map(a => (
                    <div key={a.id} className="ng-item">
                      <button className="ng-quote" onClick={() => openBookById(book!.id, a.cfi ?? a.page)}>
                        <blockquote style={{ '--hl': HIGHLIGHT_COLORS[a.color ?? 'yellow'] } as React.CSSProperties}>{a.text}</blockquote>
                        {a.note && <p className="ng-note">{a.note}</p>}
                        <span className="faint ng-meta">{a.chapter ? `${a.chapter} · ` : ''}{formatDate(a.createdAt, lang)}</span>
                      </button>
                      {a.text && (
                        <IconButton size="sm" className="ng-card" label={t('quote.make')}
                          onClick={() => useUi.getState().showQuoteCard({ bookId: book!.id, text: a.text!, chapter: a.chapter })}>
                          <ImageSquare size={16} />
                        </IconButton>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
