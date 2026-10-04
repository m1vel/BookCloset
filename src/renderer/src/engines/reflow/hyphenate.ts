/**
 * Software hyphenation: Chromium in Electron ships no hyphenation dictionaries on Windows,
 * so justified text gets "rivers". We insert soft hyphens (U+00AD) into text nodes of the
 * rendered section. The patched epubcfi.js ignores U+00AD, so CFIs stay stable.
 *
 * The dictionary is loaded up-front (`loadHyphenator`) because sections must be processed
 * synchronously inside foliate's `load` event, before pagination.
 */
export type Hyphenator = (text: string, opts?: any) => string

const loaders: Record<string, () => Promise<{ hyphenateSync: Hyphenator }>> = {
  ru: () => import('hyphen/ru'),
  uk: () => import('hyphen/uk'),
  be: () => import('hyphen/be'),
  en: () => import('hyphen/en-us'),
  de: () => import('hyphen/de'),
  fr: () => import('hyphen/fr'),
  es: () => import('hyphen/es'),
  it: () => import('hyphen/it'),
  pl: () => import('hyphen/pl'),
  pt: () => import('hyphen/pt'),
  nl: () => import('hyphen/nl'),
  cs: () => import('hyphen/cs'),
  sv: () => import('hyphen/sv'),
  bg: () => import('hyphen/bg'),
  sr: () => import('hyphen/sr-cyrl'),
}

const cache = new Map<string, Hyphenator | null>()

export async function loadHyphenator(lang: string | undefined): Promise<Hyphenator | null> {
  const key = (lang || 'en').toLowerCase().slice(0, 2)
  if (cache.has(key)) return cache.get(key)!
  const load = loaders[key]
  if (!load) {
    cache.set(key, null)
    return null
  }
  try {
    const fn = (await load()).hyphenateSync
    cache.set(key, fn)
    return fn
  } catch {
    cache.set(key, null)
    return null
  }
}

const SKIP = new Set(['script', 'style', 'pre', 'code', 'kbd', 'samp', 'tt', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'title', 'svg', 'math'])
const WORD = /[\p{L}\p{M}]{6,}/gu

export function hyphenateDocument(doc: Document, hy: Hyphenator) {
  if (!doc.body) return
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
    acceptNode: node => {
      let el = node.parentElement
      while (el && el !== doc.body) {
        if (SKIP.has(el.localName.toLowerCase())) return NodeFilter.FILTER_REJECT
        el = el.parentElement
      }
      return node.nodeValue && node.nodeValue.length > 5 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    },
  })
  const nodes: Text[] = []
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text)
  for (const node of nodes) {
    const v = node.nodeValue!
    if (v.includes('\u00AD')) continue
    const out = v.replace(WORD, w => hy(w, { minWordLength: 6 }))
    if (out !== v) node.nodeValue = out
  }
}

/** Guesses the main language of a section by script when the book does not declare one. */
export function sniffLang(text: string): string {
  let cyr = 0, lat = 0
  for (const c of text.slice(0, 4000)) {
    if (c >= 'Ѐ' && c <= 'ӿ') cyr++
    else if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')) lat++
  }
  return cyr > lat ? 'ru' : 'en'
}
