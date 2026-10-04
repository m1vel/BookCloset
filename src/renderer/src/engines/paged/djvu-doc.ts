import type { BookMeta, PagedDocument, PageSize, TocItem } from '../../formats/types'

interface Zone { x: number; y: number; width: number; height: number; text: string }

async function waitForDjVu(): Promise<any> {
  for (let i = 0; i < 100 && !window.DjVu; i++) await new Promise(r => setTimeout(r, 50))
  if (!window.DjVu) throw new Error('DjVu.js is not loaded')
  return window.DjVu
}

/** DjVu documents are decoded by DjVu.js in a Web Worker; pages are cached as ImageBitmaps. */
export async function openDjvu(data: Uint8Array): Promise<PagedDocument> {
  const DjVu = await waitForDjVu()
  const worker = new DjVu.Worker(new URL('/vendor/djvu.js', location.href).href)
  const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
  await worker.createDocument(buffer)
  const rawSizes: { width: number; height: number; dpi: number }[] = await worker.doc.getPagesSizes().run()
  const sizes: PageSize[] = rawSizes.map(s => {
    const k = 96 / (s.dpi || 300)
    return { width: s.width * k, height: s.height * k }
  })

  // small LRU of decoded pages
  const bitmaps = new Map<number, ImageBitmap>()
  const pending = new Map<number, Promise<ImageBitmap>>()
  const getBitmap = (i: number) => {
    if (bitmaps.has(i)) {
      const b = bitmaps.get(i)!
      bitmaps.delete(i)
      bitmaps.set(i, b)
      return Promise.resolve(b)
    }
    if (pending.has(i)) return pending.get(i)!
    const p = (async () => {
      const imageData: ImageData = await worker.doc.getPage(i + 1).getImageData().run()
      const bmp = await createImageBitmap(imageData)
      bitmaps.set(i, bmp)
      while (bitmaps.size > 6) {
        const [k, v] = bitmaps.entries().next().value as [number, ImageBitmap]
        v.close()
        bitmaps.delete(k)
      }
      pending.delete(i)
      return bmp
    })()
    p.catch(() => pending.delete(i))
    pending.set(i, p)
    return p
  }
  const textCache = new Map<number, string>()

  return {
    kind: 'djvu',
    numPages: sizes.length,
    hasText: true,
    getSize: i => sizes[i] ?? sizes[0],
    async render(i, host, cssWidth, cssHeight, signal) {
      const bmp = await getBitmap(i)
      if (signal.aborted) return
      const dpr = Math.min(window.devicePixelRatio || 1, 3)
      const canvas = document.createElement('canvas')
      canvas.className = 'page-canvas'
      canvas.width = Math.floor(cssWidth * dpr)
      canvas.height = Math.floor(cssHeight * dpr)
      const ctx = canvas.getContext('2d', { alpha: false })!
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
      host.querySelector('.page-canvas')?.remove()
      host.prepend(canvas)

      if (!host.querySelector('.textLayer')) {
        const zones: Zone[] | null = await worker.doc.getPage(i + 1).getNormalizedTextZones().run().catch(() => null)
        if (signal.aborted || !zones?.length) return
        const raw = rawSizes[i]
        const layer = document.createElement('div')
        layer.className = 'textLayer djvu-text'
        const kx = 100 / raw.width, ky = 100 / raw.height
        for (const z of zones) {
          const span = document.createElement('span')
          span.textContent = z.text
          // DjVu text coordinates have their origin at the bottom-left corner
          const top = raw.height - z.y - z.height
          Object.assign(span.style, {
            left: `${z.x * kx}%`, top: `${top * ky}%`, width: `${z.width * kx}%`, height: `${z.height * ky}%`,
            fontSize: `${(z.height / raw.height) * cssHeight * 0.86}px`,
          })
          span.dataset.w = String(z.width / raw.width)
          layer.append(span)
        }
        host.append(layer)
        // stretch each word to its box width
        requestAnimationFrame(() => {
          for (const span of Array.from(layer.children) as HTMLElement[]) {
            const target = Number(span.dataset.w) * cssWidth
            const natural = span.scrollWidth || 1
            span.style.transform = `scaleX(${target / natural})`
          }
        })
      }
    },
    async getText(i) {
      if (textCache.has(i)) return textCache.get(i)!
      const t: string = await worker.doc.getPage(i + 1).getText().run().catch(() => '')
      textCache.set(i, t ?? '')
      return t ?? ''
    },
    async getOutline() {
      const contents: any[] | null = await worker.doc.getContents().run().catch(() => null)
      if (!contents) return []
      const conv = async (items: any[]): Promise<TocItem[]> => Promise.all(items.map(async it => {
        let page = 0
        try { page = ((await worker.doc.getPageNumberByUrl(it.url).run()) ?? 1) - 1 } catch { /* ignore */ }
        return { label: it.description, href: page, subitems: it.children?.length ? await conv(it.children) : null }
      }))
      return conv(contents)
    },
    async getMeta(): Promise<BookMeta> {
      return {}
    },
    async getCover() {
      const bmp = await getBitmap(0)
      const h = 600, w = Math.round(bmp.width * (h / bmp.height))
      const canvas = new OffscreenCanvas(w, h)
      const ctx = canvas.getContext('2d')!
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(bmp, 0, 0, w, h)
      return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.88 })
    },
    destroy() {
      worker.terminate()
      for (const b of bitmaps.values()) b.close()
      bitmaps.clear()
    },
  }
}
