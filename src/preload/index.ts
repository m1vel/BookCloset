import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  Annotation, ArchiveListing, BookRecord, Collection, ImportResult, KeyStatus, LibraryData, ReadingSession,
  MetaCandidate, MetaQuery, Settings, StatsData, TranslateRequest, VocabEntry, TranslateResponse, TranslationProviderId,
} from '../shared/types'

const invoke = <T>(channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args) as Promise<T>

const api = {
  info: () => invoke<{ version: string; dataDir: string; platform: string; locale: string; isPortable: boolean; test: boolean }>('app:info'),
  pendingOpen: () => invoke<string[]>('app:pending-open'),
  onOpenFiles: (cb: (paths: string[]) => void) => {
    const fn = (_e: unknown, paths: string[]) => cb(paths)
    ipcRenderer.on('open-files', fn)
    return () => ipcRenderer.removeListener('open-files', fn)
  },
  onFullscreen: (cb: (on: boolean) => void) => {
    const fn = (_e: unknown, on: boolean) => cb(on)
    ipcRenderer.on('fullscreen', fn)
    return () => ipcRenderer.removeListener('fullscreen', fn)
  },
  pathForFile: (file: File) => webUtils.getPathForFile(file),

  settings: {
    get: () => invoke<Settings>('settings:get'),
    set: (s: Settings) => invoke<void>('settings:set', s),
  },
  library: {
    get: () => invoke<LibraryData>('library:get'),
    pick: () => invoke<string[]>('library:pick'),
    pickFolder: () => invoke<string[]>('library:pick-folder'),
    import: (paths: string[]) => invoke<ImportResult>('library:import', paths),
    update: (id: string, patch: Partial<BookRecord>) => invoke<BookRecord | undefined>('library:update', id, patch),
    remove: (ids: string[]) => invoke<void>('library:remove', ids),
    setCollections: (c: Collection[]) => invoke<void>('library:collections', c),
    annotationCounts: () => invoke<Record<string, number>>('library:annotation-counts'),
  },
  book: {
    read: (id: string) => invoke<Uint8Array>('book:read', id),
    reveal: (id: string) => invoke<void>('book:reveal', id),
    export: (id: string) => invoke<boolean>('book:export', id),
    saveCover: (id: string, bytes: Uint8Array, color?: string) => invoke<void>('cover:save', id, bytes, color),
    extract: (id: string) => invoke<ArchiveListing>('archive:extract', id),
    docText: (id: string) => invoke<{ body: string; footnotes: string; headers: string }>('doc:text', id),
    calibreConvert: (id: string) => invoke<string>('calibre:convert', id),
  },
  calibre: { find: () => invoke<string | null>('calibre:find') },
  translate: {
    run: (req: TranslateRequest) => invoke<TranslateResponse>('translate:run', req),
    keyStatus: () => invoke<KeyStatus>('translate:key-status'),
    setKey: (provider: TranslationProviderId, key: string) => invoke<KeyStatus>('translate:set-key', provider, key),
  },
  meta: {
    search: (q: MetaQuery) => invoke<MetaCandidate[]>('meta:search', q),
    details: (key: string) => invoke<{ description?: string; subjects?: string[] }>('meta:details', key),
    image: (url: string) => invoke<Uint8Array | null>('meta:image', url),
  },
  vocab: {
    get: () => invoke<VocabEntry[]>('vocab:get'),
    set: (entries: VocabEntry[]) => invoke<void>('vocab:set', entries),
  },
  annotations: {
    get: (id: string) => invoke<Annotation[]>('annotations:get', id),
    set: (id: string, list: Annotation[]) => invoke<void>('annotations:set', id, list),
  },
  stats: {
    get: () => invoke<StatsData>('stats:get'),
    add: (s: ReadingSession) => invoke<void>('stats:add', s),
  },
  win: {
    titlebar: (color: string, symbolColor: string) => invoke<void>('win:titlebar', { color, symbolColor }),
    material: (m: 'acrylic' | 'mica' | 'none', bg: string) => invoke<void>('win:material', m, bg),
    fullscreen: (on?: boolean) => invoke<boolean>('win:fullscreen', on),
  },
  saveText: (name: string, content: string) => invoke<boolean>('file:save-text', name, content),
  savePng: (name: string, bytes: Uint8Array) => invoke<boolean>('file:save-png', name, bytes),
  copyImage: (bytes: Uint8Array) => invoke<boolean>('clipboard:image', bytes),
  openExternal: (url: string) => invoke<void>('shell:open', url),
  openDataDir: () => invoke<void>('shell:open-data'),
  openSpeechSettings: () => invoke<void>('shell:speech-settings'),
}

export type BcApi = typeof api

contextBridge.exposeInMainWorld('bc', api)
