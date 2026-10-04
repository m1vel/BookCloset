import type { BookMeta } from './types'
import { escapeHtml } from './encoding'
import type { Chapter } from './html-book'

const CHAPTER_WORDS = [
  'глава', 'часть', 'книга', 'том', 'раздел', 'пролог', 'эпилог', 'предисловие', 'послесловие', 'введение',
  'заключение', 'вступление', 'приложение', 'действие', 'явление', 'акт', 'сцена',
  'chapter', 'part', 'book', 'volume', 'prologue', 'epilogue', 'preface', 'foreword', 'afterword',
  'introduction', 'conclusion', 'appendix', 'act', 'scene', 'kapitel', 'teil', 'chapitre', 'partie', 'capítulo', 'capitolo',
]
const CHAPTER_RE = new RegExp(`^(${CHAPTER_WORDS.join('|')})(\\s+[\\wА-Яа-яЁё.\\-–—:IVXLCDM]+.{0,70})?$|^(${CHAPTER_WORDS.join('|')})$`, 'iu')
const ROMAN_RE = /^[IVXLCDM]{1,7}\.?(\s+[^.!?]{1,70})?$/
const NUMBER_RE = /^\d{1,3}\.?$/
const SCENE_RE = /^(\*\s*){3,}$|^(\*\s*){1,3}$|^[-–—~•·◦#]{3,}$|^(\s*[*•]\s*){3}$/

function isHeadingLine(line: string) {
  const s = line.trim()
  if (!s || s.length > 90) return false
  if (CHAPTER_RE.test(s)) return true
  if (ROMAN_RE.test(s)) return true
  if (NUMBER_RE.test(s)) return true
  return false
}

/** Parses Project Gutenberg boilerplate, returning metadata and the inner text. */
function stripGutenberg(text: string): { text: string; meta: BookMeta } {
  const meta: BookMeta = {}
  const start = text.match(/\*\*\*\s*START OF (THE|THIS) PROJECT GUTENBERG[^*]*\*\*\*/i)
  if (!start) return { text, meta }
  const header = text.slice(0, start.index)
  const t = header.match(/^Title:\s*(.+)$/m)
  const a = header.match(/^Author:\s*(.+)$/m)
  const l = header.match(/^Language:\s*(.+)$/m)
  if (t) meta.title = t[1].trim()
  if (a) meta.authors = a[1].split(/\s+and\s+|,\s*/).map(s => s.trim()).filter(Boolean)
  if (l) meta.language = /russian/i.test(l[1]) ? 'ru' : /english/i.test(l[1]) ? 'en' : /german/i.test(l[1]) ? 'de' : /french/i.test(l[1]) ? 'fr' : undefined
  let body = text.slice(start.index! + start[0].length)
  const end = body.match(/\*\*\*\s*END OF (THE|THIS) PROJECT GUTENBERG/i)
  if (end) body = body.slice(0, end.index)
  return { text: body, meta }
}

export function guessLanguage(text: string): string {
  const sample = text.slice(0, 20000)
  let cyr = 0, lat = 0
  for (const c of sample) {
    if (c >= 'Ѐ' && c <= 'ӿ') cyr++
    else if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')) lat++
  }
  if (cyr > lat) return /[іїєґ]/i.test(sample) ? 'uk' : 'ru'
  if (/\b(der|die|und|nicht)\b/i.test(sample) && /[äöüß]/i.test(sample)) return 'de'
  if (/\b(le|la|les|et|est|une)\b/.test(sample) && /[éèàç]/.test(sample)) return 'fr'
  if (/\b(el|los|las|que|una)\b/.test(sample) && /[ñáéíóú]/.test(sample)) return 'es'
  return 'en'
}

/**
 * Converts plain text to chapters.
 * Paragraph detection: blank-line separated blocks (hard-wrapped lines joined),
 * or one paragraph per line when the text uses indents / no blank lines.
 */
export function textToChapters(raw: string, fallbackTitle: string): { chapters: Chapter[]; meta: BookMeta } {
  const g = stripGutenberg(raw.replace(/\r\n?/g, '\n').replace(/\u0000/g, ''))
  const text = g.text.replace(/^\n+/, '')
  const lines = text.split('\n')
  const nonEmpty = lines.filter(l => l.trim()).length
  const blank = lines.length - nonEmpty
  const indented = lines.filter(l => /^(\s{2,}|\t)\S/.test(l)).length
  // hard-wrapped texts have many long lines of similar width and blank-line separated paragraphs
  const blockMode = blank > nonEmpty * 0.12 && indented < nonEmpty * 0.5

  type Block = { kind: 'p' | 'h' | 'scene' | 'poem'; text: string }
  const blocks: Block[] = []
  if (blockMode) {
    let buf: string[] = []
    const flush = () => {
      if (!buf.length) return
      const joined = buf.map(s => s.trim()).join(' ').replace(/\s+/g, ' ').trim()
      const shortLines = buf.length > 1 && buf.every(l => l.trim().length < 48)
      if (buf.length <= 3 && isHeadingLine(buf[0]) && buf.every(l => l.trim().length < 70))
        blocks.push({ kind: 'h', text: buf.map(s => s.trim()).join('\n') })
      else if (SCENE_RE.test(joined)) blocks.push({ kind: 'scene', text: '' })
      else if (shortLines && buf.length >= 3) blocks.push({ kind: 'poem', text: buf.map(s => s.trim()).join('\n') })
      else blocks.push({ kind: 'p', text: joined })
      buf = []
    }
    for (const l of lines) {
      if (!l.trim()) flush()
      else buf.push(l)
    }
    flush()
  } else {
    let prevBlank = true
    for (let i = 0; i < lines.length; i++) {
      const s = lines[i].trim()
      if (!s) { prevBlank = true; continue }
      const nextBlank = !lines[i + 1]?.trim()
      if (isHeadingLine(s) && (prevBlank || nextBlank)) blocks.push({ kind: 'h', text: s })
      else if (SCENE_RE.test(s)) blocks.push({ kind: 'scene', text: '' })
      else blocks.push({ kind: 'p', text: s.replace(/\s+/g, ' ') })
      prevBlank = false
    }
  }

  // merge consecutive heading blocks ("Глава I" + "Сержант гвардии") when the second is short
  const merged: Block[] = []
  for (const b of blocks) {
    const last = merged[merged.length - 1]
    if (b.kind === 'p' && last?.kind === 'h' && b.text.length < 60 && !/[.!?…]$/.test(b.text) && !last.text.includes('\n')
      && merged.length > 1 && /^[A-ZА-ЯЁ0-9IVX]/.test(b.text)) {
      last.text += '\n' + b.text
      continue
    }
    merged.push(b)
  }

  const headings = merged.filter(b => b.kind === 'h').length
  const toHtml = (b: Block) => {
    switch (b.kind) {
      case 'scene': return '<hr class="scene">'
      case 'poem': return `<p class="poem">${escapeHtml(b.text)}</p>`
      case 'h': {
        const [a, ...rest] = b.text.split('\n')
        return `<h2>${escapeHtml(a)}${rest.length ? `<br><small>${escapeHtml(rest.join(' '))}</small>` : ''}</h2>`
      }
      default: return `<p>${escapeHtml(b.text)}</p>`
    }
  }

  const chapters: Chapter[] = []
  if (headings >= 2) {
    let cur: Chapter | null = null
    let preface = ''
    for (const b of merged) {
      if (b.kind === 'h') {
        if (cur) chapters.push(cur)
        cur = { title: b.text.replace(/\n/g, '. '), html: toHtml(b) }
      } else if (cur) cur.html += toHtml(b)
      else preface += toHtml(b)
    }
    if (cur) chapters.push(cur)
    if (preface.trim()) chapters.unshift({ title: g.meta.title ?? fallbackTitle, html: preface })
  } else {
    // no structure: one flowing document (html-book splits it into sections by size)
    chapters.push({ title: g.meta.title ?? fallbackTitle, html: merged.map(toHtml).join('') })
  }
  const meta: BookMeta = { ...g.meta, language: g.meta.language ?? guessLanguage(text) }
  return { chapters, meta }
}
