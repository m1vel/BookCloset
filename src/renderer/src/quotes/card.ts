import type { QuoteCardPrefs } from '../../../shared/types'
import { coverUrl } from '../api'
import { clothFor } from '../components/Cover'

export const CARD_SIZES: Record<QuoteCardPrefs['format'], [number, number]> = {
  square: [1080, 1080],
  story: [1080, 1920],
  wide: [1600, 900],
}

/** `scale` compensates for different x-heights so all fonts look equally large. */
const FONTS: Record<QuoteCardPrefs['font'], { family: string; weight: number; scale: number; italic?: boolean }> = {
  cormorant: { family: "'Cormorant Garamond'", weight: 500, scale: 1.16 },
  literata: { family: "'Literata'", weight: 400, scale: 0.94 },
  manrope: { family: "'Manrope Variable'", weight: 500, scale: 0.92 },
}
const UI_FONT = "'Manrope Variable', 'Segoe UI', sans-serif"
const DISPLAY_FONT = "'Cormorant Garamond', Georgia, serif"

export interface CardBook {
  id: string
  title: string
  authors: string[]
  hasCover: boolean
  coverColor?: string
}

export interface CardInput {
  text: string
  book: CardBook
  chapter?: string
  coverVersion?: number
}

interface Palette { ink: string; muted: string; accent: string; rule: string }

/** Strips wrapping quotes and normalises whitespace while keeping paragraph breaks. */
export function cleanQuote(text: string) {
  return text
    .replace(/\r/g, '')
    .split(/\n\s*\n|\n/)
    .map(p => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .replace(/^[«“"„']+\s*/, '')
    .replace(/\s*[»”"']+$/, '')
}

// ---------------------------------------------------------------- text layout
type Line = { text: string; width: number; paraEnd: boolean }

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): Line[] {
  const lines: Line[] = []
  for (const para of text.split('\n')) {
    const words = para.split(' ')
    let line = ''
    for (let w of words) {
      // break words that are wider than the box on their own (URLs, long compounds)
      while (ctx.measureText(w).width > maxWidth && w.length > 1) {
        let cut = w.length - 1
        while (cut > 1 && ctx.measureText(w.slice(0, cut) + '-').width > maxWidth) cut--
        if (line) { lines.push({ text: line, width: ctx.measureText(line).width, paraEnd: false }); line = '' }
        lines.push({ text: w.slice(0, cut) + '-', width: ctx.measureText(w.slice(0, cut) + '-').width, paraEnd: false })
        w = w.slice(cut)
      }
      const next = line ? `${line} ${w}` : w
      if (line && ctx.measureText(next).width > maxWidth) {
        lines.push({ text: line, width: ctx.measureText(line).width, paraEnd: false })
        line = w
      } else line = next
    }
    if (line) lines.push({ text: line, width: ctx.measureText(line).width, paraEnd: true })
    else if (lines.length) lines[lines.length - 1].paraEnd = true
  }
  return lines
}

/** Narrows the measure while the line count stays the same so the last line is not a lonely word. */
function balanced(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const base = wrap(ctx, text, maxWidth)
  if (base.length < 2 || text.includes('\n')) return base
  let best = base
  for (let w = maxWidth * 0.98; w >= maxWidth * 0.72; w -= maxWidth * 0.02) {
    const l = wrap(ctx, text, w)
    if (l.length !== base.length) break
    best = l
  }
  return best
}

interface Fit { lines: Line[]; size: number; lineHeight: number; truncated: boolean }

function fitText(ctx: CanvasRenderingContext2D, text: string, font: typeof FONTS[keyof typeof FONTS], box: { w: number; h: number }, sizes: { max: number; min: number }): Fit {
  const set = (size: number) => { ctx.font = `${font.italic ? 'italic ' : ''}${font.weight} ${size}px ${font.family}, Georgia, serif` }
  for (let size = sizes.max; size >= sizes.min; size -= 2) {
    set(size)
    const lh = size * 1.42
    const lines = balanced(ctx, text, box.w)
    const paraGaps = lines.filter((l, i) => l.paraEnd && i < lines.length - 1).length
    if (lines.length * lh + paraGaps * size * 0.5 <= box.h) return { lines, size, lineHeight: lh, truncated: false }
  }
  // still too long at the smallest size: cut at a word boundary and add an ellipsis
  const size = sizes.min
  set(size)
  const lh = size * 1.42
  const maxLines = Math.max(1, Math.floor(box.h / lh))
  const lines = wrap(ctx, text, box.w).slice(0, maxLines)
  const last = lines[lines.length - 1]
  let t = last.text
  while (t && ctx.measureText(t + '…').width > box.w) t = t.replace(/\s*\S+$/, '')
  last.text = t.replace(/[\s,.;:—–-]+$/, '') + '…'
  last.width = ctx.measureText(last.text).width
  return { lines, size, lineHeight: lh, truncated: true }
}

// ---------------------------------------------------------------- backgrounds
let grainTile: HTMLCanvasElement | null = null
function grain() {
  if (grainTile) return grainTile
  const c = document.createElement('canvas')
  c.width = c.height = 160
  const g = c.getContext('2d')!
  const img = g.createImageData(160, 160)
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v
    img.data[i + 3] = 14
  }
  g.putImageData(img, 0, 0)
  return (grainTile = c)
}

function hexToRgb(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return [40, 40, 48]
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function drawImageCover(ctx: CanvasRenderingContext2D, img: CanvasImageSource & { width: number; height: number }, W: number, H: number) {
  const s = Math.max(W / img.width, H / img.height)
  const w = img.width * s, h = img.height * s
  ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h)
}

function paint(ctx: CanvasRenderingContext2D, style: QuoteCardPrefs['style'], W: number, H: number, book: CardBook, cover: ImageBitmap | null): Palette {
  if (style === 'paper') {
    ctx.fillStyle = '#f3ead9'
    ctx.fillRect(0, 0, W, H)
    const r = ctx.createRadialGradient(W * 0.3, H * 0.25, 0, W * 0.5, H * 0.5, Math.hypot(W, H) * 0.65)
    r.addColorStop(0, 'rgba(255, 251, 241, .85)')
    r.addColorStop(1, 'rgba(196, 170, 128, .35)')
    ctx.fillStyle = r
    ctx.fillRect(0, 0, W, H)
    ctx.fillStyle = ctx.createPattern(grain(), 'repeat')!
    ctx.fillRect(0, 0, W, H)
    // thin inset frame, like a bookplate
    const m = Math.min(W, H) * 0.035
    ctx.strokeStyle = 'rgba(122, 82, 52, .28)'
    ctx.lineWidth = 2
    ctx.strokeRect(m, m, W - 2 * m, H - 2 * m)
    return { ink: '#2b2119', muted: '#7d6a56', accent: '#9a3d2a', rule: 'rgba(154, 61, 42, .55)' }
  }
  if (style === 'night') {
    const g = ctx.createLinearGradient(0, 0, W, H)
    g.addColorStop(0, '#0e121b')
    g.addColorStop(1, '#1b2132')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)
    const glow = ctx.createRadialGradient(W * 0.15, H * 0.1, 0, W * 0.15, H * 0.1, Math.max(W, H) * 0.75)
    glow.addColorStop(0, 'rgba(227, 178, 90, .16)')
    glow.addColorStop(1, 'rgba(227, 178, 90, 0)')
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, W, H)
    ctx.fillStyle = ctx.createPattern(grain(), 'repeat')!
    ctx.globalAlpha = 0.6
    ctx.fillRect(0, 0, W, H)
    ctx.globalAlpha = 1
    return { ink: '#ece6d9', muted: '#9ba1b2', accent: '#e3b25a', rule: 'rgba(227, 178, 90, .6)' }
  }
  // cover: the book's own cover, blurred, under a dark scrim
  const [r, g, b] = hexToRgb(book.coverColor ?? clothFor(book)[0])
  ctx.fillStyle = `rgb(${r}, ${g}, ${b})`
  ctx.fillRect(0, 0, W, H)
  if (cover) {
    ctx.save()
    ctx.filter = `blur(${Math.round(Math.min(W, H) * 0.07)}px) saturate(1.3)`
    // overdraw so the blur does not fade at the edges
    ctx.translate(-W * 0.08, -H * 0.08)
    drawImageCover(ctx, cover, W * 1.16, H * 1.16)
    ctx.restore()
  }
  const scrim = ctx.createLinearGradient(0, 0, 0, H)
  scrim.addColorStop(0, 'rgba(8, 8, 12, .38)')
  scrim.addColorStop(0.55, 'rgba(8, 8, 12, .5)')
  scrim.addColorStop(1, 'rgba(8, 8, 12, .72)')
  ctx.fillStyle = scrim
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = ctx.createPattern(grain(), 'repeat')!
  ctx.fillRect(0, 0, W, H)
  // accent: the cover colour pushed towards light so it reads on the scrim
  const mix = (v: number) => Math.round(v + (255 - v) * 0.55)
  return { ink: '#ffffff', muted: 'rgba(255, 255, 255, .72)', accent: `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`, rule: 'rgba(255, 255, 255, .5)' }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

function ellipsize(ctx: CanvasRenderingContext2D, text: string, max: number) {
  if (ctx.measureText(text).width <= max) return text
  let t = text
  while (t.length > 1 && ctx.measureText(t + '…').width > max) t = t.slice(0, -1)
  return t.trimEnd() + '…'
}

// ---------------------------------------------------------------- public API
async function loadCover(input: CardInput) {
  if (!input.book.hasCover) return null
  try {
    const res = await fetch(coverUrl(input.book.id, input.coverVersion))
    if (!res.ok) return null
    return await createImageBitmap(await res.blob())
  } catch {
    return null
  }
}

async function ensureFonts(prefs: QuoteCardPrefs, text: string) {
  const f = FONTS[prefs.font]
  await Promise.all([
    document.fonts.load(`${f.weight} 40px ${f.family}`, text.slice(0, 200) || 'Aa'),
    document.fonts.load(`600 40px ${DISPLAY_FONT}`, 'Аа“'),
    document.fonts.load(`italic 500 40px ${DISPLAY_FONT}`, 'Аа'),
    document.fonts.load(`700 20px ${UI_FONT}`, 'АаAa'),
  ]).catch(() => {})
}

/** Draws a quote card at full resolution into `canvas`. Returns whether the quote had to be shortened. */
export async function renderQuoteCard(canvas: HTMLCanvasElement, input: CardInput, prefs: QuoteCardPrefs) {
  const [W, H] = CARD_SIZES[prefs.format]
  const text = cleanQuote(input.text)
  const [cover] = await Promise.all([
    prefs.style === 'cover' || prefs.showCover ? loadCover(input) : Promise.resolve(null),
    ensureFonts(prefs, text),
  ])
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  ctx.textBaseline = 'alphabetic'
  ctx.imageSmoothingQuality = 'high'
  const pal = paint(ctx, prefs.style, W, H, input.book, cover)

  const S = Math.min(W, H)
  const P = Math.round(S * (prefs.format === 'wide' ? 0.085 : 0.1))
  const font = FONTS[prefs.font]

  // opening quote mark
  const markSize = Math.round(S * 0.2)
  ctx.font = `600 ${markSize}px ${DISPLAY_FONT}`
  ctx.fillStyle = pal.accent
  ctx.globalAlpha = prefs.style === 'paper' ? 0.85 : 0.9
  ctx.fillText('“', P - markSize * 0.04, P + markSize * 0.62)
  ctx.globalAlpha = 1

  // footer metrics (bottom-up)
  const thumbH = prefs.showCover && cover ? Math.round(S * 0.16) : 0
  const thumbW = Math.round(thumbH * 0.66)
  const authorSize = Math.round(S * 0.024)
  const titleSize = Math.round(S * 0.038)
  const textBlockH = titleSize * 1.25 * 2 + authorSize * 1.6
  const footerH = Math.max(thumbH, textBlockH)
  const footerTop = H - P - footerH

  // quote box between the mark and the footer
  const boxTop = P + markSize * 0.55
  const boxBottom = footerTop - S * 0.07
  const box = { w: W - 2 * P, h: boxBottom - boxTop }
  const fit = fitText(ctx, text, { ...font }, box, {
    max: Math.round(S * 0.072 * font.scale),
    min: Math.round(S * 0.03 * font.scale),
  })
  const paraGap = fit.size * 0.5
  const gaps = fit.lines.filter((l, i) => l.paraEnd && i < fit.lines.length - 1).length
  const blockH = fit.lines.length * fit.lineHeight + gaps * paraGap
  // optical centre sits a little above the geometric one
  let y = boxTop + Math.max(0, (box.h - blockH) * 0.42) + fit.size * 1.02
  ctx.fillStyle = pal.ink
  for (const l of fit.lines) {
    ctx.fillText(l.text, P, y)
    y += fit.lineHeight + (l.paraEnd ? paraGap : 0)
  }

  // rule
  const ruleY = footerTop - S * 0.035
  ctx.fillStyle = pal.rule
  ctx.fillRect(P, ruleY, S * 0.07, Math.max(2, S * 0.003))

  // cover thumbnail
  let textX = P
  if (thumbH && cover) {
    const ty = footerTop + (footerH - thumbH) / 2
    ctx.save()
    ctx.shadowColor = 'rgba(0, 0, 0, .35)'
    ctx.shadowBlur = S * 0.025
    ctx.shadowOffsetY = S * 0.008
    roundRect(ctx, P, ty, thumbW, thumbH, S * 0.006)
    ctx.fillStyle = '#000'
    ctx.fill()
    ctx.restore()
    ctx.save()
    roundRect(ctx, P, ty, thumbW, thumbH, S * 0.006)
    ctx.clip()
    const s = Math.max(thumbW / cover.width, thumbH / cover.height)
    ctx.drawImage(cover, P + (thumbW - cover.width * s) / 2, ty + (thumbH - cover.height * s) / 2, cover.width * s, cover.height * s)
    ctx.restore()
    textX = P + thumbW + S * 0.035
  }

  // brand (bottom-right) reserves room on the title line
  const brandSize = Math.round(S * 0.026)
  let brandW = 0
  if (prefs.showBrand) {
    ctx.font = `600 ${brandSize}px ${DISPLAY_FONT}`
    const b1 = 'Book', b2 = 'Closet'
    const w1 = ctx.measureText(b1).width
    ctx.font = `italic 500 ${brandSize}px ${DISPLAY_FONT}`
    brandW = w1 + ctx.measureText(b2).width
    const bx = W - P - brandW, by = H - P - brandSize * 0.15
    ctx.globalAlpha = 0.6
    ctx.fillStyle = pal.muted
    ctx.font = `600 ${brandSize}px ${DISPLAY_FONT}`
    ctx.fillText(b1, bx, by)
    ctx.font = `italic 500 ${brandSize}px ${DISPLAY_FONT}`
    ctx.fillText(b2, bx + w1, by)
    ctx.globalAlpha = 1
  }

  // author + title, vertically centred in the footer
  const maxTextW = W - P - textX - (brandW ? brandW + S * 0.04 : 0)
  const author = input.book.authors.slice(0, 2).join(', ')
  const titleFont = `italic 500 ${titleSize}px ${DISPLAY_FONT}`
  ctx.font = titleFont
  const titleLines = wrap(ctx, input.book.title, maxTextW).slice(0, 2)
  if (wrap(ctx, input.book.title, maxTextW).length > 2) titleLines[1].text = ellipsize(ctx, titleLines[1].text + ' …', maxTextW)
  const blockFooterH = (author ? authorSize * 1.6 : 0) + titleLines.length * titleSize * 1.2
  let fy = footerTop + (footerH - blockFooterH) / 2
  if (author) {
    ctx.font = `700 ${authorSize}px ${UI_FONT}`
    ctx.fillStyle = pal.accent
    if ('letterSpacing' in ctx) (ctx as any).letterSpacing = `${(authorSize * 0.14).toFixed(1)}px`
    ctx.fillText(ellipsize(ctx, author.toUpperCase(), maxTextW), textX, fy + authorSize)
    if ('letterSpacing' in ctx) (ctx as any).letterSpacing = '0px'
    fy += authorSize * 1.6
  }
  ctx.font = titleFont
  ctx.fillStyle = pal.ink
  for (const l of titleLines) {
    fy += titleSize * 1.2
    ctx.fillText(l.text, textX, fy - titleSize * 0.22)
  }
  cover?.close()
  return { truncated: fit.truncated }
}

export function canvasToPng(canvas: HTMLCanvasElement) {
  return new Promise<Uint8Array>((resolve, reject) => canvas.toBlob(b => {
    if (!b) return reject(new Error('toBlob failed'))
    b.arrayBuffer().then(buf => resolve(new Uint8Array(buf)), reject)
  }, 'image/png'))
}
