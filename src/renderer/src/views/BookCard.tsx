import { memo, type CSSProperties, type MouseEvent } from 'react'
import {
  Info, Heart, CheckCircle, BookOpen, FolderSimplePlus, FolderOpen, Export, Trash, ArrowCounterClockwise,
} from '@phosphor-icons/react'
import type { BookRecord } from '../../../shared/types'
import { FORMAT_LABEL } from '../../../shared/formats'
import { Cover } from '../components/Cover'
import { useT, formatBytes, formatDate } from '../i18n'
import { useUi } from '../store/ui'
import { useLibrary } from '../store/library'
import { useSettings } from '../store/settings'
import { bc } from '../api'
import { Popover, MenuItem, MenuSep } from '../components/ui'
import { openBookById } from './open'

export const BookCard = memo(function BookCard({ book, index, onContext }: {
  book: BookRecord; index: number; onContext: (e: MouseEvent) => void
}) {
  const t = useT()
  const showDetails = useUi(s => s.showDetails)
  const pct = Math.round(book.progress * 100)
  return (
    <article
      className="book-card"
      style={{ '--i': Math.min(index, 24) } as CSSProperties}
      onContextMenu={e => { e.preventDefault(); onContext(e) }}
    >
      <div className="book-card-cover">
        <button className="cover-btn" onClick={() => openBookById(book.id)} aria-label={`${t('book.read')}: ${book.title}`}>
          <Cover book={book} />
          {!book.indexed && <span className="cover-shimmer" />}
        </button>
        <div className="card-badges">
          {book.status === 'new' && <span className="ribbon">{t('lib.newLabel')}</span>}
          {book.favorite && <span className="fav-dot" aria-label={t('nav.favorites')}><Heart size={12} weight="fill" /></span>}
        </div>
        <button className="card-info" aria-label={t('book.details')} data-tip={t('book.details')}
          onClick={e => { e.stopPropagation(); showDetails(book.id) }}>
          <Info size={16} weight="bold" />
        </button>
        <span className="card-format">{FORMAT_LABEL[book.format]}</span>
        <span className="shelf-plank" aria-hidden="true" />
      </div>
      <div className="book-card-meta">
        {book.status === 'finished' ? (
          <div className="card-progress done"><CheckCircle size={13} weight="fill" /> {t('lib.finishedLabel')}</div>
        ) : book.progress > 0 ? (
          <div className="card-progress">
            <div className="progress-line"><i style={{ width: `${Math.max(pct, 2)}%` }} /></div>
            <span className="tabular">{pct}%</span>
          </div>
        ) : null}
        <h3 className="card-title clamp-2" title={book.title}>{book.title}</h3>
        <div className="card-author truncate">{book.authors.join(', ') || t('lib.unknownAuthor')}</div>
      </div>
    </article>
  )
})

export const BookRow = memo(function BookRow({ book, onContext }: { book: BookRecord; onContext: (e: MouseEvent) => void }) {
  const t = useT()
  const lang = useSettings(s => s.settings.lang)
  const showDetails = useUi(s => s.showDetails)
  const pct = Math.round(book.progress * 100)
  return (
    <div className="book-row" role="button" tabIndex={0}
      onClick={() => openBookById(book.id)}
      onKeyDown={e => e.key === 'Enter' && openBookById(book.id)}
      onContextMenu={e => { e.preventDefault(); onContext(e) }}>
      <Cover book={book} className="row-cover" />
      <div className="row-main">
        <div className="row-title truncate">{book.title}</div>
        <div className="row-author truncate">{book.authors.join(', ') || t('lib.unknownAuthor')}</div>
      </div>
      <span className="badge">{FORMAT_LABEL[book.format]}</span>
      <div className="row-progress">
        {book.status === 'finished'
          ? <span className="done"><CheckCircle size={14} weight="fill" /> {t('lib.finishedLabel')}</span>
          : <><div className="progress-line"><i style={{ width: `${pct}%` }} /></div><span className="tabular">{pct}%</span></>}
      </div>
      <span className="row-date faint tabular">{book.openedAt ? formatDate(book.openedAt, lang) : '—'}</span>
      <span className="row-size faint tabular">{formatBytes(book.size)}</span>
      <button className="icon-btn sm" aria-label={t('book.details')} onClick={e => { e.stopPropagation(); showDetails(book.id) }}>
        <Info size={16} />
      </button>
    </div>
  )
})

export function BookContextMenu({ book, at, onClose }: { book: BookRecord; at: { x: number; y: number }; onClose: () => void }) {
  const t = useT()
  const lib = useLibrary()
  const ui = useUi.getState()
  const run = (fn: () => void) => () => { onClose(); fn() }
  return (
    <Popover anchor={at} open onClose={onClose} placement="bottom-start" offset={2}>
      <MenuItem icon={<BookOpen size={16} />} onClick={run(() => openBookById(book.id))}>{t('book.read')}</MenuItem>
      <MenuItem icon={<Info size={16} />} onClick={run(() => ui.showDetails(book.id))}>{t('book.details')}</MenuItem>
      <MenuSep />
      <MenuItem icon={<Heart size={16} weight={book.favorite ? 'fill' : 'regular'} />}
        onClick={run(() => lib.update(book.id, { favorite: !book.favorite }))}>
        {book.favorite ? t('book.unfavorite') : t('book.favorite')}
      </MenuItem>
      {book.status !== 'finished'
        ? <MenuItem icon={<CheckCircle size={16} />} onClick={run(() => lib.update(book.id, { status: 'finished', progress: 1, finishedAt: Date.now() }))}>{t('book.markFinished')}</MenuItem>
        : <MenuItem icon={<ArrowCounterClockwise size={16} />} onClick={run(() => lib.update(book.id, { status: 'new', progress: 0, location: undefined, finishedAt: undefined }))}>{t('book.markUnread')}</MenuItem>}
      {lib.collections.length > 0 && (
        <>
          <MenuSep />
          <div className="menu-label eyebrow">{t('book.addToCollection')}</div>
          {lib.collections.map(c => (
            <MenuItem key={c.id} icon={<FolderSimplePlus size={16} />} checked={book.collections.includes(c.id)}
              onClick={() => lib.toggleInCollection(book.id, c.id)}>{c.name}</MenuItem>
          ))}
        </>
      )}
      <MenuSep />
      <MenuItem icon={<FolderOpen size={16} />} onClick={run(() => bc.book.reveal(book.id))}>{t('book.reveal')}</MenuItem>
      <MenuItem icon={<Export size={16} />} onClick={run(() => bc.book.export(book.id))}>{t('book.export')}</MenuItem>
      <MenuSep />
      <MenuItem danger icon={<Trash size={16} />} onClick={run(async () => {
        const ok = await ui.confirm({ title: t('book.delete'), text: t('book.deleteConfirm', { title: book.title }), confirm: t('common.delete'), danger: true })
        if (ok) lib.remove([book.id])
      })}>{t('book.delete')}</MenuItem>
    </Popover>
  )
}
