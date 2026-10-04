import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import type { ArchiveListing } from '../shared/types'
import { cacheDir } from './paths'

// 7-Zip compiled to WebAssembly: zip, rar (incl. RAR5), 7z, tar, chm, …
// eslint-disable-next-line @typescript-eslint/no-var-requires
const SevenZip = require('7z-wasm') as (opts?: any) => Promise<any>

let queue: Promise<unknown> = Promise.resolve()

/** Serialises extractions: every call gets a fresh wasm instance (callMain is one-shot). */
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn)
  queue = next.catch(() => {})
  return next
}

function walk(dir: string, root = dir, out: { path: string; size: number }[] = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, root, out)
    else out.push({ path: relative(root, p).split('\\').join('/'), size: st.size })
  }
  return out
}

/**
 * Extracts `archive` into the cache directory of the book (once) and returns the listing.
 * Extraction is cached; a `.done` marker tells that the folder is complete.
 */
export function extractArchive(bookId: string, archive: string): Promise<ArchiveListing> {
  const outDir = join(cacheDir(), bookId, 'x')
  const marker = join(cacheDir(), bookId, '.done')
  const baseUrl = `bc://cache/${bookId}/x/`
  if (existsSync(marker)) return Promise.resolve({ baseUrl, files: walk(outDir) })

  return serial(async () => {
    rmSync(outDir, { recursive: true, force: true })
    mkdirSync(outDir, { recursive: true })
    const log: string[] = []
    const sz = await SevenZip({ print: (s: string) => log.push(s), printErr: (s: string) => log.push(s) })
    sz.FS.mkdir('/in')
    sz.FS.mount(sz.NODEFS, { root: dirname(archive) }, '/in')
    sz.FS.mkdir('/out')
    sz.FS.mount(sz.NODEFS, { root: outDir }, '/out')
    try {
      sz.callMain(['x', `/in/${basename(archive)}`, '-o/out', '-y', '-bso0', '-bsp0', '-sccUTF-8'])
    } catch (e: any) {
      // emscripten throws ExitStatus on exit(); a non-zero status is a real failure
      if (e?.status) throw new Error('7z: ' + log.slice(-5).join(' '))
    }
    const files = walk(outDir)
    if (!files.length) throw new Error('Archive is empty or could not be extracted: ' + log.slice(-3).join(' '))
    writeFileSync(marker, String(Date.now()))
    return { baseUrl, files }
  })
}

/** Stores an arbitrary derived file (converted book, extracted text…) in the book cache. */
export function cacheFile(bookId: string, name: string, data: Buffer | string) {
  const dir = join(cacheDir(), bookId)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, name), data)
  return join(dir, name)
}

export function readCached(bookId: string, name: string): Buffer | null {
  const p = join(cacheDir(), bookId, name)
  return existsSync(p) ? readFileSync(p) : null
}
