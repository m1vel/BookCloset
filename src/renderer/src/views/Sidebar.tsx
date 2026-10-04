import { useMemo, useState } from 'react'
import {
  Books, BookOpenText, BookmarkSimple, CheckCircle, Heart, Quotes, ChartLineUp, GearSix, Plus,
  FolderSimple, DotsThree, PencilSimple, Trash,
} from '@phosphor-icons/react'
import { useLibrary } from '../store/library'
import { useUi, type LibraryFilter, type Route } from '../store/ui'
import { useT } from '../i18n'
import { Popover, MenuItem } from '../components/ui'
import { Logo } from '../components/Logo'

export function Sidebar() {
  const t = useT()
  const books = useLibrary(s => s.books)
  const collections = useLibrary(s => s.collections)
  const counts = useLibrary(s => s.annotationCounts)
  const route = useUi(s => s.route)
  const navigate = useUi(s => s.navigate)
  const [menu, setMenu] = useState<{ id: string; el: HTMLElement } | null>(null)

  const n = useMemo(() => ({
    all: books.length,
    reading: books.filter(b => b.status === 'reading').length,
    unread: books.filter(b => b.status === 'new').length,
    finished: books.filter(b => b.status === 'finished').length,
    favorites: books.filter(b => b.favorite).length,
    notes: Object.values(counts).reduce((a, b) => a + b, 0),
  }), [books, counts])

  const isActive = (f: LibraryFilter) => route.name === 'library'
    && JSON.stringify(route.filter ?? { kind: 'all' }) === JSON.stringify(f)
  const go = (f: LibraryFilter) => navigate({ name: 'library', filter: f })

  const Item = ({ icon, label, count, active, onClick }: {
    icon: React.ReactNode; label: string; count?: number; active: boolean; onClick: () => void
  }) => (
    <button className={`nav-item ${active ? 'active' : ''}`} onClick={onClick} aria-current={active ? 'page' : undefined}>
      <span className="nav-icon">{icon}</span>
      <span className="nav-label truncate">{label}</span>
      {!!count && <span className="nav-count tabular">{count}</span>}
    </button>
  )

  const newCollection = async () => {
    const name = await useUi.getState().prompt({
      title: t('nav.newCollection'), label: t('common.name'), value: '', confirm: t('common.create'),
    })
    if (name) {
      const c = useLibrary.getState().addCollection(name)
      go({ kind: 'collection', id: c.id })
    }
  }

  const routeIs = (name: Route['name']) => route.name === name

  return (
    <aside className="sidebar">
      <div className="sidebar-brand drag-region">
        <Logo />
      </div>
      <nav className="sidebar-nav" aria-label="main">
        <Item icon={<Books size={19} />} label={t('nav.library')} count={n.all} active={isActive({ kind: 'all' })} onClick={() => go({ kind: 'all' })} />
        <Item icon={<BookOpenText size={19} />} label={t('nav.reading')} count={n.reading} active={isActive({ kind: 'reading' })} onClick={() => go({ kind: 'reading' })} />
        <Item icon={<BookmarkSimple size={19} />} label={t('nav.unread')} count={n.unread} active={isActive({ kind: 'unread' })} onClick={() => go({ kind: 'unread' })} />
        <Item icon={<CheckCircle size={19} />} label={t('nav.finished')} count={n.finished} active={isActive({ kind: 'finished' })} onClick={() => go({ kind: 'finished' })} />
        <Item icon={<Heart size={19} />} label={t('nav.favorites')} count={n.favorites} active={isActive({ kind: 'favorites' })} onClick={() => go({ kind: 'favorites' })} />
        <Item icon={<Quotes size={19} />} label={t('nav.notes')} count={n.notes} active={routeIs('notes')} onClick={() => navigate({ name: 'notes' })} />

        <div className="nav-section">
          <span className="eyebrow">{t('nav.collections')}</span>
          <button className="icon-btn sm" aria-label={t('nav.newCollection')} data-tip={t('nav.newCollection')} onClick={newCollection}>
            <Plus size={15} weight="bold" />
          </button>
        </div>
        {collections.map(c => (
          <div key={c.id} className="nav-row">
            <Item
              icon={<FolderSimple size={19} />}
              label={c.name}
              count={books.filter(b => b.collections.includes(c.id)).length}
              active={isActive({ kind: 'collection', id: c.id })}
              onClick={() => go({ kind: 'collection', id: c.id })}
            />
            <button className="icon-btn sm nav-more" aria-label="…" onClick={e => setMenu({ id: c.id, el: e.currentTarget })}>
              <DotsThree size={18} weight="bold" />
            </button>
          </div>
        ))}
        {!collections.length && (
          <button className="nav-ghost" onClick={newCollection}>
            <Plus size={14} /> {t('nav.newCollection')}
          </button>
        )}
      </nav>

      <div className="sidebar-foot">
        <Item icon={<ChartLineUp size={19} />} label={t('nav.stats')} active={routeIs('stats')} onClick={() => navigate({ name: 'stats' })} />
        <Item icon={<GearSix size={19} />} label={t('nav.settings')} active={routeIs('settings')} onClick={() => navigate({ name: 'settings' })} />
      </div>

      <Popover anchor={menu?.el ?? null} open={!!menu} onClose={() => setMenu(null)} placement="bottom-end">
        <MenuItem icon={<PencilSimple size={16} />} onClick={async () => {
          const c = collections.find(c => c.id === menu!.id)!
          setMenu(null)
          const name = await useUi.getState().prompt({ title: t('common.rename'), label: t('common.name'), value: c.name, confirm: t('common.ok') })
          if (name) useLibrary.getState().renameCollection(c.id, name)
        }}>{t('common.rename')}</MenuItem>
        <MenuItem danger icon={<Trash size={16} />} onClick={() => {
          const id = menu!.id
          setMenu(null)
          useLibrary.getState().deleteCollection(id)
          if (isActive({ kind: 'collection', id })) go({ kind: 'all' })
        }}>{t('common.delete')}</MenuItem>
      </Popover>
    </aside>
  )
}
