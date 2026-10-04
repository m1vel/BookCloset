import { marked } from 'marked'
import type { BookMeta } from './types'
import { decodeText, sniffMarkupCharset } from './encoding'
import { htmlToChapters, type Chapter } from './html-book'
import { sanitizeDocument } from './sanitize'
import { guessLanguage } from './txt'

export interface ParsedHtml {
  chapters: Chapter[]
  meta: BookMeta
  css: string
  cover: Blob | null
}

/** Pulls <style> blocks (book typography often lives there) without layout-breaking rules. */
function collectCss(doc: Document) {
  return Array.from(doc.querySelectorAll('style'))
    .map(s => s.textContent ?? '')
    .join('\n')
    .replace(/@import[^;]+;/g, '')
    .replace(/position\s*:\s*fixed/gi, 'position: static')
}

function metaFromDoc(doc: Document, fallbackTitle: string): BookMeta {
  const get = (n: string) => doc.querySelector(`meta[name="${n}" i]`)?.getAttribute('content')?.trim()
  const author = get('author') ?? get('dc.creator') ?? get('DC.creator')
  return {
    title: doc.title?.trim() || doc.querySelector('h1')?.textContent?.trim() || fallbackTitle,
    authors: author ? author.split(/\s*[,;&]\s*/) : undefined,
    language: doc.documentElement.lang || get('dc.language') || guessLanguage(doc.body?.textContent ?? ''),
    description: get('description') ?? undefined,
  }
}

function finish(doc: Document, fallbackTitle: string): ParsedHtml {
  sanitizeDocument(doc)
  const meta = metaFromDoc(doc, fallbackTitle)
  const css = collectCss(doc)
  for (const s of Array.from(doc.querySelectorAll('style'))) s.remove()
  // Gutenberg HTML: drop the license boilerplate sections
  for (const el of Array.from(doc.querySelectorAll('#pg-header, #pg-footer, section.pg-boilerplate, .pg-boilerplate'))) el.remove()
  const chapters = htmlToChapters(doc.body, meta.title ?? fallbackTitle)
  return { chapters, meta, css, cover: null }
}

export function parseHtmlBytes(bytes: Uint8Array, fallbackTitle: string): ParsedHtml {
  const { text } = decodeText(bytes, sniffMarkupCharset(bytes))
  const doc = new DOMParser().parseFromString(text, 'text/html')
  // images with relative paths cannot be resolved for a single imported file: drop broken ones gracefully
  for (const img of Array.from(doc.querySelectorAll('img'))) {
    const src = img.getAttribute('src') ?? ''
    if (!/^(data:|https?:|blob:)/i.test(src)) img.replaceWith(Object.assign(doc.createElement('span'), {
      className: 'img-missing', textContent: img.getAttribute('alt') ?? '',
    }))
  }
  return finish(doc, fallbackTitle)
}

// ---------------------------------------------------------------- MHT / MHTML (MIME multipart/related)
interface MimePart { headers: Record<string, string>; body: Uint8Array }

function parseHeaders(block: string) {
  const headers: Record<string, string> = {}
  const unfolded = block.replace(/\r?\n[ \t]+/g, ' ')
  for (const line of unfolded.split(/\r?\n/)) {
    const i = line.indexOf(':')
    if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim()
  }
  return headers
}

function decodeQuotedPrintable(s: string): Uint8Array {
  const out: number[] = []
  const str = s.replace(/=\r?\n/g, '')
  for (let i = 0; i < str.length; i++) {
    const c = str[i]
    if (c === '=' && /^[0-9A-F]{2}$/i.test(str.substr(i + 1, 2))) {
      out.push(parseInt(str.substr(i + 1, 2), 16))
      i += 2
    } else out.push(str.charCodeAt(i) & 0xff)
  }
  return new Uint8Array(out)
}

function base64ToBytes(s: string) {
  const bin = atob(s.replace(/[^A-Za-z0-9+/=]/g, ''))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function parseMime(bytes: Uint8Array): MimePart[] {
  const text = new TextDecoder('latin1').decode(bytes)
  const headerEnd = text.search(/\r?\n\r?\n/)
  const top = parseHeaders(text.slice(0, headerEnd))
  const boundary = top['content-type']?.match(/boundary="?([^";]+)"?/i)?.[1]
  if (!boundary) return []
  const parts: MimePart[] = []
  for (const chunk of text.split('--' + boundary).slice(1)) {
    if (chunk.startsWith('--')) break
    const sep = chunk.search(/\r?\n\r?\n/)
    if (sep < 0) continue
    const headers = parseHeaders(chunk.slice(0, sep).replace(/^\r?\n/, ''))
    const raw = chunk.slice(sep).replace(/^\r?\n\r?\n/, '').replace(/\r?\n$/, '')
    const enc = (headers['content-transfer-encoding'] ?? '').toLowerCase()
    const body = enc === 'base64' ? base64ToBytes(raw)
      : enc === 'quoted-printable' ? decodeQuotedPrintable(raw)
        : Uint8Array.from(raw, c => c.charCodeAt(0) & 0xff)
    parts.push({ headers, body })
  }
  return parts
}

export function parseMht(bytes: Uint8Array, fallbackTitle: string): ParsedHtml {
  const parts = parseMime(bytes)
  const main = parts.find(p => /text\/html/i.test(p.headers['content-type'] ?? '')) ?? parts[0]
  if (!main) throw new Error('Empty MHT archive')
  const charset = main.headers['content-type']?.match(/charset="?([\w-]+)"?/i)?.[1]
  const { text } = decodeText(main.body, charset ?? sniffMarkupCharset(main.body))
  const base = main.headers['content-location'] ?? ''
  const resources = new Map<string, string>()
  for (const p of parts) {
    if (p === main) continue
    const type = (p.headers['content-type'] ?? 'application/octet-stream').split(';')[0]
    const url = URL.createObjectURL(new Blob([p.body as BlobPart], { type }))
    if (p.headers['content-location']) resources.set(p.headers['content-location'], url)
    if (p.headers['content-id']) resources.set('cid:' + p.headers['content-id'].replace(/[<>]/g, ''), url)
  }
  const doc = new DOMParser().parseFromString(text, 'text/html')
  const resolve = (u: string) => {
    if (resources.has(u)) return resources.get(u)!
    try {
      const abs = new URL(u, base || undefined).href
      return resources.get(abs) ?? null
    } catch {
      return null
    }
  }
  for (const el of Array.from(doc.querySelectorAll('img[src], image, source[src]'))) {
    const attr = el.hasAttribute('src') ? 'src' : 'href'
    const r = resolve(el.getAttribute(attr) ?? '')
    if (r) el.setAttribute(attr, r)
  }
  // inline linked stylesheets that are part of the archive
  for (const link of Array.from(doc.querySelectorAll('link[rel~="stylesheet"][href]'))) {
    const part = parts.find(p => {
      try { return p.headers['content-location'] === new URL(link.getAttribute('href')!, base || undefined).href } catch { return false }
    })
    if (part) {
      const style = doc.createElement('style')
      style.textContent = new TextDecoder().decode(part.body)
      link.replaceWith(style)
    }
  }
  return finish(doc, fallbackTitle)
}

// ---------------------------------------------------------------- Markdown
export function parseMarkdown(bytes: Uint8Array, fallbackTitle: string): ParsedHtml {
  const { text } = decodeText(bytes)
  // YAML front matter → metadata
  let src = text
  const meta: BookMeta = {}
  const fm = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/)
  if (fm) {
    src = src.slice(fm[0].length)
    const t = fm[1].match(/^title:\s*["']?(.+?)["']?\s*$/m)
    const a = fm[1].match(/^author:\s*["']?(.+?)["']?\s*$/m)
    if (t) meta.title = t[1]
    if (a) meta.authors = [a[1]]
  }
  const html = marked.parse(src, { async: false, gfm: true }) as string
  const doc = new DOMParser().parseFromString(`<!DOCTYPE html><html><head><title>${meta.title ?? ''}</title></head><body>${html}</body></html>`, 'text/html')
  const parsed = finish(doc, fallbackTitle)
  if (!meta.title) meta.title = doc.querySelector('h1')?.textContent?.trim() || fallbackTitle
  parsed.meta = { ...parsed.meta, ...meta }
  return parsed
}
