import { unzipSync, strFromU8 } from 'fflate'
import type { BookMeta } from './types'
import { escapeHtml } from './encoding'
import { htmlToChapters, type Chapter } from './html-book'
import { guessLanguage } from './txt'

export interface ParsedDoc {
  chapters: Chapter[]
  meta: BookMeta
  cover?: Blob | null
}

const textOfXml = (doc: Document, tag: string) => doc.getElementsByTagName(tag)[0]?.textContent?.trim() || undefined

// ---------------------------------------------------------------- DOCX (mammoth)
export async function parseDocx(bytes: Uint8Array, fallbackTitle: string): Promise<ParsedDoc> {
  const mammoth = (await import('mammoth')).default ?? (await import('mammoth'))
  const result = await (mammoth as any).convertToHtml(
    { arrayBuffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) },
    {
      styleMap: [
        "p[style-name='Title'] => h1.doc-title:fresh",
        "p[style-name='Subtitle'] => p.subtitle:fresh",
        "p[style-name='Quote'] => blockquote > p:fresh",
        "p[style-name='Intense Quote'] => blockquote > p:fresh",
        "p[style-name='Заголовок'] => h1:fresh",
        "p[style-name='Название'] => h1.doc-title:fresh",
      ],
    },
  )
  const meta: BookMeta = {}
  try {
    const files = unzipSync(bytes, { filter: f => f.name === 'docProps/core.xml' })
    const core = files['docProps/core.xml']
    if (core) {
      const x = new DOMParser().parseFromString(strFromU8(core), 'application/xml')
      meta.title = textOfXml(x, 'dc:title')
      const creator = textOfXml(x, 'dc:creator')
      if (creator) meta.authors = creator.split(/\s*[;,]\s*/)
      meta.language = textOfXml(x, 'dc:language')
      meta.description = textOfXml(x, 'dc:description')
    }
  } catch { /* metadata is optional */ }
  const doc = new DOMParser().parseFromString(`<body>${result.value}</body>`, 'text/html')
  // a document title styled as "Title" is not a chapter break
  const docTitle = doc.querySelector('h1.doc-title')
  if (docTitle && !meta.title) meta.title = docTitle.textContent?.trim()
  if (docTitle && doc.querySelectorAll('h1').length > 1) {
    const p = doc.createElement('p')
    p.className = 'bc-title center'
    p.innerHTML = `<strong style="font-size:1.6em">${docTitle.innerHTML}</strong>`
    docTitle.replaceWith(p)
  }
  meta.language ||= guessLanguage(doc.body.textContent ?? '')
  return { chapters: htmlToChapters(doc.body, meta.title || fallbackTitle), meta: { ...meta, title: meta.title || fallbackTitle } }
}

// ---------------------------------------------------------------- RTF (rtf.js)
export async function parseRtf(bytes: Uint8Array, fallbackTitle: string): Promise<ParsedDoc> {
  const { RTFJS, WMFJS, EMFJS } = await import('rtf.js')
  RTFJS.loggingEnabled(false)
  WMFJS.loggingEnabled(false)
  EMFJS.loggingEnabled(false)
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const rtf = new RTFJS.Document(ab, {})
  const meta = rtf.metadata() as Record<string, any>
  const elements = await rtf.render()

  // normalise: paragraphs become <p>, big short paragraphs become headings
  const sizeOf = (el: HTMLElement) => {
    let max = parseFloat(el.style.fontSize) || 0
    for (const s of Array.from(el.querySelectorAll<HTMLElement>('[style*="font-size"]'))) max = Math.max(max, parseFloat(s.style.fontSize) || 0)
    return max
  }
  const sizes = elements.map(e => sizeOf(e)).filter(Boolean).sort((a, b) => a - b)
  const base = sizes[Math.floor(sizes.length / 2)] || 12
  const out: string[] = []
  for (const el of elements) {
    const text = el.textContent?.replace(/\s+/g, ' ').trim() ?? ''
    const hasImg = !!el.querySelector('img, svg')
    if (!text && !hasImg) { out.push('<p class="empty"></p>'); continue }
    const size = sizeOf(el)
    const align = el.style.textAlign
    for (const s of Array.from(el.querySelectorAll<HTMLElement>('[style]'))) {
      s.style.removeProperty('font-family')
      s.style.removeProperty('font-size')
      s.style.removeProperty('line-height')
      if (s.style.color === 'rgb(0, 0, 0)') s.style.removeProperty('color')
    }
    const inner = el.innerHTML
    if (!hasImg && text.length < 120 && size >= base * 1.25) {
      const tag = size >= base * 1.7 ? 'h1' : 'h2'
      out.push(`<${tag}>${escapeHtml(text)}</${tag}>`)
    } else {
      const indent = parseFloat(el.style.textIndent) > 0
      const cls = align === 'center' ? 'center' : indent ? '' : 'noindent'
      out.push(`<p${cls ? ` class="${cls}"` : ''}${align === 'right' ? ' style="text-align:right"' : ''}>${inner}</p>`)
    }
  }
  const doc = new DOMParser().parseFromString(`<body>${out.join('')}</body>`, 'text/html')
  const title = (meta.title as string) || doc.querySelector('h1')?.textContent?.trim() || fallbackTitle
  return {
    chapters: htmlToChapters(doc.body, title),
    meta: {
      title,
      authors: meta.author ? [String(meta.author)] : undefined,
      language: guessLanguage(doc.body.textContent ?? ''),
    },
  }
}

// ---------------------------------------------------------------- ODT (OpenDocument Text)
const NS = {
  text: 'urn:oasis:names:tc:opendocument:xmlns:text:1.0',
  style: 'urn:oasis:names:tc:opendocument:xmlns:style:1.0',
  fo: 'urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0',
  draw: 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0',
  xlink: 'http://www.w3.org/1999/xlink',
  table: 'urn:oasis:names:tc:opendocument:xmlns:table:1.0',
  office: 'urn:oasis:names:tc:opendocument:xmlns:office:1.0',
}

interface OdtStyle { bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; align?: string; sup?: boolean; sub?: boolean; parent?: string }

export async function parseOdt(bytes: Uint8Array, fallbackTitle: string): Promise<ParsedDoc> {
  const files = unzipSync(bytes)
  const content = files['content.xml']
  if (!content) throw new Error('content.xml not found')
  const xml = new DOMParser().parseFromString(strFromU8(content), 'application/xml')
  const stylesXml = files['styles.xml'] ? new DOMParser().parseFromString(strFromU8(files['styles.xml']), 'application/xml') : null

  // collect styles (automatic + common)
  const styles = new Map<string, OdtStyle>()
  for (const root of [stylesXml, xml]) {
    if (!root) continue
    for (const s of Array.from(root.getElementsByTagNameNS(NS.style, 'style'))) {
      const name = s.getAttributeNS(NS.style, 'name')!
      const tp = s.getElementsByTagNameNS(NS.style, 'text-properties')[0]
      const pp = s.getElementsByTagNameNS(NS.style, 'paragraph-properties')[0]
      styles.set(name, {
        parent: s.getAttributeNS(NS.style, 'parent-style-name') ?? undefined,
        bold: tp?.getAttributeNS(NS.fo, 'font-weight') === 'bold' || undefined,
        italic: tp?.getAttributeNS(NS.fo, 'font-style') === 'italic' || undefined,
        underline: (tp?.getAttributeNS(NS.style, 'text-underline-style') ?? 'none') !== 'none' || undefined,
        strike: (tp?.getAttributeNS(NS.style, 'text-line-through-style') ?? 'none') !== 'none' || undefined,
        sup: /^super/.test(tp?.getAttributeNS(NS.style, 'text-position') ?? '') || undefined,
        sub: /^sub/.test(tp?.getAttributeNS(NS.style, 'text-position') ?? '') || undefined,
        align: pp?.getAttributeNS(NS.fo, 'text-align') ?? undefined,
      })
    }
  }
  const resolveStyle = (name: string | null, depth = 0): OdtStyle => {
    if (!name || depth > 6) return {}
    const s = styles.get(name)
    if (!s) return {}
    return { ...resolveStyle(s.parent ?? null, depth + 1), ...Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined)) }
  }
  const images = new Map<string, string>()
  const imageUrl = (href: string) => {
    if (images.has(href)) return images.get(href)!
    const data = files[href.replace(/^\.\//, '')]
    if (!data) return ''
    const ext = href.split('.').pop()?.toLowerCase()
    const type = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'svg' ? 'image/svg+xml' : 'image/jpeg'
    const url = URL.createObjectURL(new Blob([data as BlobPart], { type }))
    images.set(href, url)
    return url
  }
  const notes: string[] = []

  const inline = (node: Node): string => {
    let out = ''
    for (const n of Array.from(node.childNodes)) {
      if (n.nodeType === 3) { out += escapeHtml(n.textContent ?? ''); continue }
      if (n.nodeType !== 1) continue
      const el = n as Element
      const ln = el.localName
      if (el.namespaceURI === NS.text) {
        if (ln === 'span') {
          const st = resolveStyle(el.getAttributeNS(NS.text, 'style-name'))
          let s = inline(el)
          if (st.bold) s = `<strong>${s}</strong>`
          if (st.italic) s = `<em>${s}</em>`
          if (st.underline) s = `<u>${s}</u>`
          if (st.strike) s = `<s>${s}</s>`
          if (st.sup) s = `<sup>${s}</sup>`
          if (st.sub) s = `<sub>${s}</sub>`
          out += s
        } else if (ln === 's') out += '&nbsp;'.repeat(Number(el.getAttributeNS(NS.text, 'c') ?? 1))
        else if (ln === 'tab') out += '&emsp;'
        else if (ln === 'line-break') out += '<br>'
        else if (ln === 'a') out += `<a href="${escapeHtml(el.getAttributeNS(NS.xlink, 'href') ?? '')}">${inline(el)}</a>`
        else if (ln === 'note') {
          const body = el.getElementsByTagNameNS(NS.text, 'note-body')[0]
          const id = `odt-note-${notes.length + 1}`
          notes.push(`<aside id="${id}" epub:type="footnote"><p><sup>${notes.length + 1}</sup> ${body ? block(body) : ''}</p></aside>`)
          out += `<sup class="fn"><a href="#${id}" epub:type="noteref">${notes.length}</a></sup>`
        } else if (ln === 'bookmark' || ln === 'bookmark-start') out += `<a id="${escapeHtml(el.getAttributeNS(NS.text, 'name') ?? '')}"></a>`
        else if (ln !== 'soft-page-break' && ln !== 'bookmark-end') out += inline(el)
      } else if (el.namespaceURI === NS.draw) {
        if (ln === 'frame') out += inline(el)
        else if (ln === 'image') {
          const src = imageUrl(el.getAttributeNS(NS.xlink, 'href') ?? '')
          if (src) out += `<img src="${src}" alt="">`
        } else if (ln === 'text-box') out += block(el)
      } else out += inline(el)
    }
    return out
  }

  const block = (node: Element): string => {
    let out = ''
    for (const el of Array.from(node.children)) {
      const ln = el.localName
      if (el.namespaceURI === NS.text) {
        if (ln === 'h') {
          const level = Math.min(4, Number(el.getAttributeNS(NS.text, 'outline-level') ?? 1))
          out += `<h${level}>${inline(el)}</h${level}>`
        } else if (ln === 'p') {
          const st = resolveStyle(el.getAttributeNS(NS.text, 'style-name'))
          let s = inline(el)
          if (st.bold) s = `<strong>${s}</strong>`
          if (st.italic) s = `<em>${s}</em>`
          const cls = st.align === 'center' ? ' class="center"' : ''
          out += s.trim() ? `<p${cls}${st.align === 'end' || st.align === 'right' ? ' style="text-align:right"' : ''}>${s}</p>` : '<p class="empty"></p>'
        } else if (ln === 'list') {
          out += '<ul>' + Array.from(el.children).map(li => `<li>${block(li)}</li>`).join('') + '</ul>'
        } else if (ln === 'section' || ln === 'list-item') out += block(el)
      } else if (el.namespaceURI === NS.table && ln === 'table') {
        out += '<table>' + Array.from(el.getElementsByTagNameNS(NS.table, 'table-row')).map(tr =>
          '<tr>' + Array.from(tr.getElementsByTagNameNS(NS.table, 'table-cell')).map(td => `<td>${block(td)}</td>`).join('') + '</tr>').join('') + '</table>'
      }
    }
    return out
  }

  const body = xml.getElementsByTagNameNS(NS.office, 'text')[0]
  const html = (body ? block(body) : '') + (notes.length ? `<hr>${notes.join('')}` : '')
  const meta: BookMeta = {}
  if (files['meta.xml']) {
    const m = new DOMParser().parseFromString(strFromU8(files['meta.xml']), 'application/xml')
    meta.title = textOfXml(m, 'dc:title')
    const creator = textOfXml(m, 'meta:initial-creator') ?? textOfXml(m, 'dc:creator')
    if (creator) meta.authors = [creator]
    meta.language = textOfXml(m, 'dc:language')
    meta.description = textOfXml(m, 'dc:description')
  }
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  meta.title ||= doc.querySelector('h1')?.textContent?.trim() || fallbackTitle
  meta.language ||= guessLanguage(doc.body.textContent ?? '')
  // the cover: first picture of the document if it appears before any text
  return { chapters: htmlToChapters(doc.body, meta.title), meta }
}

// ---------------------------------------------------------------- PalmDOC (.pdb / .prc "TEXtREAd")
export function decodePalmDoc(bytes: Uint8Array): Uint8Array {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const numRecords = dv.getUint16(76)
  const offsets: number[] = []
  for (let i = 0; i < numRecords; i++) offsets.push(dv.getUint32(78 + i * 8))
  offsets.push(bytes.length)
  const rec0 = bytes.subarray(offsets[0], offsets[1])
  const r0 = new DataView(rec0.buffer, rec0.byteOffset, rec0.byteLength)
  const compression = r0.getUint16(0)
  const textRecords = r0.getUint16(8)
  const chunks: number[] = []
  for (let i = 1; i <= textRecords && i < numRecords; i++) {
    const rec = bytes.subarray(offsets[i], offsets[i + 1])
    if (compression === 2) {
      // PalmDOC LZ77
      let j = 0
      while (j < rec.length) {
        const c = rec[j++]
        if (c >= 1 && c <= 8) { for (let k = 0; k < c && j < rec.length; k++) chunks.push(rec[j++]) }
        else if (c < 0x80) chunks.push(c)
        else if (c >= 0xc0) { chunks.push(0x20); chunks.push(c ^ 0x80) }
        else {
          const pair = (c << 8) | rec[j++]
          const dist = (pair >> 3) & 0x7ff
          const len = (pair & 7) + 3
          const start = chunks.length - dist
          for (let k = 0; k < len; k++) chunks.push(chunks[start + k])
        }
      }
    } else for (const b of rec) chunks.push(b)
  }
  return Uint8Array.from(chunks)
}

export function pdbName(bytes: Uint8Array) {
  return new TextDecoder('latin1').decode(bytes.subarray(0, 32)).replace(/\0.*$/, '').trim()
}
