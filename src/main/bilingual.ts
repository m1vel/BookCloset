import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { BatchTranslateRequest, BatchTranslateResponse } from '../shared/types'
import { translate } from './translate'
import { JsonStore } from './json-store'
import { cacheDir } from './paths'

/** Chunk size for one request: paragraphs are joined with blank lines and split back. */
const CHUNK_CHARS = 3800
const CHUNK_ITEMS = 40
const MAX_CACHE = 15_000

interface CacheData { version: 1; items: Record<string, string> }
let store: JsonStore<CacheData> | null = null
const cache = () => (store ??= new JsonStore<CacheData>(join(cacheDir(), 'bilingual-cache.json'), () => ({ version: 1, items: {} })))

const keyOf = (r: BatchTranslateRequest, text: string) =>
  createHash('sha1').update(`${r.provider}|${r.model ?? ''}|${r.to}|${text}`).digest('base64url')

const clean = (s: string) => s.replace(/\u00AD/g, '').replace(/\s+/g, ' ').trim()

export function flushBilingualCache() {
  store?.flush()
}

/**
 * Translates many paragraphs with few requests: cached ones are answered locally, the rest are
 * sent in chunks joined by blank lines. If a provider merges or splits paragraphs, that chunk
 * falls back to one request per paragraph. Stops at the first provider error (quota, network…).
 */
export async function translateBatch(r: BatchTranslateRequest): Promise<BatchTranslateResponse> {
  const items = cache().get().items
  const texts = r.texts.map(clean)
  const results: (string | null)[] = texts.map(t => (t ? items[keyOf(r, t)] ?? null : null))
  const todo = texts.map((t, i) => i).filter(i => texts[i] && results[i] == null)

  const chunks: number[][] = []
  let cur: number[] = [], size = 0
  for (const i of todo) {
    const len = texts[i].length + 2
    if (cur.length && (size + len > CHUNK_CHARS || cur.length >= CHUNK_ITEMS)) { chunks.push(cur); cur = []; size = 0 }
    cur.push(i)
    size += len
  }
  if (cur.length) chunks.push(cur)

  const save = (i: number, tr: string) => {
    results[i] = tr
    const store = cache()
    store.update(v => {
      v.items[keyOf(r, texts[i])] = tr
      const keys = Object.keys(v.items)
      for (let k = 0; k < keys.length - MAX_CACHE; k++) delete v.items[keys[k]]
    })
  }

  for (const chunk of chunks) {
    const res = await translate({
      text: chunk.map(i => texts[i]).join('\n\n'), to: r.to, from: 'auto', provider: r.provider, model: r.model, folderId: r.folderId,
    })
    if (!res.ok) return { results, error: { code: res.code, message: res.message } }
    const parts = res.result.text.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean)
    if (parts.length === chunk.length) {
      chunk.forEach((i, k) => save(i, parts[k]))
      continue
    }
    for (const i of chunk) {
      const one = await translate({ text: texts[i], to: r.to, from: 'auto', provider: r.provider, model: r.model, folderId: r.folderId })
      if (!one.ok) return { results, error: { code: one.code, message: one.message } }
      save(i, one.result.text)
    }
  }
  return { results }
}
