import jschardet from 'jschardet'

/** Frequent lower-case Cyrillic letters (о е а и н т с р в л к) — a correct decode is dominated by these. */
const RU_FREQUENT = new Set('оеаинтсрвлкмдпуяыьгзбчйхжшюцщэфъё')
const RU_UPPER = /[А-ЯЁ]/

function cyrillicScore(text: string) {
  let good = 0, upper = 0, total = 0
  const n = Math.min(text.length, 60000)
  for (let i = 0; i < n; i++) {
    const c = text[i]
    if (c >= 'Ѐ' && c <= 'ӿ') {
      total++
      if (RU_FREQUENT.has(c)) good++
      else if (RU_UPPER.test(c)) upper++
    }
  }
  return { good, upper, total }
}

const LABELS: Record<string, string> = {
  'windows-1251': 'windows-1251', 'koi8-r': 'koi8-r', 'ibm866': 'ibm866', 'maccyrillic': 'x-mac-cyrillic',
  'iso-8859-5': 'iso-8859-5', 'utf-8': 'utf-8', 'ascii': 'utf-8', 'windows-1252': 'windows-1252',
  'iso-8859-1': 'windows-1252', 'shift_jis': 'shift_jis', 'euc-jp': 'euc-jp', 'gb2312': 'gbk', 'gb18030': 'gb18030',
  'big5': 'big5', 'euc-kr': 'euc-kr', 'iso-8859-2': 'iso-8859-2', 'windows-1250': 'windows-1250',
  'iso-8859-7': 'iso-8859-7', 'windows-1253': 'windows-1253', 'iso-8859-8': 'iso-8859-8', 'windows-1255': 'windows-1255',
  'utf-16le': 'utf-16le', 'utf-16be': 'utf-16be', 'tis-620': 'windows-874', 'x-mac-cyrillic': 'x-mac-cyrillic',
}

export function normalizeLabel(label: string | null | undefined): string | null {
  if (!label) return null
  const l = label.trim().toLowerCase().replace(/^["']|["']$/g, '')
  if (LABELS[l]) return LABELS[l]
  if (l === 'cp1251' || l === 'win-1251') return 'windows-1251'
  if (l === 'cp866' || l === 'dos-866') return 'ibm866'
  try {
    new TextDecoder(l)
    return l
  } catch {
    return null
  }
}

/**
 * Decodes bytes of a text-like document, detecting the encoding:
 * BOMs → strict UTF-8 → Cyrillic single-byte family (scored) → jschardet → windows-1252.
 */
export function decodeText(bytes: Uint8Array, declared?: string | null): { text: string; encoding: string } {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf-8' }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf-16le' }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'utf-16be' }

  // UTF-16 without BOM: lots of zero bytes at odd or even positions
  const probe = Math.min(bytes.length, 4000)
  let zeroEven = 0, zeroOdd = 0
  for (let i = 0; i < probe; i++) if (bytes[i] === 0) (i % 2 ? zeroOdd++ : zeroEven++)
  if (zeroOdd > probe * 0.3 && zeroEven < probe * 0.05) return { text: new TextDecoder('utf-16le').decode(bytes), encoding: 'utf-16le' }
  if (zeroEven > probe * 0.3 && zeroOdd < probe * 0.05) return { text: new TextDecoder('utf-16be').decode(bytes), encoding: 'utf-16be' }

  const decl = normalizeLabel(declared)
  if (decl && decl !== 'utf-8') {
    try { return { text: new TextDecoder(decl).decode(bytes), encoding: decl } } catch { /* fall through */ }
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' }
  } catch { /* not utf-8 */ }

  // count high bytes: is it likely Cyrillic?
  let high = 0
  for (let i = 0; i < probe; i++) if (bytes[i] >= 0x80) high++
  const sample = bytes.subarray(0, Math.min(bytes.length, 200_000))
  if (high > 0) {
    let best: { enc: string; score: number } | null = null
    for (const enc of ['windows-1251', 'koi8-r', 'ibm866', 'x-mac-cyrillic', 'iso-8859-5']) {
      const s = cyrillicScore(new TextDecoder(enc).decode(sample))
      const score = s.good - s.upper * 0.5
      if (s.total > high * 0.4 && (!best || score > best.score)) best = { enc, score }
    }
    if (best && best.score > high * 0.3) return { text: new TextDecoder(best.enc).decode(bytes), encoding: best.enc }
  }
  try {
    let bin = ''
    for (let i = 0; i < Math.min(sample.length, 64000); i++) bin += String.fromCharCode(sample[i])
    const det = jschardet.detect(bin)
    const enc = normalizeLabel(det?.encoding)
    if (enc && det.confidence > 0.4) return { text: new TextDecoder(enc).decode(bytes), encoding: enc }
  } catch { /* ignore */ }
  return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'windows-1252' }
}

/** Reads `<meta charset>` / `http-equiv` / XML declaration from the first bytes of a markup file. */
export function sniffMarkupCharset(bytes: Uint8Array): string | null {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 4096))
  const m = head.match(/<meta[^>]+charset\s*=\s*["']?\s*([\w-]+)/i)
    ?? head.match(/<\?xml[^>]+encoding\s*=\s*["']([\w-]+)["']/i)
  return m ? m[1] : null
}

export const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
