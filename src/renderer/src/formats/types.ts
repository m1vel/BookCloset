export interface TocItem {
  label: string
  href: string | number
  subitems?: TocItem[] | null
}

export interface BookMeta {
  title?: string
  authors?: string[]
  language?: string
  description?: string
  publisher?: string
  published?: string
  series?: string
  seriesIndex?: number
  subjects?: string[]
  rtl?: boolean
}

/** foliate-js compatible book object (EPUB, MOBI, FB2 or synthetic). */
export interface FoliateBook {
  metadata?: any
  sections: any[]
  toc?: any[]
  dir?: string
  rendition?: { layout?: string }
  getCover?: () => Promise<Blob | null> | Blob | null
  resolveHref: (href: string) => any
  splitTOCHref?: (href: string) => any
  getTOCFragment?: (doc: Document, id: any) => any
  isExternal?: (href: string) => boolean
  destroy?: () => void
  [k: string]: any
}

export interface PageSize { width: number; height: number }

export interface TextRun { str: string; x: number; y: number; w: number; h: number }

/** A fixed-layout document (PDF, DjVu, comic, image). Coordinates are in "page units" (any). */
export interface PagedDocument {
  kind: 'pdf' | 'djvu' | 'images'
  numPages: number
  /** Natural size of page i (0-based), CSS px at 100% zoom. */
  getSize(i: number): PageSize
  /** Called when a page's real size becomes known later (lazily loaded images). */
  onSizeChange?: (cb: (i: number) => void) => void
  /** Draw page i into `host` (which already has the target CSS size). */
  render(i: number, host: HTMLElement, cssWidth: number, cssHeight: number, signal: AbortSignal): Promise<void>
  /** Plain text of page i (for search), if the document has a text layer. */
  getText?(i: number): Promise<string>
  hasText: boolean
  getOutline(): Promise<TocItem[]>
  getMeta(): Promise<BookMeta>
  getCover(): Promise<Blob | null>
  destroy(): void
}

export type BookSource =
  | { kind: 'reflow'; book: FoliateBook; meta: BookMeta }
  | { kind: 'paged'; doc: PagedDocument; meta: BookMeta }
