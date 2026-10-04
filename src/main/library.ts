import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, open, readFile, rm, stat, writeFile, unlink, readdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type {
  Annotation, BookRecord, Collection, ImportResult, LibraryData, ReadingSession, StatsData, VocabData, VocabEntry,
} from '../shared/types'
import { detectFormat, extOf, SUPPORTED_EXTENSIONS } from '../shared/formats'
import { JsonStore } from './json-store'
import { annotationsDir, booksDir, cacheDir, coversDir, dataDir } from './paths'

let library: JsonStore<LibraryData>
let stats: JsonStore<StatsData>
let vocab: JsonStore<VocabData>

export function initLibrary() {
  library = new JsonStore<LibraryData>(join(dataDir(), 'library.json'),
    () => ({ version: 1, books: [], collections: [] }))
  stats = new JsonStore<StatsData>(join(dataDir(), 'stats.json'),
    () => ({ version: 1, sessions: [] }))
  vocab = new JsonStore<VocabData>(join(dataDir(), 'vocab.json'),
    () => ({ version: 1, entries: [] }))
}

export const getVocab = () => vocab.get().entries
export const setVocab = (entries: VocabEntry[]) => vocab.set({ version: 1, entries })

export function flushAll() {
  library?.flush()
  stats?.flush()
  vocab?.flush()
}

export const getLibrary = () => library.get()
export const getBook = (id: string) => library.get().books.find(b => b.id === id)
export const bookFilePath = (b: BookRecord) => join(booksDir(), `${b.id}.${b.ext}`)
export const coverPath = (id: string) => join(coversDir(), `${id}.jpg`)

async function hashFile(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha1')
    createReadStream(path)
      .on('data', d => h.update(d))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject)
  })
}

async function readHead(path: string, n = 4096): Promise<Uint8Array> {
  const fh = await open(path, 'r')
  try {
    const buf = Buffer.alloc(n)
    const { bytesRead } = await fh.read(buf, 0, n, 0)
    return new Uint8Array(buf.subarray(0, bytesRead))
  } finally {
    await fh.close()
  }
}

/** Splits "Author - Title" / "Author_Title" style file names into a guess. */
function guessFromFileName(fileName: string): { title: string; authors: string[] } {
  let name = fileName.replace(/\.fb2\.zip$/i, '').replace(/\.[^.]+$/, '')
  name = name.replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
  const m = name.match(/^(.{2,60}?)\s+[-–—]\s+(.{2,})$/)
  if (m) return { authors: [m[1].trim()], title: m[2].trim() }
  return { title: name, authors: [] }
}

export async function importFiles(paths: string[]): Promise<ImportResult> {
  const result: ImportResult = { added: [], duplicates: [], failed: [] }
  const data = library.get()
  for (const path of paths) {
    try {
      const st = await stat(path)
      if (st.isDirectory()) {
        const nested = await collectBooks(path)
        const r = await importFiles(nested)
        result.added.push(...r.added)
        result.duplicates.push(...r.duplicates)
        result.failed.push(...r.failed)
        continue
      }
      const fileName = basename(path)
      const head = await readHead(path)
      const format = detectFormat(fileName, head)
      if (format === 'unknown') throw new Error('unsupported')
      const hash = await hashFile(path)
      const existing = data.books.find(b => b.hash === hash)
      if (existing) {
        result.duplicates.push(existing)
        continue
      }
      const id = randomUUID()
      let ext = extOf(fileName) || format
      if (ext.length > 8) ext = format
      const guess = guessFromFileName(fileName)
      const record: BookRecord = {
        id, hash, fileName, ext, format, size: st.size,
        title: guess.title, authors: guess.authors,
        hasCover: false, addedAt: Date.now(), progress: 0, status: 'new',
        collections: [], readingSeconds: 0, indexed: false, sourcePath: path,
      }
      await copyFile(path, join(booksDir(), `${id}.${ext}`))
      data.books.push(record)
      result.added.push(record)
    } catch (e: any) {
      result.failed.push({ path, error: String(e?.message ?? e) })
    }
  }
  library.set(data)
  return result
}

async function collectBooks(dir: string, depth = 0): Promise<string[]> {
  if (depth > 6) return []
  const out: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...await collectBooks(p, depth + 1))
    else if (SUPPORTED_EXTENSIONS.includes(extOf(entry.name))) out.push(p)
  }
  return out
}

export function updateBook(id: string, patch: Partial<BookRecord>): BookRecord | undefined {
  let updated: BookRecord | undefined
  library.update(d => {
    const b = d.books.find(b => b.id === id)
    if (b) {
      Object.assign(b, patch, { id: b.id, hash: b.hash })
      updated = b
    }
  })
  return updated
}

export async function removeBooks(ids: string[]) {
  const data = library.get()
  for (const id of ids) {
    const b = data.books.find(b => b.id === id)
    if (!b) continue
    await rm(bookFilePath(b), { force: true })
    await rm(coverPath(id), { force: true })
    await rm(join(annotationsDir(), `${id}.json`), { force: true })
    await rm(join(cacheDir(), id), { recursive: true, force: true })
  }
  data.books = data.books.filter(b => !ids.includes(b.id))
  library.set(data)
}

export function setCollections(collections: Collection[]) {
  library.update(d => {
    d.collections = collections
    const ids = new Set(collections.map(c => c.id))
    for (const b of d.books) b.collections = b.collections.filter(c => ids.has(c))
  })
}

export async function saveCover(id: string, bytes: Uint8Array, color?: string) {
  await writeFile(coverPath(id), bytes)
  updateBook(id, { hasCover: true, ...(color ? { coverColor: color } : {}) })
}

export async function readBook(id: string): Promise<Buffer> {
  const b = getBook(id)
  if (!b) throw new Error('Book not found')
  return readFile(bookFilePath(b))
}

// ---- annotations ----
export async function getAnnotations(id: string): Promise<Annotation[]> {
  try {
    return JSON.parse(await readFile(join(annotationsDir(), `${id}.json`), 'utf8'))
  } catch {
    return []
  }
}

export async function setAnnotations(id: string, list: Annotation[]) {
  const file = join(annotationsDir(), `${id}.json`)
  if (!list.length) {
    await unlink(file).catch(() => {})
    return
  }
  await writeFile(file + '.tmp', JSON.stringify(list), 'utf8')
  const { rename } = await import('node:fs/promises')
  await rename(file + '.tmp', file)
}

export async function allAnnotationCounts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  for (const f of await readdir(annotationsDir())) {
    if (!f.endsWith('.json')) continue
    try {
      const list = JSON.parse(await readFile(join(annotationsDir(), f), 'utf8'))
      out[f.replace(/\.json$/, '')] = list.filter((a: Annotation) => a.kind !== 'bookmark').length
    } catch { /* ignore */ }
  }
  return out
}

// ---- stats ----
export const getStats = () => stats.get()

export function addSession(s: ReadingSession) {
  if (s.seconds < 5) return
  stats.update(d => {
    // merge with the previous session of the same book if it is contiguous
    const last = d.sessions[d.sessions.length - 1]
    if (last && last.bookId === s.bookId && s.start - last.end < 120_000) {
      last.end = s.end
      last.seconds += s.seconds
      last.progressTo = s.progressTo
      last.pages += s.pages
    } else d.sessions.push(s)
  })
  library.update(d => {
    const b = d.books.find(b => b.id === s.bookId)
    if (b) b.readingSeconds = (b.readingSeconds ?? 0) + s.seconds
  })
}
