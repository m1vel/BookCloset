import Anthropic from '@anthropic-ai/sdk'
import type { WebContents } from 'electron'
import type { AssistantRequest, AssistantResponse, TranslateErrorCode } from '../shared/types'
import { getKey } from './secrets'

const jobs = new Map<string, AbortController>()

class AssistantError extends Error {
  constructor(public code: TranslateErrorCode, message: string) { super(message) }
}

const langName = (code: string) => {
  try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code } catch { return code }
}

function systemPrompt(lang: string) {
  return `You are a reading companion built into the e-book reader BookCloset. The reader is partway through a book and asks you about it.

You are given the book text exactly up to the reader's current position (the end of the page they are looking at). That position is a hard boundary:
- Use only that text.
- Do not reveal, hint at or speculate about anything that happens after it, even if you know this book well: no later events, deaths, twists, identities, relationships or the ending.
- If an answer depends on later parts of the book, say that the book has not revealed it yet.

Answer in ${langName(lang)}. Be concise and concrete, and quote short phrases from the text when they help. Format with Markdown: short paragraphs, **bold** for names and key terms, "-" for lists, "###" for small section headings. Do not use tables.`
}

function bookBlock(r: AssistantRequest) {
  const esc = (s: string) => s.replace(/"/g, "'")
  return `<book title="${esc(r.book.title)}" authors="${esc(r.book.authors.join(', '))}">
<read_so_far${r.trimmed ? ' note="the beginning is omitted; this is the most recent part"' : ''}>
${r.readSoFar}
</read_so_far>
</book>`
}

function taskPrompt(r: AssistantRequest) {
  switch (r.task) {
    case 'explain':
      return `Explain this passage the reader selected: what it means at this point in the story, unusual or archaic words, allusions, irony and cultural references. Two to four short paragraphs.\n\n<passage>\n${r.selection}\n</passage>`
    case 'recap':
      return 'Give a spoiler-free recap of the story so far, up to the reader\'s current position: the main events in order, the key characters, and where things stand now. A few short sections or lists, about 250 words at most.'
    case 'who':
      return `Who is "${r.selection}"? Using only the text so far: who they are, their relationships, what they have done, and when they first appear. If the name does not occur in the text so far, say so.`
    default:
      return `${r.question}\n\n(Answer from the text so far only.)`
  }
}

function pickProvider(r: AssistantRequest): { provider: 'claude' | 'openai'; key: string } {
  const order: ('claude' | 'openai')[] = r.provider === 'openai' ? ['openai', 'claude'] : ['claude', 'openai']
  for (const p of order) {
    const key = getKey(p)
    if (key) return { provider: p, key }
  }
  throw new AssistantError('NO_KEY', 'claude')
}

// ---------------------------------------------------------------- providers

async function claude(r: AssistantRequest, key: string, signal: AbortSignal, send: (t: string) => void): Promise<AssistantResponse> {
  const model = r.model || 'claude-opus-5-5'
  const supportsEffort = !/haiku/.test(model)
  const supportsFallback = /opus-5|sonnet-5-5|fable/.test(model)
  const client = new Anthropic({ apiKey: key, timeout: 180_000, maxRetries: 1 })
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...(r.history ?? []).map(h => ({ role: h.role, content: h.text })),
    { role: 'user', content: taskPrompt(r) },
  ]
  try {
    const stream = client.beta.messages.stream({
      model,
      max_tokens: 8000,
      ...(supportsFallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      ...(supportsEffort ? { output_config: { effort: r.task === 'recap' ? 'medium' as const : 'low' as const } } : {}),
      // the book text is the large, repeated part: cache it so follow-up questions are cheap
      system: [
        { type: 'text', text: systemPrompt(r.lang) },
        { type: 'text', text: bookBlock(r), cache_control: { type: 'ephemeral' } },
      ],
      messages,
    }, { signal })
    let text = ''
    for await (const ev of stream) {
      if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
        text += ev.delta.text
        send(ev.delta.text)
      }
    }
    const final = await stream.finalMessage()
    if (final.stop_reason === 'refusal') throw new AssistantError('REFUSED', final.stop_details?.explanation ?? 'refusal')
    const u = final.usage
    return {
      ok: true, text, model: final.model,
      tokens: { input: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), cached: u.cache_read_input_tokens ?? 0, output: u.output_tokens ?? 0 },
    }
  } catch (e) {
    if (e instanceof AssistantError) throw e
    if (e instanceof Anthropic.APIUserAbortError) throw new AssistantError('FAILED', 'aborted')
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw new AssistantError('AUTH', e.message)
    if (e instanceof Anthropic.RateLimitError) throw new AssistantError('RATE', e.message)
    if (e instanceof Anthropic.NotFoundError) throw new AssistantError('FAILED', `model "${model}" not found`)
    if (e instanceof Anthropic.APIConnectionError) throw new AssistantError('NETWORK', e.message)
    if (e instanceof Anthropic.BadRequestError && /too long|context|maximum/i.test(e.message)) throw new AssistantError('TOO_LONG', e.message)
    if (e instanceof Anthropic.APIError) throw new AssistantError(/credit|billing/i.test(e.message) ? 'QUOTA' : 'FAILED', `${e.status ?? ''} ${e.message}`.trim())
    throw e
  }
}

async function openai(r: AssistantRequest, key: string, signal: AbortSignal, send: (t: string) => void): Promise<AssistantResponse> {
  const model = r.model || 'gpt-5-mini'
  let res: Response
  try {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt(r.lang) + '\n\n' + bookBlock(r) },
          ...(r.history ?? []).map(h => ({ role: h.role, content: h.text })),
          { role: 'user', content: taskPrompt(r) },
        ],
      }),
    })
  } catch (e: any) {
    throw new AssistantError(signal.aborted ? 'FAILED' : 'NETWORK', signal.aborted ? 'aborted' : String(e?.message ?? e))
  }
  if (!res.ok) {
    const body = await res.text()
    throw new AssistantError(res.status === 401 || res.status === 403 ? 'AUTH' : res.status === 429 ? (/quota|billing/i.test(body) ? 'QUOTA' : 'RATE') : 'FAILED', `${res.status} ${body.slice(0, 300)}`)
  }
  const j: any = await res.json()
  const text = String(j.choices?.[0]?.message?.content ?? '')
  send(text)
  return { ok: true, text, model: j.model, tokens: { input: j.usage?.prompt_tokens ?? 0, cached: j.usage?.prompt_tokens_details?.cached_tokens ?? 0, output: j.usage?.completion_tokens ?? 0 } }
}

/** Automated tests (BC_TEST) with the key "test-mock-key": a canned streamed answer, no network. */
async function mock(r: AssistantRequest, signal: AbortSignal, send: (t: string) => void): Promise<AssistantResponse> {
  const text = `### ${r.task}\n\n**Mock answer** for *${r.book.title}*. The model saw **${r.readSoFar.length}** characters`
    + `${r.trimmed ? ' (trimmed)' : ''}, ending with: “${r.readSoFar.slice(-60).replace(/\s+/g, ' ').trim()}”.\n\n`
    + `- task: ${r.task}\n- selection: ${r.selection ?? '—'}\n- question: ${r.question ?? '—'}\n- turns before: ${r.history?.length ?? 0}\n\nDone.`
  for (let i = 0; i < text.length; i += 12) {
    if (signal.aborted) throw new AssistantError('FAILED', 'aborted')
    send(text.slice(i, i + 12))
    await new Promise(res => setTimeout(res, 25))
  }
  return { ok: true, text, model: 'mock', tokens: { input: Math.round(r.readSoFar.length / 4), cached: 0, output: Math.round(text.length / 4) } }
}

// ---------------------------------------------------------------- entry points

export async function askAssistant(r: AssistantRequest, wc: WebContents, testMode: boolean): Promise<AssistantResponse> {
  const ac = new AbortController()
  jobs.set(r.id, ac)
  const send = (text: string) => { if (!wc.isDestroyed()) wc.send('assistant:delta', { id: r.id, text }) }
  try {
    const { provider, key } = pickProvider(r)
    if (testMode && key === 'test-mock-key') return await mock(r, ac.signal, send)
    return provider === 'claude' ? await claude(r, key, ac.signal, send) : await openai(r, key, ac.signal, send)
  } catch (e: any) {
    if (e instanceof AssistantError) return { ok: false, code: e.code, message: e.message }
    return { ok: false, code: 'FAILED', message: String(e?.message ?? e) }
  } finally {
    jobs.delete(r.id)
  }
}

export function cancelAssistant(id: string) {
  jobs.get(id)?.abort()
}

export function assistantAvailable() {
  return { claude: !!getKey('claude'), openai: !!getKey('openai') }
}
