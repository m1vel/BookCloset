import type { MetaCandidate, MetaQuery } from '../shared/types'

const UA = 'BookCloset/1.1 (e-book reader; metadata lookup)'
const TIMEOUT = 20_000

async function getJson(url: string): Promise<any | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT) })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

async function openLibrary(q: MetaQuery): Promise<MetaCandidate[]> {
  const params = new URLSearchParams({
    limit: '10',
    fields: 'key,title,author_name,first_publish_year,cover_i,publisher,number_of_pages_median,'
      + 'editions,editions.cover_i,editions.publisher,editions.language',
  })
  // biases the matched edition (and its cover) towards the book's language
  if (q.lang) params.set('lang', q.lang)
  if (q.isbn) params.set('isbn', q.isbn)
  else {
    params.set('title', q.title)
    if (q.author) params.set('author', q.author)
  }
  let j = await getJson(`https://openlibrary.org/search.json?${params}`)
  // retry without the author when the spelling differs (e.g. transliteration)
  if (j && !j.docs?.length && q.author && !q.isbn) {
    params.delete('author')
    j = await getJson(`https://openlibrary.org/search.json?${params}`)
  }
  return (j?.docs ?? []).map((d: any): MetaCandidate => {
    const ed = d.editions?.docs?.[0]
    const cover = ed?.cover_i ?? d.cover_i
    return {
      id: `ol:${d.key}`,
      source: 'Open Library',
      title: d.title,
      authors: d.author_name ?? [],
      year: d.first_publish_year ? String(d.first_publish_year) : undefined,
      publisher: ed?.publisher?.[0] ?? d.publisher?.[0],
      pages: d.number_of_pages_median,
      language: ed?.language?.[0],
      coverUrl: cover ? `https://covers.openlibrary.org/b/id/${cover}-L.jpg` : undefined,
      thumbUrl: cover ? `https://covers.openlibrary.org/b/id/${cover}-M.jpg` : undefined,
      detailsKey: d.key,
    }
  })
}

async function googleBooks(q: MetaQuery): Promise<MetaCandidate[]> {
  const terms = q.isbn ? `isbn:${q.isbn}` : `intitle:${q.title}${q.author ? ` inauthor:${q.author}` : ''}`
  const lr = q.lang ? `&langRestrict=${encodeURIComponent(q.lang)}` : ''
  let j = await getJson(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(terms)}&maxResults=8&printType=books${lr}`)
  if (lr && j && !j.items?.length) j = await getJson(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(terms)}&maxResults=8&printType=books`)
  return (j?.items ?? []).map((it: any): MetaCandidate => {
    const v = it.volumeInfo ?? {}
    const img: string | undefined = (v.imageLinks?.thumbnail ?? v.imageLinks?.smallThumbnail)?.replace(/^http:/, 'https:')
    return {
      id: `gb:${it.id}`,
      source: 'Google Books',
      title: v.subtitle ? `${v.title}. ${v.subtitle}` : v.title,
      authors: v.authors ?? [],
      year: v.publishedDate?.slice(0, 4),
      publisher: v.publisher,
      pages: v.pageCount,
      description: v.description,
      language: v.language,
      coverUrl: img ? img.replace(/&edge=curl/, '') + '&fife=w800' : undefined,
      thumbUrl: img,
    }
  })
}

export async function searchMetadata(q: MetaQuery): Promise<MetaCandidate[]> {
  const [ol, gb] = await Promise.all([openLibrary(q), googleBooks(q)])
  // interleave so both sources are visible at the top
  const out: MetaCandidate[] = []
  for (let i = 0; i < Math.max(ol.length, gb.length); i++) {
    if (ol[i]) out.push(ol[i])
    if (gb[i]) out.push(gb[i])
  }
  return out
}

/** Work description from Open Library (search results do not include it). */
export async function metadataDetails(key: string): Promise<{ description?: string; subjects?: string[] }> {
  if (!/^\/works\/OL\w+$/.test(key)) return {}
  const j = await getJson(`https://openlibrary.org${key}.json`)
  const d = j?.description
  return {
    description: typeof d === 'string' ? d : d?.value,
    subjects: Array.isArray(j?.subjects) ? j.subjects.slice(0, 10) : undefined,
  }
}

const IMAGE_HOSTS = /^(covers\.openlibrary\.org|books\.google\.com|books\.googleusercontent\.com|[\w-]+\.googleusercontent\.com)$/i

/**
 * Downloads a cover image from the catalogs above. Goes through main so the renderer CSP
 * (which also applies to book content) never has to allow remote images.
 */
export async function fetchImage(url: string): Promise<Uint8Array | null> {
  let u: URL
  try { u = new URL(url) } catch { return null }
  if (u.protocol !== 'https:' || !IMAGE_HOSTS.test(u.hostname)) return null
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(TIMEOUT) })
    if (!res.ok || !/^image\//.test(res.headers.get('content-type') ?? '')) return null
    const buf = new Uint8Array(await res.arrayBuffer())
    // Open Library serves a 1×1 placeholder when a cover is missing
    return buf.byteLength > 2000 && buf.byteLength < 15 * 1024 * 1024 ? buf : null
  } catch {
    return null
  }
}
