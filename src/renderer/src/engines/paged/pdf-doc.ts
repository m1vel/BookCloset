import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import type { BookMeta, PagedDocument, PageSize, TocItem } from '../../formats/types'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

const PT_TO_PX = 96 / 72

export interface LinkTarget { page?: number; url?: string }

export async function openPdf(data: Uint8Array, onLink?: (t: LinkTarget) => void): Promise<PagedDocument & { onLink?: (t: LinkTarget) => void }> {
  const origin = location.origin
  const task = pdfjs.getDocument({
    data,
    cMapUrl: `${origin}/pdfjs/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${origin}/pdfjs/standard_fonts/`,
    wasmUrl: `${origin}/pdfjs/wasm/`,
    iccUrl: `${origin}/pdfjs/iccs/`,
    isEvalSupported: false,
    enableXfa: false,
  } as any)
  const pdf = await task.promise
  const first = await pdf.getPage(1)
  const vp1 = first.getViewport({ scale: 1 })
  const sizes: PageSize[] = Array.from({ length: pdf.numPages }, () => ({ width: vp1.width * PT_TO_PX, height: vp1.height * PT_TO_PX }))
  const sizeListeners: ((i: number) => void)[] = []
  // refine sizes of all pages in the background (mixed page sizes are common in scans)
  ;(async () => {
    for (let i = 2; i <= pdf.numPages; i++) {
      try {
        const p = await pdf.getPage(i)
        const vp = p.getViewport({ scale: 1 })
        const s = { width: vp.width * PT_TO_PX, height: vp.height * PT_TO_PX }
        if (Math.abs(s.width - sizes[i - 1].width) > 1 || Math.abs(s.height - sizes[i - 1].height) > 1) {
          sizes[i - 1] = s
          sizeListeners.forEach(cb => cb(i - 1))
        }
      } catch { /* ignore */ }
      if (i % 50 === 0) await new Promise(r => setTimeout(r, 0))
    }
  })()

  const textCache = new Map<number, string>()
  const resolveDest = async (dest: any): Promise<number | null> => {
    try {
      const explicit = typeof dest === 'string' ? await pdf.getDestination(dest) : dest
      if (!Array.isArray(explicit)) return null
      const ref = explicit[0]
      return typeof ref === 'number' ? ref : await pdf.getPageIndex(ref)
    } catch {
      return null
    }
  }

  const doc: PagedDocument & { onLink?: (t: LinkTarget) => void } = {
    kind: 'pdf',
    numPages: pdf.numPages,
    hasText: true,
    onLink,
    getSize: i => sizes[i],
    onSizeChange: cb => { sizeListeners.push(cb) },
    async render(i, host, cssWidth, _cssHeight, signal) {
      const page = await pdf.getPage(i + 1)
      if (signal.aborted) return
      const base = page.getViewport({ scale: 1 })
      const scale = cssWidth / base.width
      const viewport = page.getViewport({ scale })
      const dpr = Math.min(window.devicePixelRatio || 1, 3)
      const canvas = document.createElement('canvas')
      canvas.className = 'page-canvas'
      canvas.width = Math.floor(viewport.width * dpr)
      canvas.height = Math.floor(viewport.height * dpr)
      const ctx = canvas.getContext('2d', { alpha: false })!
      const task = page.render({
        canvas,
        canvasContext: ctx,
        viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
        background: 'white',
      } as any)
      const abort = () => task.cancel()
      signal.addEventListener('abort', abort)
      try {
        await task.promise
      } catch (e: any) {
        if (e?.name === 'RenderingCancelledException') return
        throw e
      } finally {
        signal.removeEventListener('abort', abort)
      }
      if (signal.aborted) return
      host.querySelector('.page-canvas')?.remove()
      host.prepend(canvas)

      // selectable text
      if (!host.querySelector('.textLayer')) {
        const textDiv = document.createElement('div')
        textDiv.className = 'textLayer'
        host.style.setProperty('--scale-factor', String(scale))
        host.style.setProperty('--total-scale-factor', String(scale))
        host.append(textDiv)
        try {
          const tl = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: textDiv, viewport })
          await tl.render()
        } catch { /* text layer is optional */ }
      } else {
        host.style.setProperty('--scale-factor', String(scale))
        host.style.setProperty('--total-scale-factor', String(scale))
      }

      // links
      host.querySelector('.link-layer')?.remove()
      try {
        const annots = await page.getAnnotations({ intent: 'display' })
        const links = annots.filter((a: any) => a.subtype === 'Link' && (a.url || a.dest))
        if (links.length) {
          const layer = document.createElement('div')
          layer.className = 'link-layer'
          for (const a of links as any[]) {
            const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(a.rect)
            const el = document.createElement('a')
            el.className = 'pdf-link'
            Object.assign(el.style, {
              left: `${Math.min(x1, x2)}px`, top: `${Math.min(y1, y2)}px`,
              width: `${Math.abs(x2 - x1)}px`, height: `${Math.abs(y2 - y1)}px`,
            })
            if (a.url) el.title = a.url
            el.addEventListener('click', async e => {
              e.preventDefault()
              if (a.url) doc.onLink?.({ url: a.url })
              else {
                const p = await resolveDest(a.dest)
                if (p != null) doc.onLink?.({ page: p })
              }
            })
            layer.append(el)
          }
          host.append(layer)
        }
      } catch { /* ignore */ }
    },
    async getText(i) {
      if (textCache.has(i)) return textCache.get(i)!
      const page = await pdf.getPage(i + 1)
      const tc = await page.getTextContent()
      const text = tc.items.map((it: any) => (it.str ?? '') + (it.hasEOL ? '\n' : '')).join('')
      textCache.set(i, text)
      return text
    },
    async getOutline() {
      const outline = await pdf.getOutline().catch(() => null)
      if (!outline) return []
      const conv = async (items: any[]): Promise<TocItem[]> => Promise.all(items.map(async it => ({
        label: it.title,
        href: (await resolveDest(it.dest)) ?? 0,
        subitems: it.items?.length ? await conv(it.items) : null,
      })))
      return conv(outline)
    },
    async getMeta() {
      const m: any = await pdf.getMetadata().catch(() => null)
      const info = m?.info ?? {}
      const xmp = m?.metadata
      const meta: BookMeta = {
        title: (xmp?.get?.('dc:title') as string) || info.Title || undefined,
        authors: ((xmp?.get?.('dc:creator') as string[] | string) || info.Author)
          ? [xmp?.get?.('dc:creator') ?? info.Author].flat().filter(Boolean).flatMap((a: string) => String(a).split(/\s*;\s*/))
          : undefined,
        description: info.Subject || undefined,
        language: info.Language || undefined,
        published: typeof info.CreationDate === 'string' ? info.CreationDate.replace(/^D:/, '').slice(0, 4) : undefined,
      }
      if (meta.title && /^(untitled|microsoft word - |\s*$)/i.test(meta.title)) meta.title = meta.title.replace(/^microsoft word - /i, '').replace(/\.docx?$/i, '') || undefined
      return meta
    },
    async getCover() {
      const page = await pdf.getPage(1)
      const vp = page.getViewport({ scale: 1 })
      const scale = 600 / vp.height
      const viewport = page.getViewport({ scale })
      const canvas = document.createElement('canvas')
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport, background: 'white' } as any).promise
      return new Promise(res => canvas.toBlob(b => res(b), 'image/jpeg', 0.88))
    },
    destroy() {
      pdf.destroy()
    },
  }
  return doc
}
