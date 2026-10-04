import type { BookFormat, BookRecord } from '../../../shared/types'
import { detectFormat } from '../../../shared/formats'
import { bc, readBookBytes } from '../api'
import type { BookMeta, BookSource, FoliateBook } from './types'
import { makeHtmlBook } from './html-book'
import { decodeText } from './encoding'
import { textToChapters } from './txt'

const asBlob = (bytes: Uint8Array, type = 'application/octet-stream') => new Blob([bytes as BlobPart], { type })

async function makeZipLoader(blob: Blob) {
  const { configure, ZipReader, BlobReader, TextWriter, BlobWriter } = await import('../vendor/foliate-js/vendor/zip.js') as any
  configure({ useWebWorkers: false })
  const reader = new ZipReader(new BlobReader(blob))
  const entries = await reader.getEntries()
  const map = new Map(entries.map((e: any) => [e.filename, e]))
  const load = (f: (e: any, ...a: any[]) => any) => (name: string, ...args: any[]) => (map.has(name) ? f(map.get(name), ...args) : null)
  return {
    entries,
    loadText: load(e => e.getData(new TextWriter())),
    loadBlob: load((e, type) => e.getData(new BlobWriter(type))),
    getSize: (name: string) => (map.get(name) as any)?.uncompressedSize ?? 0,
  }
}

const str = (x: any): string => {
  if (!x) return ''
  if (typeof x === 'string') return x
  if (typeof x === 'object') return x.name ? str(x.name) : String(Object.values(x)[0] ?? '')
  return String(x)
}

/** Normalises foliate-js metadata (EPUB/MOBI/FB2) into BookMeta. */
export function foliateMeta(book: FoliateBook): BookMeta {
  const m = book.metadata ?? {}
  const authors = [m.author].flat().filter(Boolean).map(str).filter(Boolean)
  const series = [m.belongsTo?.series].flat().filter(Boolean)[0]
  return {
    title: str(m.title).trim() || undefined,
    authors: authors.length ? authors : undefined,
    language: [m.language].flat().filter(Boolean)[0],
    description: typeof m.description === 'string' ? m.description : undefined,
    publisher: str(m.publisher) || undefined,
    published: typeof m.published === 'string' ? m.published : undefined,
    subjects: [m.subject].flat().filter(Boolean).map(str).filter(Boolean),
    series: series ? str(series.name ?? series) : undefined,
    seriesIndex: series?.position ? Number(series.position) : undefined,
    rtl: book.dir === 'rtl',
  }
}

const reflow = (book: FoliateBook, meta?: BookMeta): BookSource => ({ kind: 'reflow', book, meta: meta ?? foliateMeta(book) })

async function openEpub(blob: Blob) {
  const { EPUB } = await import('../vendor/foliate-js/epub.js') as any
  return new EPUB(await makeZipLoader(blob)).init() as Promise<FoliateBook>
}

async function openMobi(file: File) {
  const { MOBI } = await import('../vendor/foliate-js/mobi.js') as any
  const fflate = await import('../vendor/foliate-js/vendor/fflate.js') as any
  return new MOBI({ unzlib: fflate.unzlibSync }).open(file) as Promise<FoliateBook>
}

async function openFb2(blob: Blob) {
  const { makeFB2 } = await import('../vendor/foliate-js/fb2.js') as any
  return makeFB2(blob) as Promise<FoliateBook>
}

function textBook(text: string, title: string, extra: BookMeta = {}): BookSource {
  const { chapters, meta } = textToChapters(text, title)
  const m = { ...meta, ...Object.fromEntries(Object.entries(extra).filter(([, v]) => v)) }
  m.title ||= title
  return reflow(makeHtmlBook({ chapters, meta: m, style: 'fiction' }), m)
}

const baseName = (name: string) => name.replace(/\.fb2\.zip$/i, '').replace(/\.[^.]+$/, '')

interface OpenCtx { bookId: string; fileName: string; title: string; depth: number }

/** Opens the bytes of a book of a known format. */
async function openBytes(format: BookFormat, bytes: Uint8Array, ctx: OpenCtx): Promise<BookSource> {
  const title = ctx.title
  switch (format) {
    case 'epub':
      return reflow(await openEpub(asBlob(bytes, 'application/epub+zip')))
    case 'mobi':
    case 'azw3':
      return reflow(await openMobi(new File([bytes as BlobPart], ctx.fileName)))
    case 'fb2':
      return reflow(await openFb2(asBlob(bytes, 'application/x-fictionbook+xml')))
    case 'txt':
      return textBook(decodeText(bytes).text, title)
    case 'pdb': {
      const { decodePalmDoc, pdbName } = await import('./office')
      const name = pdbName(bytes)
      return textBook(decodeText(decodePalmDoc(bytes)).text, title, { title: name && !/^[\x20-\x7e]*$/.test(title) ? title : name || title })
    }
    case 'html': {
      const { parseHtmlBytes } = await import('./html')
      const p = parseHtmlBytes(bytes, title)
      return reflow(makeHtmlBook({ chapters: p.chapters, meta: p.meta, css: p.css, style: 'fiction' }), p.meta)
    }
    case 'mht': {
      const { parseMht } = await import('./html')
      const p = parseMht(bytes, title)
      return reflow(makeHtmlBook({ chapters: p.chapters, meta: p.meta, css: p.css, style: 'document' }), p.meta)
    }
    case 'md': {
      const { parseMarkdown } = await import('./html')
      const p = parseMarkdown(bytes, title)
      return reflow(makeHtmlBook({ chapters: p.chapters, meta: p.meta, css: p.css, style: 'document' }), p.meta)
    }
    case 'docx': {
      const { parseDocx } = await import('./office')
      const p = await parseDocx(bytes, title)
      return reflow(makeHtmlBook({ chapters: p.chapters, meta: p.meta, style: 'document' }), p.meta)
    }
    case 'odt': {
      const { parseOdt } = await import('./office')
      const p = await parseOdt(bytes, title)
      return reflow(makeHtmlBook({ chapters: p.chapters, meta: p.meta, style: 'document' }), p.meta)
    }
    case 'rtf': {
      const { parseRtf } = await import('./office')
      const p = await parseRtf(bytes, title)
      return reflow(makeHtmlBook({ chapters: p.chapters, meta: p.meta, style: 'fiction' }), p.meta)
    }
    case 'pdf': {
      const { openPdf } = await import('../engines/paged/pdf-doc')
      const doc = await openPdf(bytes)
      return { kind: 'paged', doc, meta: await doc.getMeta() }
    }
    case 'djvu': {
      const { openDjvu } = await import('../engines/paged/djvu-doc')
      const doc = await openDjvu(bytes)
      return { kind: 'paged', doc, meta: {} }
    }
    case 'image': {
      const { openImages } = await import('../engines/paged/images-doc')
      const url = URL.createObjectURL(asBlob(bytes, 'image/*'))
      const doc = await openImages([url], { title })
      return { kind: 'paged', doc, meta: { title } }
    }
  }
  throw new Error(`Unsupported format: ${format}`)
}

const BOOK_EXT = /\.(epub|fb2|mobi|azw3?|kf8|prc|pdb|txt|html?|xhtml|md|markdown|rtf|docx|odt|pdf|djvu?)$/i

/** Opens a book from the library. */
export async function openRecord(record: BookRecord): Promise<BookSource> {
  const ctx: OpenCtx = { bookId: record.id, fileName: record.fileName, title: record.title || baseName(record.fileName), depth: 0 }
  switch (record.format) {
    case 'chm': {
      const { openChm } = await import('./chm')
      const { book, meta } = await openChm(record.id, ctx.title)
      return reflow(book, meta)
    }
    case 'doc': {
      const r = await bc.book.docText(record.id)
      const text = [r.headers, r.body, r.footnotes].filter(s => s?.trim()).join('\n\n')
      return textBook(text, ctx.title)
    }
    case 'calibre': {
      const url = await bc.book.calibreConvert(record.id)
      const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer())
      return reflow(await openEpub(asBlob(bytes, 'application/epub+zip')))
    }
    case 'zip': case 'cbz': case 'cbr': case 'cb7': case 'cbt': case 'fbz':
      return openArchive(record, ctx)
  }
  return openBytes(record.format, await readBookBytes(record.id), ctx)
}

/** Archives are extracted by the main process (7-Zip): comics become image documents, otherwise the book inside is opened. */
async function openArchive(record: BookRecord, ctx: OpenCtx): Promise<BookSource> {
  const listing = await bc.book.extract(record.id)
  const { IMAGE_RE, openImages } = await import('../engines/paged/images-doc')
  const files = listing.files.filter(f => !/(^|\/)(__MACOSX|\.)/.test(f.path))
  const books = files.filter(f => BOOK_EXT.test(f.path)).sort((a, b) => b.size - a.size)
  const images = files.filter(f => IMAGE_RE.test(f.path))
  const comicLike = ['cbz', 'cbr', 'cb7', 'cbt'].includes(record.format)
  const url = (p: string) => listing.baseUrl + p.split('/').map(encodeURIComponent).join('/')

  if (books.length && !(comicLike && images.length > books.length)) {
    // HTMLZ-style archive: an HTML file with images next to it
    const target = books[0]
    const bytes = new Uint8Array(await (await fetch(url(target.path))).arrayBuffer())
    const name = target.path.split('/').pop()!
    const format = detectFormat(name, bytes.subarray(0, 4096))
    return openBytes(format, bytes, { ...ctx, fileName: name, depth: ctx.depth + 1 })
  }
  if (images.length) {
    const info = files.find(f => /(^|\/)comicinfo\.xml$/i.test(f.path))
    const comicInfo = info ? await (await fetch(url(info.path))).text() : null
    const doc = await openImages(images.map(f => url(f.path)), { comicInfo, title: ctx.title })
    return { kind: 'paged', doc, meta: await doc.getMeta() }
  }
  throw new Error('No readable book found in the archive')
}
