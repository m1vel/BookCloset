import type { Annotation, HighlightColor } from '../../../shared/types'
import type { TocItem } from '../formats/types'

export interface SearchExcerpt { pre: string; match: string; post: string }
export interface SearchHit { id: string; target: string | number; excerpt: SearchExcerpt; section?: string }

export interface Relocation {
  fraction: number
  /** current/total "pages" for the progress label */
  page?: number
  pages?: number
  chapter?: string
  /** stable location to save: CFI for reflow, page index for paged */
  location: string | number
  /** remaining seconds in chapter / book at a default reading speed */
  chapterTimeLeft?: number
  bookTimeLeft?: number
  /** section start fractions, for progress bar ticks */
  atEnd?: boolean
}

export interface SelectionInfo {
  text: string
  /** viewport rect of the selection (app coordinates) */
  rect: DOMRect
  /** CFI (reflow) */
  cfi?: string
  /** paged */
  page?: number
  rects?: { x: number; y: number; w: number; h: number }[]
  chapter?: string
  /** the paragraph(s) around the selection, for context-aware translation */
  context?: string
}

export interface EngineEvents {
  onReady: (info: { toc: TocItem[]; sectionFractions?: number[] }) => void
  onRelocate: (r: Relocation) => void
  onSelection: (s: SelectionInfo | null) => void
  onAnnotationClick: (id: string, rect: DOMRect) => void
  /** pointer tapped the page without selecting: zone 'left' | 'center' | 'right' */
  onTap: (zone: 'left' | 'center' | 'right') => void
  onKey: (e: KeyboardEvent) => void
  onActivity: () => void
  onFootnote?: (html: string, rect: DOMRect) => void
  onError: (e: unknown) => void
}

/** One sentence for read-aloud, bound to its place on the page. */
export interface SpeechUnit {
  text: string
  /** highlight the sentence, optionally a word inside it (char offset/length within `text`) */
  mark(word?: [number, number]): void
  unmark(): void
  /** make sure the sentence is on screen (turns the page / scrolls when needed) */
  reveal(): void
}

export interface SpeechCursor {
  units: SpeechUnit[]
  /** BCP-47 language of the text */
  lang: string
}

export interface EngineController {
  next(): void
  prev(): void
  goTo(target: string | number): Promise<void>
  goToFraction(f: number): Promise<void>
  search(query: string, onHits: (hits: SearchHit[]) => void, onProgress: (p: number) => void, signal: AbortSignal): Promise<void>
  clearSearch(): void
  showSearchHit(hit: SearchHit): void
  setAnnotations(list: Annotation[]): void
  clearSelection(): void
  /** current location for a bookmark */
  bookmarkLocation(): { cfi?: string; page?: number; text?: string } | null
  isBookmarked(list: Annotation[]): Annotation | null
  focus(): void
  /**
   * Continuous layouts (scrolled flow, PDF scroll mode): scroll by `px`.
   * 'edge' when the current section/document cannot scroll further, null for paginated layouts.
   */
  scrollStep(px: number): 'moved' | 'edge' | null
  /**
   * Read-aloud text. 'start': from the selection or the top of the current page to the end of the
   * section (reflow) / page (paged). 'next': moves to the following section/page first.
   * null when there is nothing (more) to read.
   */
  speech(where: 'start' | 'next'): Promise<SpeechCursor | null>
}

export const HIGHLIGHT_COLORS: Record<HighlightColor, string> = {
  yellow: '#f5d256',
  green: '#8fd694',
  blue: '#7fb8f0',
  pink: '#f29bb8',
  purple: '#b9a0f0',
  orange: '#f5a962',
}
