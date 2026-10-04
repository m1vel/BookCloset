import type { BookRecord } from '../../../shared/types'
import { openRecord } from './open'
import { sanitizeHtml } from './sanitize'

/** Resizes a cover to ≤ 480×720 JPEG and computes a pleasant dominant colour. */
export async function processCover(blob: Blob): Promise<{ bytes: Uint8Array; color: string } | null> {
  try {
    const bmp = await createImageBitmap(blob)
    if (bmp.width < 16 || bmp.height < 16) return null
    const scale = Math.min(1, 480 / bmp.width, 720 / bmp.height)
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale)
    const canvas = new OffscreenCanvas(w, h)
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bmp, 0, 0, w, h)
    const out = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.87 })
    // dominant colour: saturation-weighted average over a 24×36 thumbnail
    const t = new OffscreenCanvas(24, 36)
    const tc = t.getContext('2d')!
    tc.drawImage(bmp, 0, 0, 24, 36)
    const { data } = tc.getImageData(0, 0, 24, 36)
    let r = 0, g = 0, b = 0, wsum = 0
    for (let i = 0; i < data.length; i += 4) {
      const R = data[i], G = data[i + 1], B = data[i + 2]
      const max = Math.max(R, G, B), min = Math.min(R, G, B)
      const sat = max ? (max - min) / max : 0
      const weight = 0.15 + sat * sat * 2 + (max > 30 && max < 235 ? 0.3 : 0)
      r += R * weight; g += G * weight; b += B * weight; wsum += weight
    }
    bmp.close()
    const hex = (v: number) => Math.round(v / wsum).toString(16).padStart(2, '0')
    return { bytes: new Uint8Array(await out.arrayBuffer()), color: `#${hex(r)}${hex(g)}${hex(b)}` }
  } catch (e) {
    console.warn('cover processing failed', e)
    return null
  }
}

export async function extractMetadata(book: BookRecord): Promise<{ patch: Partial<BookRecord>; cover?: Uint8Array; color?: string }> {
  const source = await openRecord(book)
  try {
    const m = source.meta
    const patch: Partial<BookRecord> = {}
    if (m.title?.trim()) patch.title = m.title.trim().replace(/\s+/g, ' ')
    if (m.authors?.length) patch.authors = m.authors.map(a => a.replace(/\s+/g, ' ').trim()).filter(Boolean)
    if (m.language) patch.language = m.language
    if (m.description) patch.description = sanitizeHtml(m.description).slice(0, 6000)
    if (m.publisher) patch.publisher = m.publisher
    if (m.published) patch.published = m.published
    if (m.series) patch.series = m.series
    if (m.seriesIndex) patch.seriesIndex = m.seriesIndex
    if (m.subjects?.length) patch.subjects = m.subjects.slice(0, 12)
    let coverBlob: Blob | null = null
    if (source.kind === 'reflow') {
      coverBlob = (await Promise.resolve(source.book.getCover?.()).catch(() => null)) ?? null
    } else {
      patch.pageCount = source.doc.numPages
      coverBlob = await source.doc.getCover().catch(() => null)
    }
    const cover = coverBlob ? await processCover(coverBlob) : null
    return { patch, cover: cover?.bytes, color: cover?.color }
  } finally {
    if (source.kind === 'reflow') source.book.destroy?.()
    else source.doc.destroy()
  }
}
