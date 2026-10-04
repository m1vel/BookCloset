// Types shared between the main process, preload and renderer.

export type BookFormat =
  | 'epub' | 'mobi' | 'azw3' | 'fb2' | 'fbz' | 'pdf' | 'djvu'
  | 'txt' | 'html' | 'mht' | 'md' | 'rtf' | 'docx' | 'doc' | 'odt' | 'chm'
  | 'cbz' | 'cbr' | 'cb7' | 'cbt' | 'image' | 'pdb' | 'zip' | 'calibre' | 'unknown'

export type ReadingStatus = 'new' | 'reading' | 'finished'

export interface BookRecord {
  id: string
  hash: string
  /** Original file name (with extension) as imported. */
  fileName: string
  /** Extension of the stored copy, lower-case, without dot. */
  ext: string
  format: BookFormat
  size: number
  title: string
  authors: string[]
  language?: string
  description?: string
  series?: string
  seriesIndex?: number
  publisher?: string
  published?: string
  subjects?: string[]
  hasCover: boolean
  /** Dominant colour of the cover, used for ambient backgrounds and generated covers. */
  coverColor?: string
  addedAt: number
  openedAt?: number
  finishedAt?: number
  /** Reading progress 0..1 */
  progress: number
  /** Engine-specific last position (CFI string for reflow, page number for paged). */
  location?: string | number
  status: ReadingStatus
  favorite?: boolean
  collections: string[]
  readingSeconds: number
  pageCount?: number
  /** Metadata extraction finished (cover + title) */
  indexed: boolean
  /** version of the metadata extractor that last processed the book (series support = 2) */
  metaVersion?: number
  /** Path of the original file at import time (informational). */
  sourcePath?: string
}

export interface Collection {
  id: string
  name: string
  createdAt: number
}

export interface LibraryData {
  version: number
  books: BookRecord[]
  collections: Collection[]
}

export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink' | 'purple' | 'orange'

export interface Annotation {
  id: string
  bookId: string
  kind: 'highlight' | 'note' | 'bookmark'
  color?: HighlightColor
  style?: 'highlight' | 'underline' | 'squiggly'
  /** Reflow engine: CFI range. Paged engine: JSON of {page, rects}. */
  cfi?: string
  page?: number
  /** rectangles in page-relative coordinates (0..1) for the paged engine */
  rects?: { x: number; y: number; w: number; h: number }[]
  text?: string
  note?: string
  chapter?: string
  progress?: number
  createdAt: number
  updatedAt: number
}

export interface ReadingSession {
  bookId: string
  start: number
  end: number
  seconds: number
  progressFrom: number
  progressTo: number
  pages: number
}

export interface StatsData {
  version: number
  sessions: ReadingSession[]
}

export type UiTheme = 'paper' | 'midnight' | 'glass'
export type PageTheme = 'auto' | 'white' | 'paper' | 'sepia' | 'gray' | 'night' | 'oled'
export type Lang = 'ru' | 'en'

export interface ReaderPrefs {
  flow: 'paginated' | 'scrolled'
  fontFamily: string
  fontSize: number
  lineHeight: number
  /** horizontal gap between columns in % */
  gap: number
  /** top/bottom margins in px */
  margin: number
  maxWidth: number
  columns: 1 | 2
  justify: boolean
  hyphenate: boolean
  pageTheme: PageTheme
  animated: boolean
  /** override publisher fonts/colours */
  overrideBookStyles: boolean
  paragraphIndent: boolean
  brightness: number
}

export interface PagedPrefs {
  mode: 'single' | 'spread' | 'scroll'
  fit: 'width' | 'page' | 'custom'
  zoom: number
  rtl: boolean
  invertInDark: boolean
  coverAlone: boolean
}

export type TranslationProviderId = 'free' | 'deepl' | 'yandex' | 'claude' | 'openai'

export interface Settings {
  version: number
  lang: Lang
  uiTheme: UiTheme
  reader: ReaderPrefs
  paged: PagedPrefs
  /** comics / image books keep their own layout */
  comic: PagedPrefs
  library: {
    view: 'grid' | 'list'
    sort: 'recent' | 'added' | 'title' | 'author' | 'progress'
    coverSize: number
    copyFiles: boolean
    group: 'none' | 'author' | 'series'
  }
  goals: { dailyMinutes: number }
  translation: TranslationSettings
  schedule: ThemeSchedule
  quoteCard: QuoteCardPrefs
  autoRead: AutoReadPrefs
  tts: TtsPrefs
  calibrePath?: string
  windowBounds?: { x: number; y: number; width: number; height: number; maximized: boolean }
}

export interface TtsPrefs {
  rate: number
  /** chosen voiceURI per language (ISO 639-1) */
  voices: Record<string, string>
}

export interface AutoReadPrefs {
  /** continuous layouts: px per second */
  speed: number
  /** paginated layouts: seconds per page */
  pageSeconds: number
  /** focus mode: show the reading ruler */
  ruler: boolean
  /** ruler height in lines */
  rulerLines: number
}

export interface QuoteCardPrefs {
  style: 'paper' | 'night' | 'cover'
  format: 'square' | 'story' | 'wide'
  font: 'cormorant' | 'literata' | 'manrope'
  showCover: boolean
  showBrand: boolean
}

export interface ThemeSchedule {
  mode: 'off' | 'time' | 'system'
  dayTheme: UiTheme
  nightTheme: UiTheme
  dayPage: PageTheme
  nightPage: PageTheme
  /** "HH:MM" */
  dayStart: string
  nightStart: string
  /** warm overlay strength over the page at night, 0..1 */
  warmth: number
}

export interface TranslationSettings {
  /** show the "Translate" action in the selection menu */
  enabled: boolean
  /** bilingual reading: paragraph translations under the original */
  bilingual: boolean
  /** target language for bilingual mode */
  bilingualLang: string
  provider: TranslationProviderId
  /** ISO 639-1 code */
  targetLang: string
  claudeModel: string
  openaiModel: string
  yandexFolderId: string
  /** send the surrounding paragraph to AI providers to disambiguate */
  useContext: boolean
  /** translate a single word right away on double-click */
  autoWord: boolean
}

export interface TranslateRequest {
  text: string
  to: string
  /** ISO code or 'auto' */
  from: string
  /** locally detected source language, used by providers that need an explicit one */
  fromHint?: string
  provider: TranslationProviderId
  context?: string
  title?: string
  model?: string
  folderId?: string
}

export interface TranslateMeaning { pos: string; terms: string[] }

export interface TranslateResult {
  text: string
  detected?: string
  provider: TranslationProviderId
  /** dictionary senses for single words */
  meanings?: TranslateMeaning[]
  /** pronunciation / transliteration of the source */
  pronunciation?: string
  note?: string
  /** the free provider fell back to MyMemory */
  fallback?: boolean
}

export type TranslateErrorCode = 'NO_KEY' | 'AUTH' | 'QUOTA' | 'RATE' | 'NETWORK' | 'REFUSED' | 'TOO_LONG' | 'FAILED'

export type TranslateResponse =
  | { ok: true; result: TranslateResult }
  | { ok: false; code: TranslateErrorCode; message: string }

export type KeyStatus = Partial<Record<TranslationProviderId, { set: boolean; hint: string }>>

export interface BatchTranslateRequest {
  texts: string[]
  to: string
  provider: TranslationProviderId
  model?: string
  folderId?: string
}

export interface BatchTranslateResponse {
  /** null where a paragraph was not translated (empty, or an error stopped the batch) */
  results: (string | null)[]
  error?: { code: TranslateErrorCode; message: string }
}

export interface MetaQuery {
  title: string
  author?: string
  isbn?: string
  /** ISO 639-1 language of the book, to prefer editions in that language */
  lang?: string
}

/** A book found in an online catalog (Open Library / Google Books). */
export interface MetaCandidate {
  id: string
  source: 'Open Library' | 'Google Books'
  title: string
  authors: string[]
  year?: string
  publisher?: string
  pages?: number
  description?: string
  language?: string
  coverUrl?: string
  thumbUrl?: string
  /** Open Library work key for fetching the description */
  detailsKey?: string
}

/** Spaced-repetition state (SM-2 family). `interval` is in days. */
export interface VocabSrs {
  due: number
  interval: number
  ease: number
  reps: number
  lapses: number
  last?: number
}

export interface VocabEntry {
  id: string
  term: string
  translation: string
  /** dictionary senses, e.g. "noun: tired, weary" */
  meanings?: string
  /** source language (ISO 639-1) */
  lang: string
  target: string
  /** the sentence the word was found in */
  context?: string
  bookId?: string
  bookTitle?: string
  cfi?: string
  page?: number
  createdAt: number
  srs: VocabSrs
}

export interface VocabData {
  version: 1
  entries: VocabEntry[]
}

export interface ImportResult {
  added: BookRecord[]
  duplicates: BookRecord[]
  failed: { path: string; error: string }[]
}

export interface ArchiveListing {
  /** base url to fetch extracted files: bc://cache/<id>/ */
  baseUrl: string
  files: { path: string; size: number }[]
}
