import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  MagnifyingGlass, Plus, SquaresFour, Rows, SortAscending, X, Play, FolderPlus, FilePlus, CaretDown, ImageSquare,
} from '@phosphor-icons/react'
import type { BookRecord } from '../../../shared/types'
import { useLibrary } from '../store/library'
import { useSettings } from '../store/settings'
import { useUi, type LibraryFilter } from '../store/ui'
import { useT, formatDuration, type TKey } from '../i18n'
import { bc } from '../api'
import { Cover } from '../components/Cover'
import { IconButton, Popover, MenuItem, MenuSep, Segmented } from '../components/ui'
import { bookHasAuthor, seriesKey, groupBooks, type BookGroup } from '../library/series'
import { BookCard, BookRow, BookContextMenu } from './BookCard'
import { openBookById } from './open'
import { EmptyShelf } from './EmptyShelf'
import { findMissingCovers } from '../library/online'

export function greetingKey(): TKey {
  const h = new Date().getHours()
  if (h < 5) return 'greet.night'
  if (h < 12) return 'greet.morning'
  if (h < 18) return 'greet.day'
  if (h < 23) return 'greet.evening'
  return 'greet.night'
}

export const bookTimeLeft = (b: BookRecord) =>
  b.progress > 0.02 && b.progress < 1 && b.readingSeconds > 60
    ? (b.readingSeconds / b.progress) * (1 - b.progress) : null

const norm = (s: string) => s.toLocaleLowerCase().replace(/ё/g, 'е')

export function LibraryView({ filter }: { filter: LibraryFilter }) {
  const t = useT()
  const books = useLibrary(s => s.books)
  const collections = useLibrary(s => s.collections)
  const lang = useSettings(s => s.settings.lang)
  const libPrefs = useSettings(s => s.settings.library)
  const update = useSettings(s => s.update)
  const [query, setQuery] = useState('')
  const [sortEl, setSortEl] = useState<HTMLElement | null>(null)
  const [addEl, setAddEl] = useState<HTMLElement | null>(null)
  const [ctx, setCtx] = useState<{ book: BookRecord; x: number; y: number } | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const filterKey = JSON.stringify(filter)
  // a different list starts at the top
  useEffect(() => { scrollRef.current?.scrollTo(0, 0) }, [filterKey])

  const filtered = useMemo(() => {
    let list = books
    switch (filter.kind) {
      case 'reading': list = list.filter(b => b.status === 'reading'); break
      case 'unread': list = list.filter(b => b.status === 'new'); break
      case 'finished': list = list.filter(b => b.status === 'finished'); break
      case 'favorites': list = list.filter(b => b.favorite); break
      case 'collection': list = list.filter(b => b.collections.includes(filter.id)); break
      case 'format': list = list.filter(b => b.format === filter.format); break
      case 'author': list = list.filter(b => bookHasAuthor(b, filter.key)); break
      case 'series': list = list.filter(b => b.series && seriesKey(b.series) === filter.key); break
    }
    if (query.trim()) {
      const q = norm(query.trim())
      list = list.filter(b => norm(`${b.title} ${b.authors.join(' ')} ${b.series ?? ''} ${b.fileName}`).includes(q))
    }
    const collator = new Intl.Collator(lang, { numeric: true, sensitivity: 'base' })
    const sorted = [...list]
    // a series page always follows the reading order of the series
    if (filter.kind === 'series') return sorted.sort((a, b) => (a.seriesIndex ?? 1e9) - (b.seriesIndex ?? 1e9) || collator.compare(a.title, b.title))
    switch (libPrefs.sort) {
      case 'recent': sorted.sort((a, b) => (b.openedAt ?? 0) - (a.openedAt ?? 0) || b.addedAt - a.addedAt); break
      case 'added': sorted.sort((a, b) => b.addedAt - a.addedAt); break
      case 'title': sorted.sort((a, b) => collator.compare(a.title, b.title)); break
      case 'author': sorted.sort((a, b) => collator.compare(a.authors[0] ?? '\uFFFF', b.authors[0] ?? '\uFFFF') || collator.compare(a.title, b.title)); break
      case 'progress': sorted.sort((a, b) => b.progress - a.progress); break
    }
    return sorted
  }, [books, filter, query, libPrefs.sort, lang])

  const reading = useMemo(() => books
    .filter(b => b.status === 'reading' && b.openedAt)
    .sort((a, b) => (b.openedAt ?? 0) - (a.openedAt ?? 0)), [books])

  const showHero = filter.kind === 'all' && !query && reading.length > 0
  const hero = reading[0]

  const title = filter.kind === 'collection'
    ? collections.find(c => c.id === filter.id)?.name ?? ''
    : filter.kind === 'author' || filter.kind === 'series' ? filter.label
      : t(({ all: 'lib.allBooks', reading: 'nav.reading', unread: 'nav.unread', finished: 'nav.finished', favorites: 'nav.favorites', format: 'nav.formats' } as const)[filter.kind])
  const eyebrow = filter.kind === 'author' ? `${t('lib.authorPage')} · ${t('lib.books', { n: filtered.length })}`
    : filter.kind === 'series' ? `${t('lib.seriesPage')} · ${t('lib.books', { n: filtered.length })}`
      : t('lib.books', { n: filtered.length })
  // grouping applies to the general lists, not to an author or series page
  const groupBy = filter.kind === 'author' || filter.kind === 'series' || query ? 'none' : libPrefs.group
  const groups = useMemo(() => (groupBy === 'none' ? null : groupBooks(filtered, groupBy, lang)), [filtered, groupBy, lang])
  const openGroup = (g: BookGroup) => {
    if (!g.key) return
    useUi.getState().navigate({ name: 'library', filter: groupBy === 'author' ? { kind: 'author', key: g.key, label: g.label } : { kind: 'series', key: g.key, label: g.label } })
  }
  const onContext = (b: BookRecord) => (e: React.MouseEvent) => setCtx({ book: b, x: e.clientX, y: e.clientY })
  const renderBooks = (list: BookRecord[], offset = 0) => libPrefs.view === 'grid' ? (
    <div className="shelf-grid" style={{ '--cover-w': `${libPrefs.coverSize}px` } as CSSProperties}>
      {list.map((b, i) => <BookCard key={b.id} book={b} index={offset + i} onContext={onContext(b)} />)}
    </div>
  ) : (
    <div className="book-list">
      {list.map(b => <BookRow key={b.id} book={b} onContext={onContext(b)} />)}
    </div>
  )

  const addFiles = async () => {
    setAddEl(null)
    const paths = await bc.library.pick()
    if (paths.length) useLibrary.getState().importPaths(paths)
  }
  const addFolder = async () => {
    setAddEl(null)
    const paths = await bc.library.pickFolder()
    if (paths.length) useLibrary.getState().importPaths(paths)
  }

  const sortOptions = ['recent', 'added', 'title', 'author', 'progress'] as const

  return (
    <div className="library" onKeyDown={e => {
      if ((e.ctrlKey && e.key.toLowerCase() === 'f')) { e.preventDefault(); searchRef.current?.focus() }
    }}>
      <header className="lib-header drag-region">
        <div className="lib-title">
          {filter.kind === 'all' && !books.length ? null : filter.kind === 'all' ? (
            <>
              <span className="eyebrow">{new Date().toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
              <h1 className="display">{t(greetingKey())}</h1>
            </>
          ) : (
            <>
              <span className="eyebrow">{eyebrow}</span>
              <h1 className={`display ${title.length > 22 ? 'long' : ''}`}>{title}</h1>
            </>
          )}
        </div>
        <div className="lib-tools no-drag">
          <div className="search-field lib-search">
            <MagnifyingGlass size={16} />
            <input ref={searchRef} className="input" placeholder={t('lib.search')} value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') setQuery('') }} />
            {query && <IconButton size="sm" className="clear" label={t('common.close')} onClick={() => setQuery('')}><X size={14} /></IconButton>}
          </div>
          <IconButton label={t('lib.sort')} onClick={e => setSortEl(e.currentTarget)} active={!!sortEl}>
            <SortAscending size={19} />
          </IconButton>
          <Segmented
            value={libPrefs.view}
            onChange={v => update(s => { s.library.view = v })}
            label="view"
            options={[
              { value: 'grid', label: <SquaresFour size={16} weight="bold" />, title: t('lib.view.grid') },
              { value: 'list', label: <Rows size={16} weight="bold" />, title: t('lib.view.list') },
            ]}
          />
          <div className="split-btn">
            <button className="btn primary" onClick={addFiles}><Plus size={16} weight="bold" /> {t('lib.add')}</button>
            <button className="btn primary split-caret" aria-label={t('lib.addFolder')} onClick={e => setAddEl(e.currentTarget)}>
              <CaretDown size={14} weight="bold" />
            </button>
          </div>
        </div>
      </header>

      <div className="lib-scroll" ref={scrollRef}>
        {!books.length ? <EmptyShelf onAdd={addFiles} /> : (
          <>
            {showHero && hero && <ContinueHero book={hero} others={reading.slice(1, 6)} />}

            {(showHero) && (
              <div className="section-head">
                <h2 className="display">{t('lib.allBooks')}</h2>
                <span className="faint tabular">{filtered.length}</span>
              </div>
            )}

            {!filtered.length ? (
              <div className="empty">
                <h3 className="display">{query ? t('lib.noResults', { q: query }) : t('lib.empty.filtered')}</h3>
              </div>
            ) : groups ? (
              <div className="groups">
                {groups.map((g, gi) => (
                  <section key={g.key || '_'} className="book-group">
                    <div className="group-head">
                      {g.key ? (
                        <button className="group-title display" onClick={() => openGroup(g)}>{g.label}</button>
                      ) : (
                        <span className="group-title display muted">{groupBy === 'author' ? t('lib.unknownAuthor') : t('lib.noSeries')}</span>
                      )}
                      <span className="faint tabular">{g.books.length}</span>
                    </div>
                    {renderBooks(g.books, gi * 3)}
                  </section>
                ))}
              </div>
            ) : renderBooks(filtered)}
          </>
        )}
      </div>

      <Popover anchor={sortEl} open={!!sortEl} onClose={() => setSortEl(null)} placement="bottom-end">
        <div className="menu-label eyebrow">{t('lib.sort')}</div>
        {sortOptions.map(o => (
          <MenuItem key={o} checked={libPrefs.sort === o} onClick={() => { update(s => { s.library.sort = o }); setSortEl(null) }}>
            {t(`lib.sort.${o}` as TKey)}
          </MenuItem>
        ))}
        <MenuSep />
        <div className="menu-label eyebrow">{t('lib.group')}</div>
        {(['none', 'author', 'series'] as const).map(o => (
          <MenuItem key={o} checked={libPrefs.group === o} onClick={() => { update(s => { s.library.group = o }); setSortEl(null) }}>
            {t(`lib.group.${o}` as TKey)}
          </MenuItem>
        ))}
      </Popover>
      <Popover anchor={addEl} open={!!addEl} onClose={() => setAddEl(null)} placement="bottom-end">
        <MenuItem icon={<FilePlus size={16} />} onClick={addFiles}>{t('lib.add')}</MenuItem>
        <MenuItem icon={<FolderPlus size={16} />} onClick={addFolder}>{t('lib.addFolder')}</MenuItem>
        <MenuSep />
        <MenuItem icon={<ImageSquare size={16} />} disabled={!books.some(b => !b.hasCover)}
          onClick={() => { setAddEl(null); findMissingCovers() }}>{t('online.findCovers')}</MenuItem>
      </Popover>
      {ctx && <BookContextMenu book={ctx.book} at={{ x: ctx.x, y: ctx.y }} onClose={() => setCtx(null)} />}
    </div>
  )
}

function ContinueHero({ book, others }: { book: BookRecord; others: BookRecord[] }) {
  const t = useT()
  const lang = useSettings(s => s.settings.lang)
  const left = bookTimeLeft(book)
  const pct = Math.round(book.progress * 100)
  return (
    <section className="hero rise-in" aria-label={t('lib.continue')}>
      <div className="hero-main">
        <button className="hero-cover" onClick={() => openBookById(book.id)} aria-label={book.title}>
          <Cover book={book} />
        </button>
        <div className="hero-info">
          <span className="eyebrow">{t('lib.continue')}</span>
          <h2 className="display hero-title clamp-2">{book.title}</h2>
          <div className="hero-author">{book.authors.join(', ') || t('lib.unknownAuthor')}</div>
          <div className="hero-progress">
            <div className="progress-line"><i style={{ width: `${pct}%` }} /></div>
            <div className="hero-meta tabular">
              <span>{pct}%</span>
              {left && <span>{t('lib.left', { time: formatDuration(left, lang) })}</span>}
            </div>
          </div>
          <div>
            <button className="btn primary lg" onClick={() => openBookById(book.id)}>
              <Play size={16} weight="fill" /> {t('lib.continueBtn')}
            </button>
          </div>
        </div>
      </div>
      {others.length > 0 && (
        <div className="hero-others">
          <span className="eyebrow">{t('lib.inProgress')}</span>
          <div className="hero-strip">
            {others.map(b => (
              <button key={b.id} className="mini-book" onClick={() => openBookById(b.id)} data-tip={b.title}>
                <Cover book={b} />
                <div className="progress-line"><i style={{ width: `${Math.round(b.progress * 100)}%` }} /></div>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
