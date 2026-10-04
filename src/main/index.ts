import { app, BrowserWindow, dialog, ipcMain, nativeTheme, screen, shell, Menu } from 'electron'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { writeFile, copyFile } from 'node:fs/promises'
import type { Annotation, BookRecord, Collection, MetaQuery, ReadingSession, Settings, TranslateRequest, TranslationProviderId } from '../shared/types'
import { SUPPORTED_EXTENSIONS, extOf } from '../shared/formats'
import { mergeSettings } from '../shared/defaults'
import { setupDataDir, dataDir } from './paths'
import { JsonStore } from './json-store'
import {
  initLibrary, flushAll, getLibrary, importFiles, updateBook, removeBooks, setCollections, saveCover,
  readBook, getAnnotations, setAnnotations, getStats, addSession, getBook, bookFilePath, allAnnotationCounts,
} from './library'
import { registerSchemes, handleProtocols, CSP } from './protocol'
import { extractArchive, cacheFile, readCached } from './archive'
import { extractDocText, findCalibre, convertWithCalibre } from './converters'
import { translate } from './translate'
import { setKey, keyStatus } from './secrets'
import { searchMetadata, metadataDetails, fetchImage } from './metasearch'

setupDataDir()
registerSchemes()

/** Automated UI tests: never steal focus or cover the user's screen; keep rendering off-screen. */
const testMode = !!process.env.BC_TEST
if (testMode) app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')

const isDev = !app.isPackaged && !!process.env['ELECTRON_RENDERER_URL']
let win: BrowserWindow | null = null
let settings: JsonStore<Settings>
/** files passed on the command line before the renderer was ready */
let pendingOpen: string[] = []

function filesFromArgv(argv: string[]) {
  return argv.slice(1).filter(a => !a.startsWith('-') && existsSync(a)
    && SUPPORTED_EXTENSIONS.includes(extOf(a)))
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    const files = filesFromArgv(argv)
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
      if (files.length) win.webContents.send('open-files', files)
    }
  })
}

const TITLEBAR_HEIGHT = 44

function createWindow() {
  const s = settings.get()
  const b = s.windowBounds
  const area = screen.getPrimaryDisplay().workAreaSize
  const glass = s.uiTheme === 'glass'
  win = new BrowserWindow({
    width: b?.width ?? Math.min(1440, Math.round(area.width * 0.85)),
    height: b?.height ?? Math.min(940, Math.round(area.height * 0.88)),
    x: testMode ? -12000 : b?.x, y: testMode ? 0 : b?.y,
    skipTaskbar: testMode,
    minWidth: 760,
    minHeight: 520,
    show: false,
    title: 'BookCloset',
    icon: join(__dirname, '../../build/icon.png'),
    backgroundColor: glass ? '#00000000' : s.uiTheme === 'midnight' ? '#0e0f13' : '#f6f0e4',
    ...(glass ? { backgroundMaterial: 'acrylic' as const } : {}),
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#00000000',
      symbolColor: s.uiTheme === 'paper' ? '#4a3b2a' : '#e8e6e3',
      height: TITLEBAR_HEIGHT,
    },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: !testMode,
    },
  })
  if (b?.maximized && !testMode) win.maximize()

  win.once('ready-to-show', () => (testMode ? win?.showInactive() : win?.show()))
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:|^mailto:/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://') && !url.startsWith(process.env['ELECTRON_RENDERER_URL'] ?? '\0')) {
      e.preventDefault()
      if (/^https?:/i.test(url)) shell.openExternal(url)
    }
  })

  const saveBounds = () => {
    if (!win) return
    const maximized = win.isMaximized()
    const bounds = maximized ? (settings.get().windowBounds ?? win.getNormalBounds()) : win.getBounds()
    settings.update(s => { s.windowBounds = { ...bounds, maximized } })
  }
  if (!testMode) {
    win.on('resize', saveBounds)
    win.on('move', saveBounds)
    win.on('maximize', saveBounds)
    win.on('unmaximize', saveBounds)
  }
  win.on('enter-full-screen', () => win?.webContents.send('fullscreen', true))
  win.on('leave-full-screen', () => win?.webContents.send('fullscreen', false))

  if (isDev) win.loadURL(process.env['ELECTRON_RENDERER_URL']!)
  else win.loadURL('app://bookcloset/index.html')
}

function registerIpc() {
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    dataDir: dataDir(),
    platform: process.platform,
    locale: app.getLocale(),
    isPortable: !!process.env.PORTABLE_EXECUTABLE_DIR,
  }))
  ipcMain.handle('app:pending-open', () => {
    const files = pendingOpen
    pendingOpen = []
    return files
  })

  ipcMain.handle('settings:get', () => settings.get())
  ipcMain.handle('settings:set', (_e, s: Settings) => {
    const bounds = settings.get().windowBounds
    settings.set({ ...s, windowBounds: bounds })
  })

  ipcMain.handle('library:get', () => getLibrary())
  ipcMain.handle('library:pick', async () => {
    const r = await dialog.showOpenDialog(win!, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Books', extensions: SUPPORTED_EXTENSIONS },
        { name: '*', extensions: ['*'] },
      ],
    })
    return r.canceled ? [] : r.filePaths
  })
  ipcMain.handle('library:pick-folder', async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory'] })
    return r.canceled ? [] : r.filePaths
  })
  ipcMain.handle('library:import', (_e, paths: string[]) => importFiles(paths))
  ipcMain.handle('library:update', (_e, id: string, patch: Partial<BookRecord>) => updateBook(id, patch))
  ipcMain.handle('library:remove', (_e, ids: string[]) => removeBooks(ids))
  ipcMain.handle('library:collections', (_e, c: Collection[]) => setCollections(c))
  ipcMain.handle('library:annotation-counts', () => allAnnotationCounts())

  ipcMain.handle('book:read', (_e, id: string) => readBook(id))
  ipcMain.handle('book:reveal', (_e, id: string) => {
    const b = getBook(id)
    if (b) shell.showItemInFolder(bookFilePath(b))
  })
  ipcMain.handle('book:export', async (_e, id: string) => {
    const b = getBook(id)
    if (!b) return false
    const r = await dialog.showSaveDialog(win!, { defaultPath: b.fileName })
    if (r.canceled || !r.filePath) return false
    await copyFile(bookFilePath(b), r.filePath)
    return true
  })
  ipcMain.handle('cover:save', (_e, id: string, bytes: Uint8Array, color?: string) =>
    saveCover(id, Buffer.from(bytes), color))

  ipcMain.handle('annotations:get', (_e, id: string) => getAnnotations(id))
  ipcMain.handle('annotations:set', (_e, id: string, list: Annotation[]) => setAnnotations(id, list))

  ipcMain.handle('stats:get', () => getStats())
  ipcMain.handle('stats:add', (_e, s: ReadingSession) => addSession(s))

  ipcMain.handle('archive:extract', (_e, id: string) => {
    const b = getBook(id)
    if (!b) throw new Error('Book not found')
    return extractArchive(id, bookFilePath(b))
  })
  ipcMain.handle('doc:text', async (_e, id: string) => {
    const b = getBook(id)
    if (!b) throw new Error('Book not found')
    const cached = readCached(id, 'doc.json')
    if (cached) return JSON.parse(cached.toString('utf8'))
    const r = await extractDocText(bookFilePath(b))
    cacheFile(id, 'doc.json', JSON.stringify(r))
    return r
  })
  ipcMain.handle('calibre:find', () => findCalibre(settings.get().calibrePath))
  ipcMain.handle('calibre:convert', async (_e, id: string) => {
    const b = getBook(id)
    if (!b) throw new Error('Book not found')
    const exe = findCalibre(settings.get().calibrePath)
    if (!exe) throw new Error('CALIBRE_NOT_FOUND')
    await convertWithCalibre(exe, bookFilePath(b), id)
    return `bc://cache/${id}/converted.epub`
  })

  ipcMain.handle('translate:run', (_e, req: TranslateRequest) => translate(req))
  ipcMain.handle('translate:key-status', () => keyStatus())
  ipcMain.handle('translate:set-key', (_e, provider: TranslationProviderId, key: string) => { setKey(provider, key); return keyStatus() })

  ipcMain.handle('meta:search', (_e, q: MetaQuery) => searchMetadata(q))
  ipcMain.handle('meta:details', (_e, key: string) => metadataDetails(key))
  ipcMain.handle('meta:image', (_e, url: string) => fetchImage(url))

  ipcMain.handle('file:save-text', async (_e, defaultName: string, content: string) => {
    const r = await dialog.showSaveDialog(win!, { defaultPath: defaultName })
    if (r.canceled || !r.filePath) return false
    await writeFile(r.filePath, content, 'utf8')
    return true
  })

  ipcMain.handle('win:titlebar', (_e, o: { color: string; symbolColor: string }) => {
    try {
      win?.setTitleBarOverlay({ color: o.color, symbolColor: o.symbolColor, height: TITLEBAR_HEIGHT })
    } catch { /* not supported */ }
  })
  ipcMain.handle('win:material', (_e, material: 'acrylic' | 'mica' | 'none', bg: string) => {
    try {
      win?.setBackgroundColor(material === 'none' ? bg : '#00000000')
      win?.setBackgroundMaterial(material)
    } catch { /* Windows 10 */ }
  })
  ipcMain.handle('win:fullscreen', (_e, on?: boolean) => {
    if (!win) return false
    win.setFullScreen(on ?? !win.isFullScreen())
    return win.isFullScreen()
  })
  ipcMain.handle('shell:open', (_e, url: string) => {
    if (/^https?:|^mailto:/i.test(url)) shell.openExternal(url)
  })
  ipcMain.handle('shell:open-data', () => shell.openPath(dataDir()))
}

app.whenReady().then(() => {
  app.setAppUserModelId('com.bookcloset.app')
  Menu.setApplicationMenu(null)
  nativeTheme.themeSource = 'system'
  settings = new JsonStore<Settings>(join(dataDir(), 'settings.json'),
    () => mergeSettings({}, app.getLocale().startsWith('ru') ? 'ru' : 'en'),
    v => mergeSettings(v, app.getLocale().startsWith('ru') ? 'ru' : 'en'))
  initLibrary()
  handleProtocols(join(__dirname, '../renderer'))
  registerIpc()
  pendingOpen = filesFromArgv(process.argv)
  createWindow()
})

app.on('before-quit', () => {
  flushAll()
  settings?.flush()
})

app.on('window-all-closed', () => {
  flushAll()
  settings?.flush()
  app.quit()
})

void CSP
