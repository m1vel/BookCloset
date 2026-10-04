import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { cacheDir } from './paths'
import { mkdirSync } from 'node:fs'

// ---------- Word 97-2003 (.doc): text extraction ----------
// eslint-disable-next-line @typescript-eslint/no-var-requires
const WordExtractor = require('word-extractor')

export async function extractDocText(path: string): Promise<{ body: string; footnotes: string; headers: string }> {
  const extractor = new WordExtractor()
  const doc = await extractor.extract(path)
  return {
    body: doc.getBody() ?? '',
    footnotes: doc.getFootnotes?.() ?? '',
    headers: doc.getHeaders?.({ includeFooters: false }) ?? '',
  }
}

// ---------- Calibre bridge: converts exotic formats (LIT, LRF, SNB, …) to EPUB ----------
export function findCalibre(custom?: string): string | null {
  const candidates = [
    custom,
    join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'Calibre2', 'ebook-convert.exe'),
    join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Calibre2', 'ebook-convert.exe'),
    join(process.env['LOCALAPPDATA'] ?? '', 'Programs', 'Calibre2', 'ebook-convert.exe'),
    'C:\\Program Files\\Calibre Portable\\Calibre\\ebook-convert.exe',
  ]
  for (const c of candidates) if (c && existsSync(c)) return c
  return null
}

export function convertWithCalibre(exe: string, input: string, bookId: string): Promise<string> {
  const dir = join(cacheDir(), bookId)
  mkdirSync(dir, { recursive: true })
  const out = join(dir, 'converted.epub')
  if (existsSync(out)) return Promise.resolve(out)
  return new Promise((resolve, reject) => {
    execFile(exe, [input, out], { timeout: 5 * 60_000, windowsHide: true }, (err, _stdout, stderr) => {
      if (err || !existsSync(out)) reject(new Error(String(stderr || err?.message || 'conversion failed').slice(-400)))
      else resolve(out)
    })
  })
}
