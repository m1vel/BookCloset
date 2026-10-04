import { lazy, Suspense, useEffect, useState } from 'react'
import { useSettings } from './store/settings'
import { useLibrary } from './store/library'
import { useUi } from './store/ui'
import { bc, coverUrl } from './api'
import { DialogHost, Toasts, TooltipLayer } from './components/ui'
import { Sidebar } from './views/Sidebar'
import { LibraryView } from './views/LibraryView'
import { BookDetails } from './views/BookDetails'
import { DropZone } from './views/DropZone'
import { openBookById } from './views/open'
import { useAppearance } from './store/appearance'

const ReaderView = lazy(() => import('./views/ReaderView'))
const StatsView = lazy(() => import('./views/StatsView'))
const SettingsView = lazy(() => import('./views/SettingsView'))
const NotesView = lazy(() => import('./views/NotesView'))

function useThemeSync() {
  const uiTheme = useAppearance().ui
  const lang = useSettings(s => s.settings.lang)
  const route = useUi(s => s.route)
  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = uiTheme
    root.lang = lang
    const css = getComputedStyle(root)
    const bg = css.getPropertyValue('--bg').trim() || '#f3ebde'
    if (route.name !== 'reader') bc.win.titlebar('#00000000', css.getPropertyValue('--titlebar-symbol').trim())
    bc.win.material(uiTheme === 'glass' ? 'acrylic' : 'none', bg)
  }, [uiTheme, lang, route.name])
}

/** Blurred cover of the most recent book behind the glass theme. */
function Ambient() {
  const books = useLibrary(s => s.books)
  const route = useUi(s => s.route)
  const uiTheme = useAppearance().ui
  const current = route.name === 'reader'
    ? books.find(b => b.id === route.bookId)
    : [...books].filter(b => b.hasCover).sort((a, b) => (b.openedAt ?? b.addedAt) - (a.openedAt ?? a.addedAt))[0]
  if (uiTheme !== 'glass' || !current?.hasCover) return <div className="ambient" />
  return (
    <div className="ambient on">
      <img src={coverUrl(current.id)} alt="" />
    </div>
  )
}

export default function App() {
  const loaded = useSettings(s => s.loaded)
  const route = useUi(s => s.route)
  const detailsId = useUi(s => s.detailsBookId)
  const [ready, setReady] = useState(false)
  useThemeSync()

  useEffect(() => {
    (async () => {
      await useSettings.getState().load()
      await useLibrary.getState().load()
      setReady(true)
      const pending = await bc.pendingOpen()
      if (pending.length) openFiles(pending)
    })()
    const off = bc.onOpenFiles(openFiles)
    const offFs = bc.onFullscreen(on => useUi.setState({ fullscreen: on }))
    return () => { off(); offFs() }
  }, [])

  if (!loaded || !ready) return <div className="app"><div className="app-backdrop" /></div>

  const inReader = route.name === 'reader'
  return (
    <div className={`app ${inReader ? 'in-reader' : ''}`}>
      <div className="app-backdrop" />
      <div className="app-grain" />
      <Ambient />
      {inReader ? (
        <Suspense fallback={null}>
          <ReaderView key={route.bookId} bookId={route.bookId} target={route.target} />
        </Suspense>
      ) : (
        <div className="shell">
          <Sidebar />
          <main className="main">
            <Suspense fallback={null}>
              {route.name === 'library' && <LibraryView filter={route.filter ?? { kind: 'all' }} />}
              {route.name === 'stats' && <StatsView />}
              {route.name === 'settings' && <SettingsView />}
              {route.name === 'notes' && <NotesView />}
            </Suspense>
          </main>
          {detailsId && <BookDetails bookId={detailsId} />}
        </div>
      )}
      <DropZone />
      <DialogHost />
      <Toasts />
      <TooltipLayer />
    </div>
  )
}

// handle for automated UI tests (tests/run.mjs)
;(window as any).__bc = { lib: useLibrary, ui: useUi, settings: useSettings, openBookById }

async function openFiles(paths: string[]) {
  const records = await useLibrary.getState().importPaths(paths)
  if (records.length === 1 || (records.length && paths.length === 1)) openBookById(records[0].id)
}
