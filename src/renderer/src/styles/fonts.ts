// UI fonts
import '@fontsource-variable/manrope'
import '@fontsource-variable/inter'
import '@fontsource/cormorant-garamond/500.css'
import '@fontsource/cormorant-garamond/600.css'
import '@fontsource/cormorant-garamond/700.css'
import '@fontsource/cormorant-garamond/500-italic.css'

// Reading fonts: the same CSS is injected into book iframes (see engines/reflow/book-css.ts)
import literata400 from '@fontsource/literata/400.css?inline'
import literata400i from '@fontsource/literata/400-italic.css?inline'
import literata700 from '@fontsource/literata/700.css?inline'
import literata700i from '@fontsource/literata/700-italic.css?inline'
import ptSerif400 from '@fontsource/pt-serif/400.css?inline'
import ptSerif400i from '@fontsource/pt-serif/400-italic.css?inline'
import ptSerif700 from '@fontsource/pt-serif/700.css?inline'
import lora400 from '@fontsource/lora/400.css?inline'
import lora400i from '@fontsource/lora/400-italic.css?inline'
import lora700 from '@fontsource/lora/700.css?inline'
import sourceSerif from '@fontsource-variable/source-serif-4/index.css?inline'
import sourceSerifI from '@fontsource-variable/source-serif-4/wght-italic.css?inline'
import ptSans400 from '@fontsource/pt-sans/400.css?inline'
import ptSans400i from '@fontsource/pt-sans/400-italic.css?inline'
import ptSans700 from '@fontsource/pt-sans/700.css?inline'
import interCss from '@fontsource-variable/inter/index.css?inline'
import manropeCss from '@fontsource-variable/manrope/index.css?inline'
import cormorant500 from '@fontsource/cormorant-garamond/500.css?inline'
import cormorant600 from '@fontsource/cormorant-garamond/600.css?inline'

export interface ReadingFont {
  id: string
  label: string
  family: string
  kind: 'serif' | 'sans' | 'original'
}

export const READING_FONTS: ReadingFont[] = [
  { id: 'original', label: 'Original', family: '', kind: 'original' },
  { id: 'Literata', label: 'Literata', family: "'Literata', Georgia, serif", kind: 'serif' },
  { id: 'PT Serif', label: 'PT Serif', family: "'PT Serif', Georgia, serif", kind: 'serif' },
  { id: 'Lora', label: 'Lora', family: "'Lora', Georgia, serif", kind: 'serif' },
  { id: 'Source Serif 4', label: 'Source Serif', family: "'Source Serif 4 Variable', Georgia, serif", kind: 'serif' },
  { id: 'Cormorant Garamond', label: 'Cormorant', family: "'Cormorant Garamond', Georgia, serif", kind: 'serif' },
  { id: 'Georgia', label: 'Georgia', family: 'Georgia, serif', kind: 'serif' },
  { id: 'PT Sans', label: 'PT Sans', family: "'PT Sans', 'Segoe UI', sans-serif", kind: 'sans' },
  { id: 'Inter', label: 'Inter', family: "'Inter Variable', 'Segoe UI', sans-serif", kind: 'sans' },
  { id: 'Manrope', label: 'Manrope', family: "'Manrope Variable', 'Segoe UI', sans-serif", kind: 'sans' },
  { id: 'Segoe UI', label: 'Segoe UI', family: "'Segoe UI', sans-serif", kind: 'sans' },
]

export const fontFamilyOf = (id: string) => READING_FONTS.find(f => f.id === id)?.family ?? ''

const rawFontCss = [
  literata400, literata400i, literata700, literata700i, ptSerif400, ptSerif400i, ptSerif700,
  lora400, lora400i, lora700, sourceSerif, sourceSerifI, ptSans400, ptSans400i, ptSans700,
  interCss, manropeCss, cormorant500, cormorant600,
].join('\n')

/** Font-face CSS with absolute URLs, usable inside blob: iframes. */
export const readingFontCss = rawFontCss.replace(/url\((['"]?)(?!data:|https?:|blob:)([^'")]+)\1\)/g,
  (_m, q, u) => `url(${q}${new URL(u, location.href).href}${q})`)

// Also make the reading fonts available to the app document (font picker previews).
const style = document.createElement('style')
style.textContent = readingFontCss
document.head.append(style)
