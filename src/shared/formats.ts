import type { BookFormat } from './types'

/** Extensions we accept on import / open dialogs (lower-case, without dot). */
export const SUPPORTED_EXTENSIONS = [
  'epub', 'kepub', 'mobi', 'azw', 'azw3', 'kf8', 'prc', 'pdb', 'fb2', 'fbz', 'pdf', 'djvu', 'djv',
  'txt', 'text', 'log', 'md', 'markdown', 'html', 'htm', 'xhtml', 'xht', 'mht', 'mhtml',
  'rtf', 'docx', 'doc', 'odt', 'chm', 'cbz', 'cbr', 'cb7', 'cbt', 'zip', 'rar', '7z',
  'jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bmp',
  // handled through Calibre if it is installed
  'lit', 'lrf', 'snb', 'tcr', 'pml', 'rb', 'tcr', 'htmlz', 'txtz', 'azw4', 'pmlz', 'oxps', 'xps',
]

export const CALIBRE_ONLY = new Set(['lit', 'lrf', 'snb', 'tcr', 'pml', 'pmlz', 'rb', 'azw4', 'oxps', 'xps'])

export const FORMAT_LABEL: Record<BookFormat, string> = {
  epub: 'EPUB', mobi: 'MOBI', azw3: 'AZW3', fb2: 'FB2', fbz: 'FB2.ZIP', pdf: 'PDF', djvu: 'DjVu',
  txt: 'TXT', html: 'HTML', mht: 'MHT', md: 'Markdown', rtf: 'RTF', docx: 'DOCX', doc: 'DOC',
  odt: 'ODT', chm: 'CHM', cbz: 'CBZ', cbr: 'CBR', cb7: 'CB7', cbt: 'CBT', image: 'IMG', pdb: 'PDB',
  zip: 'ZIP', calibre: 'Calibre', unknown: '?',
}

/** Formats rendered by the fixed-page engine. */
export const PAGED_FORMATS = new Set<BookFormat>(['pdf', 'djvu', 'cbz', 'cbr', 'cb7', 'cbt', 'image'])

const ascii = (b: Uint8Array, start: number, len: number) =>
  String.fromCharCode(...b.subarray(start, start + len))

/** Normalised extension of a file name; `book.fb2.zip` → `fbz`. */
export function extOf(name: string): string {
  const lower = name.toLowerCase()
  if (lower.endsWith('.fb2.zip')) return 'fbz'
  const m = lower.match(/\.([a-z0-9]+)$/)
  return m ? m[1] : ''
}

/**
 * Detects the book format from the first bytes of the file plus its extension.
 * `head` should contain at least 512 bytes when available.
 */
export function detectFormat(name: string, head: Uint8Array): BookFormat {
  const ext = extOf(name)
  const b = head
  const has = (s: string, at = 0) => ascii(b, at, s.length) === s

  if (has('%PDF')) return 'pdf'
  if (has('AT&TFORM') || (has('FORM') && (has('DJVU', 8) || has('DJVM', 8)))) return 'djvu'
  if (b.length > 68 && has('BOOKMOBI', 60)) return ext === 'azw3' || ext === 'kf8' ? 'azw3' : 'mobi'
  if (b.length > 68 && has('TEXtREAd', 60)) return 'pdb'
  if (has('{\\rtf')) return 'rtf'
  if (has('ITSF')) return 'chm'
  if (has('Rar!')) return ext === 'cbr' || ext === 'rar' ? 'cbr' : 'cbr'
  if (b[0] === 0x37 && b[1] === 0x7a && b[2] === 0xbc && b[3] === 0xaf) return 'cb7'
  if (b.length > 262 && has('ustar', 257)) return 'cbt'
  if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) return 'doc'
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image'
  if (b[0] === 0x89 && has('PNG', 1)) return 'image'
  if (has('GIF8')) return 'image'
  if (has('RIFF') && has('WEBP', 8)) return 'image'
  if (has('PK\x03\x04') || has('PK\x05\x06')) {
    // zip family: the mimetype entry of EPUB/ODT is stored uncompressed right after the header
    const head = ascii(b, 30, Math.min(b.length - 30, 120))
    if (head.startsWith('mimetypeapplication/epub+zip')) return 'epub'
    if (head.startsWith('mimetypeapplication/vnd.oasis.opendocument')) return 'odt'
    switch (ext) {
      case 'epub': case 'kepub': return 'epub'
      case 'docx': return 'docx'
      case 'odt': return 'odt'
      case 'cbz': return 'cbz'
      case 'fbz': return 'fbz'
      case 'htmlz': case 'txtz': return 'zip'
      default: return 'zip'
    }
  }
  // text-like formats: look at the beginning
  const text = new TextDecoder('latin1').decode(b.subarray(0, 512)).trimStart().replace(/^\uFEFF|^ï»¿/, '')
  if (/^<\?xml[^>]*>\s*<FictionBook/i.test(text) || /<FictionBook/i.test(text)) return 'fb2'
  if (/^(MIME-Version|From|Content-Type|Subject|Date):/im.test(text) && /multipart\/related/i.test(new TextDecoder('latin1').decode(b))) return 'mht'

  switch (ext) {
    case 'epub': case 'kepub': return 'epub'
    case 'mobi': case 'prc': case 'azw': return 'mobi'
    case 'azw3': case 'kf8': return 'azw3'
    case 'fb2': return 'fb2'
    case 'fbz': return 'fbz'
    case 'pdf': return 'pdf'
    case 'djvu': case 'djv': return 'djvu'
    case 'md': case 'markdown': return 'md'
    case 'html': case 'htm': case 'xhtml': case 'xht': return 'html'
    case 'mht': case 'mhtml': return 'mht'
    case 'rtf': return 'rtf'
    case 'docx': return 'docx'
    case 'doc': return 'doc'
    case 'odt': return 'odt'
    case 'chm': return 'chm'
    case 'cbz': return 'cbz'
    case 'cbr': case 'rar': return 'cbr'
    case 'cb7': case '7z': return 'cb7'
    case 'cbt': return 'cbt'
    case 'pdb': return 'pdb'
    case 'zip': return 'zip'
    case 'txt': case 'text': case 'log': return 'txt'
    case 'jpg': case 'jpeg': case 'png': case 'webp': case 'gif': case 'avif': case 'bmp': return 'image'
  }
  if (CALIBRE_ONLY.has(ext)) return 'calibre'
  if (/^<!doctype html|^<html/i.test(text)) return 'html'
  // anything else that looks like text
  let printable = 0
  const n = Math.min(b.length, 512)
  for (let i = 0; i < n; i++) if (b[i] >= 9 && b[i] !== 0) printable++
  if (n && printable / n > 0.97) return 'txt'
  return 'unknown'
}
