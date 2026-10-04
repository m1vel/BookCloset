import { useEffect, useState } from 'react'
import {
  X, Play, Heart, FolderOpen, Export, Trash, PencilSimple, CheckCircle, ArrowCounterClockwise,
} from '@phosphor-icons/react'
import { useLibrary } from '../store/library'
import { useUi } from '../store/ui'
import { useSettings } from '../store/settings'
import { useT, formatBytes, formatDate, formatDuration } from '../i18n'
import { FORMAT_LABEL } from '../../../shared/formats'
import { bc } from '../api'
import { Cover } from '../components/Cover'
import { IconButton } from '../components/ui'
import { openBookById } from './open'
import { sanitizeHtml } from '../formats/sanitize'

export function BookDetails({ bookId }: { bookId: string }) {
  const t = useT()
  const lang = useSettings(s => s.settings.lang)
  const book = useLibrary(s => s.books.find(b => b.id === bookId))
  const counts = useLibrary(s => s.annotationCounts)
  const collections = useLibrary(s => s.collections)
  const close = () => useUi.getState().showDetails(null)
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState('')
  const [authors, setAuthors] = useState('')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !editing) close() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [editing])

  if (!book) return null
  const lib = useLibrary.getState()
  const pct = Math.round(book.progress * 100)

  const rows: [string, string | undefined][] = [
    [t('book.format'), FORMAT_LABEL[book.format]],
    [t('book.size'), formatBytes(book.size)],
    [t('book.pages'), book.pageCount ? String(book.pageCount) : undefined],
    [t('book.language'), book.language],
    [t('book.publisher'), book.publisher],
    [t('book.published'), book.published?.slice(0, 4)],
    [t('book.series'), book.series ? `${book.series}${book.seriesIndex ? ` #${book.seriesIndex}` : ''}` : undefined],
    [t('book.added'), formatDate(book.addedAt, lang)],
    [t('book.opened'), book.openedAt ? formatDate(book.openedAt, lang) : undefined],
    [t('book.timeRead'), book.readingSeconds > 30 ? formatDuration(book.readingSeconds, lang) : undefined],
    [t('book.highlights'), counts[book.id] ? String(counts[book.id]) : undefined],
    [t('book.file'), book.fileName],
  ]

  const startEdit = () => {
    setTitle(book.title)
    setAuthors(book.authors.join(', '))
    setEditing(true)
  }
  const saveEdit = () => {
    lib.update(book.id, { title: title.trim() || book.title, authors: authors.split(',').map(s => s.trim()).filter(Boolean) })
    setEditing(false)
  }

  return (
    <div className="drawer-backdrop" onPointerDown={e => e.target === e.currentTarget && close()}>
      <aside className="drawer details" role="dialog" aria-label={book.title}>
        <div className="drawer-head">
          <IconButton label={t('common.close')} onClick={close}><X size={18} /></IconButton>
        </div>
        <div className="details-body">
          <div className="details-cover"><Cover book={book} /></div>
          {editing ? (
            <form className="details-edit" onSubmit={e => { e.preventDefault(); saveEdit() }}>
              <div className="field"><label>{t('book.title')}</label>
                <input className="input" autoFocus value={title} onChange={e => setTitle(e.target.value)} /></div>
              <div className="field"><label>{t('book.authors')}</label>
                <input className="input" value={authors} onChange={e => setAuthors(e.target.value)} /></div>
              <div className="dialog-actions" style={{ marginTop: 4 }}>
                <button type="button" className="btn ghost" onClick={() => setEditing(false)}>{t('common.cancel')}</button>
                <button type="submit" className="btn primary">{t('book.save')}</button>
              </div>
            </form>
          ) : (
            <div className="details-titles">
              <h2 className="display">{book.title}</h2>
              <div className="muted">{book.authors.join(', ') || t('lib.unknownAuthor')}</div>
              <button className="btn ghost sm details-edit-btn" onClick={startEdit}><PencilSimple size={14} /> {t('book.edit')}</button>
            </div>
          )}
          <div className="details-actions">
            <button className="btn primary lg" onClick={() => { close(); openBookById(book.id) }}>
              <Play size={16} weight="fill" /> {book.progress > 0 ? t('lib.continueBtn') : t('lib.startBtn')}
            </button>
            <IconButton size="lg" label={book.favorite ? t('book.unfavorite') : t('book.favorite')} active={book.favorite}
              onClick={() => lib.update(book.id, { favorite: !book.favorite })}>
              <Heart size={20} weight={book.favorite ? 'fill' : 'regular'} />
            </IconButton>
            {book.status !== 'finished'
              ? <IconButton size="lg" label={t('book.markFinished')} onClick={() => lib.update(book.id, { status: 'finished', progress: 1, finishedAt: Date.now() })}><CheckCircle size={20} /></IconButton>
              : <IconButton size="lg" label={t('book.markUnread')} onClick={() => lib.update(book.id, { status: 'new', progress: 0, location: undefined })}><ArrowCounterClockwise size={20} /></IconButton>}
          </div>
          {book.progress > 0 && (
            <div className="details-progress">
              <div className="progress-line"><i style={{ width: `${pct}%` }} /></div>
              <span className="tabular faint">{pct}%</span>
            </div>
          )}
          {collections.length > 0 && (
            <div className="chips">
              {collections.map(c => (
                <button key={c.id} className={`chip ${book.collections.includes(c.id) ? 'on' : ''}`}
                  onClick={() => lib.toggleInCollection(book.id, c.id)}>{c.name}</button>
              ))}
            </div>
          )}
          {book.description && (
            <section className="details-desc">
              <span className="eyebrow">{t('book.description')}</span>
              <div className="desc-html" dangerouslySetInnerHTML={{ __html: sanitizeHtml(book.description) }} />
            </section>
          )}
          <dl className="details-meta">
            {rows.filter(r => r[1]).map(([k, v]) => (
              <div key={k}><dt>{k}</dt><dd className="truncate" title={v}>{v}</dd></div>
            ))}
          </dl>
          <div className="details-foot">
            <button className="btn ghost sm" onClick={() => bc.book.reveal(book.id)}><FolderOpen size={15} /> {t('book.reveal')}</button>
            <button className="btn ghost sm" onClick={() => bc.book.export(book.id)}><Export size={15} /> {t('book.export')}</button>
            <button className="btn ghost sm danger-text" onClick={async () => {
              const ok = await useUi.getState().confirm({ title: t('book.delete'), text: t('book.deleteConfirm', { title: book.title }), confirm: t('common.delete'), danger: true })
              if (ok) { close(); lib.remove([book.id]) }
            }}><Trash size={15} /> {t('common.delete')}</button>
          </div>
        </div>
      </aside>
    </div>
  )
}
