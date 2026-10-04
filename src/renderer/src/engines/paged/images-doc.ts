import type { BookMeta, PagedDocument, PageSize, TocItem } from '../../formats/types'

export const IMAGE_RE = /\.(jpe?g|png|gif|webp|avif|bmp|jxl|svg)$/i
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Image failed: ' + src))
    img.src = src
  })
}

/** A comic book / image sequence. `urls` are already resolvable (bc://cache/… or blob:). */
export async function openImages(urls: string[], opts: { comicInfo?: string | null; title?: string } = {}): Promise<PagedDocument & { rtl?: boolean }> {
  const files = [...urls].sort((a, b) => collator.compare(a, b))
  if (!files.length) throw new Error('No images found')
  const first = await loadImage(files[0])
  const base: PageSize = { width: first.naturalWidth, height: first.naturalHeight }
  const sizes: (PageSize | null)[] = files.map((_, i) => (i === 0 ? base : null))
  const listeners: ((i: number) => void)[] = []
  const meta: BookMeta = { title: opts.title }
  let rtl = false
  if (opts.comicInfo) {
    const x = new DOMParser().parseFromString(opts.comicInfo, 'application/xml')
    const get = (t: string) => x.getElementsByTagName(t)[0]?.textContent?.trim() || undefined
    const series = get('Series'), number = get('Number'), title = get('Title')
    meta.title = title || (series ? `${series}${number ? ` #${number}` : ''}` : opts.title)
    meta.series = series
    meta.seriesIndex = number ? Number(number) || undefined : undefined
    const writer = get('Writer')
    meta.authors = writer ? writer.split(/\s*,\s*/) : undefined
    meta.description = get('Summary')
    meta.language = get('LanguageISO')
    meta.publisher = get('Publisher')
    meta.published = get('Year')
    rtl = /RightToLeft/i.test(get('Manga') ?? '')
    meta.rtl = rtl
  }

  // learn real sizes in the background
  ;(async () => {
    for (let i = 1; i < files.length; i++) {
      try {
        const img = await loadImage(files[i])
        const s = { width: img.naturalWidth, height: img.naturalHeight }
        sizes[i] = s
        if (Math.abs(s.width / s.height - base.width / base.height) > 0.02) listeners.forEach(cb => cb(i))
      } catch { /* ignore */ }
    }
  })()

  // scale so that a typical page is ~ 900 css px tall at 100%
  const k = 1100 / Math.max(base.height, 1)

  return {
    kind: 'images',
    numPages: files.length,
    hasText: false,
    rtl,
    getSize: i => {
      const s = sizes[i] ?? base
      return { width: s.width * k, height: s.height * k }
    },
    onSizeChange: cb => { listeners.push(cb) },
    async render(i, host, _w, _h, signal) {
      if (host.querySelector('img.page-img')) return
      const img = document.createElement('img')
      img.className = 'page-img'
      img.decoding = 'async'
      img.draggable = false
      img.src = files[i]
      await img.decode().catch(() => {})
      if (signal.aborted) return
      host.prepend(img)
    },
    async getOutline(): Promise<TocItem[]> {
      return []
    },
    async getMeta() {
      return meta
    },
    async getCover() {
      const res = await fetch(files[0])
      return res.blob()
    },
    destroy() {
      for (const u of files) if (u.startsWith('blob:')) URL.revokeObjectURL(u)
    },
  }
}
