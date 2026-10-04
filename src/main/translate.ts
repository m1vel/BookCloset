import Anthropic from '@anthropic-ai/sdk'
import type {
  TranslateErrorCode, TranslateMeaning, TranslateRequest, TranslateResponse, TranslateResult,
} from '../shared/types'
import { getKey } from './secrets'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'
const MAX_CHARS = 5000
const TIMEOUT = 30_000

class TranslateError extends Error {
  constructor(public code: TranslateErrorCode, message: string) { super(message) }
}

const LANG_EN: Record<string, string> = {
  ru: 'Russian', en: 'English', de: 'German', fr: 'French', es: 'Spanish', it: 'Italian', uk: 'Ukrainian',
  be: 'Belarusian', pl: 'Polish', cs: 'Czech', pt: 'Portuguese', nl: 'Dutch', sv: 'Swedish', fi: 'Finnish',
  tr: 'Turkish', zh: 'Chinese (Simplified)', ja: 'Japanese', ko: 'Korean', ar: 'Arabic', he: 'Hebrew',
  el: 'Greek', bg: 'Bulgarian', sr: 'Serbian', kk: 'Kazakh', la: 'Latin', hi: 'Hindi',
}
const langName = (code: string) => LANG_EN[code] ?? code

async function http(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT) })
  } catch (e: any) {
    throw new TranslateError('NETWORK', String(e?.cause?.code ?? e?.message ?? e))
  }
}

function statusError(status: number, body: string): TranslateError {
  if (status === 401 || status === 403) return new TranslateError('AUTH', body.slice(0, 300))
  if (status === 429) return new TranslateError(/quota|billing|insufficient/i.test(body) ? 'QUOTA' : 'RATE', body.slice(0, 300))
  if (status === 456 || status === 402) return new TranslateError('QUOTA', body.slice(0, 300))
  return new TranslateError('FAILED', `HTTP ${status}: ${body.slice(0, 300)}`)
}

// ---------------------------------------------------------------- free: Google (dictionary client) → MyMemory
const googleCode = (c: string) => (c === 'zh' ? 'zh-CN' : c === 'he' ? 'iw' : c)

async function google(req: TranslateRequest): Promise<TranslateResult> {
  const url = `https://clients5.google.com/translate_a/single?client=dict-chrome-ex&dt=t&dt=bd&dt=rm&dj=1`
    + `&sl=${googleCode(req.from || 'auto')}&tl=${googleCode(req.to)}`
  const res = await http(url, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: 'q=' + encodeURIComponent(req.text),
  })
  if (!res.ok) throw statusError(res.status, await res.text())
  const j: any = await res.json()
  const sentences: any[] = j.sentences ?? []
  const text = sentences.map(s => s.trans ?? '').join('').trim()
  if (!text) throw new TranslateError('FAILED', 'empty response')
  const translit = sentences.find(s => s.src_translit)?.src_translit as string | undefined
  const meanings: TranslateMeaning[] = (j.dict ?? []).map((d: any) => ({ pos: d.pos ?? '', terms: (d.terms ?? []).slice(0, 7) }))
  return {
    text, provider: 'free', detected: j.src,
    meanings: meanings.length ? meanings : undefined,
    pronunciation: translit && translit.length < 60 && req.text.length < 60 ? translit : undefined,
  }
}

async function myMemory(req: TranslateRequest): Promise<TranslateResult> {
  const from = req.from !== 'auto' ? req.from : req.fromHint || 'en'
  const q = req.text.slice(0, 480)
  const res = await http(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(q)}&langpair=${from}|${req.to}`, {})
  if (!res.ok) throw statusError(res.status, await res.text())
  const j: any = await res.json()
  const text = String(j?.responseData?.translatedText ?? '').trim()
  if (!text || j?.quotaFinished) throw new TranslateError(j?.quotaFinished ? 'QUOTA' : 'FAILED', j?.responseDetails ?? 'empty')
  return { text, provider: 'free', detected: from, fallback: true }
}

async function free(req: TranslateRequest) {
  try {
    return await google(req)
  } catch (e) {
    try {
      return await myMemory(req)
    } catch {
      throw e
    }
  }
}

// ---------------------------------------------------------------- DeepL
const deeplTarget = (c: string) => ({ en: 'EN-US', pt: 'PT-PT', zh: 'ZH-HANS' } as Record<string, string>)[c] ?? c.toUpperCase()

async function deepl(req: TranslateRequest, key: string): Promise<TranslateResult> {
  const base = key.trim().endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com'
  const body: Record<string, unknown> = { text: [req.text], target_lang: deeplTarget(req.to) }
  if (req.from && req.from !== 'auto') body.source_lang = req.from.toUpperCase()
  if (req.context) body.context = req.context
  const res = await http(`${base}/v2/translate`, {
    method: 'POST',
    headers: { Authorization: `DeepL-Auth-Key ${key}`, 'Content-Type': 'application/json', 'User-Agent': 'BookCloset/1.0' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw statusError(res.status, await res.text())
  const j: any = await res.json()
  const t = j.translations?.[0]
  if (!t?.text) throw new TranslateError('FAILED', 'empty response')
  return { text: t.text, detected: String(t.detected_source_language ?? '').toLowerCase() || undefined, provider: 'deepl' }
}

// ---------------------------------------------------------------- Yandex Cloud Translate
async function yandex(req: TranslateRequest, key: string): Promise<TranslateResult> {
  const auth = key.startsWith('t1.') ? `Bearer ${key}` : `Api-Key ${key}`
  const body: Record<string, unknown> = { targetLanguageCode: req.to, texts: [req.text], format: 'PLAIN_TEXT' }
  if (req.folderId) body.folderId = req.folderId
  if (req.from && req.from !== 'auto') body.sourceLanguageCode = req.from
  const res = await http('https://translate.api.cloud.yandex.net/translate/v2/translate', {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw statusError(res.status, await res.text())
  const j: any = await res.json()
  const t = j.translations?.[0]
  if (!t?.text) throw new TranslateError('FAILED', 'empty response')
  return { text: t.text, detected: t.detectedLanguageCode, provider: 'yandex' }
}

// ---------------------------------------------------------------- AI translators (Claude, OpenAI)
const SYSTEM_PROMPT = `You are the literary translator built into an e-book reader. The reader selected a passage in a book and wants it in their language.

Translate the selected text into the requested target language. Preserve the meaning, tone, register and style of the original, and write natural, idiomatic prose the way a published translation would read. Keep proper names consistent with established translations when they exist.

The surrounding context, when given, is there only to resolve ambiguity (who is speaking, which sense of a word is meant). Never translate or summarise the context itself.

If the selection is a single word or a short set phrase, also fill "meanings" with its main senses grouped by part of speech, written in the target language, and choose the sense that fits the context for "translation". For longer selections leave "meanings" empty.

Use "note" only for something the reader genuinely needs to understand the passage — an idiom, pun, archaism, or cultural reference — written briefly in the target language. Otherwise "note" is an empty string.`

const AI_SCHEMA = {
  type: 'object',
  properties: {
    source_language: { type: 'string', description: 'ISO 639-1 code of the language of the selected text' },
    translation: { type: 'string' },
    note: { type: 'string' },
    meanings: {
      type: 'array',
      items: {
        type: 'object',
        properties: { pos: { type: 'string' }, terms: { type: 'array', items: { type: 'string' } } },
        required: ['pos', 'terms'],
        additionalProperties: false,
      },
    },
  },
  required: ['source_language', 'translation', 'note', 'meanings'],
  additionalProperties: false,
} as const

function aiUserPrompt(req: TranslateRequest) {
  const parts = [`Target language: ${langName(req.to)} (${req.to})`]
  if (req.title) parts.push(`Book: ${req.title}`)
  if (req.context && req.context.trim() !== req.text.trim()) parts.push(`Context (do not translate):\n<context>\n${req.context}\n</context>`)
  parts.push(`Selected text to translate:\n<selection>\n${req.text}\n</selection>`)
  return parts.join('\n\n')
}

function fromAiJson(raw: string, provider: 'claude' | 'openai'): TranslateResult {
  let j: any
  try {
    j = JSON.parse(raw)
  } catch {
    throw new TranslateError('FAILED', 'model returned invalid JSON')
  }
  if (!j?.translation) throw new TranslateError('FAILED', 'empty translation')
  const meanings = Array.isArray(j.meanings) ? j.meanings.filter((m: any) => m?.terms?.length) : []
  return {
    text: String(j.translation).trim(),
    detected: j.source_language || undefined,
    note: j.note?.trim() || undefined,
    meanings: meanings.length ? meanings : undefined,
    provider,
  }
}

async function claude(req: TranslateRequest, key: string): Promise<TranslateResult> {
  const model = req.model || 'claude-opus-5-5'
  const client = new Anthropic({ apiKey: key, timeout: 60_000, maxRetries: 1 })
  // effort is not available on Haiku 4.5; server-side refusal fallbacks exist for the 5.x generation
  const supportsEffort = !/haiku/.test(model)
  const supportsFallback = /opus-5|sonnet-5-5|fable/.test(model)
  try {
    const response = await client.beta.messages.create({
      model,
      max_tokens: 8000,
      ...(supportsFallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: aiUserPrompt(req) }],
      output_config: {
        ...(supportsEffort ? { effort: 'low' as const } : {}),
        format: { type: 'json_schema', schema: AI_SCHEMA as unknown as Record<string, unknown> },
      },
    })
    if (response.stop_reason === 'refusal') throw new TranslateError('REFUSED', response.stop_details?.explanation ?? 'refusal')
    if (response.stop_reason === 'max_tokens') throw new TranslateError('TOO_LONG', 'max_tokens')
    const text = response.content.map(b => (b.type === 'text' ? b.text : '')).join('')
    return fromAiJson(text, 'claude')
  } catch (e) {
    if (e instanceof TranslateError) throw e
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw new TranslateError('AUTH', e.message)
    if (e instanceof Anthropic.RateLimitError) throw new TranslateError('RATE', e.message)
    if (e instanceof Anthropic.NotFoundError) throw new TranslateError('FAILED', `model "${model}" not found`)
    if (e instanceof Anthropic.APIConnectionError) throw new TranslateError('NETWORK', e.message)
    if (e instanceof Anthropic.APIError) {
      throw new TranslateError(/credit|billing/i.test(e.message) ? 'QUOTA' : 'FAILED', `${e.status ?? ''} ${e.message}`.trim())
    }
    throw e
  }
}

async function openai(req: TranslateRequest, key: string): Promise<TranslateResult> {
  const model = req.model || 'gpt-5-mini'
  const res = await http('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT + '\n\nRespond with a JSON object with the keys "source_language", "translation", "note" and "meanings" (an array of {"pos", "terms"}).' },
        { role: 'user', content: aiUserPrompt(req) },
      ],
    }),
  })
  if (!res.ok) throw statusError(res.status, await res.text())
  const j: any = await res.json()
  return fromAiJson(j.choices?.[0]?.message?.content ?? '', 'openai')
}

// ---------------------------------------------------------------- entry point with a small cache
const cache = new Map<string, TranslateResult>()

export async function translate(req: TranslateRequest): Promise<TranslateResponse> {
  try {
    const text = req.text.replace(/\u00AD/g, '').trim()
    if (!text) throw new TranslateError('FAILED', 'empty text')
    if (text.length > MAX_CHARS) throw new TranslateError('TOO_LONG', `${text.length} > ${MAX_CHARS}`)
    const r: TranslateRequest = { ...req, text }
    const cacheKey = JSON.stringify([r.provider, r.model ?? '', r.from, r.to, text, r.provider === 'free' || r.provider === 'yandex' ? '' : r.context ?? ''])
    const hit = cache.get(cacheKey)
    if (hit) return { ok: true, result: hit }
    let result: TranslateResult
    if (r.provider === 'free') result = await free(r)
    else {
      const key = getKey(r.provider)
      if (!key) throw new TranslateError('NO_KEY', r.provider)
      switch (r.provider) {
        case 'deepl': result = await deepl(r, key); break
        case 'yandex': result = await yandex(r, key); break
        case 'claude': result = await claude(r, key); break
        case 'openai': result = await openai(r, key); break
        default: throw new TranslateError('FAILED', 'unknown provider')
      }
    }
    cache.set(cacheKey, result)
    if (cache.size > 400) cache.delete(cache.keys().next().value!)
    return { ok: true, result }
  } catch (e: any) {
    if (e instanceof TranslateError) return { ok: false, code: e.code, message: e.message }
    return { ok: false, code: 'FAILED', message: String(e?.message ?? e) }
  }
}
