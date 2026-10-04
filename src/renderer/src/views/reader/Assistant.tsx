import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { Sparkle, ArrowUp, ClockCounterClockwise, UserFocus, LockSimple, Stop, Copy, Key, ArrowsClockwise } from '@phosphor-icons/react'
import type { AssistantTask, TranslateErrorCode } from '../../../../shared/types'
import type { EngineController } from '../../engines/types'
import { bc } from '../../api'
import { useT, type TKey } from '../../i18n'
import { useSettings } from '../../store/settings'
import { useUi } from '../../store/ui'

/** ≈ 45k tokens: enough for a long stretch of a novel, cheap enough to ask often */
const CONTEXT_CHARS = 160_000

export interface AiRequest { task: 'explain' | 'who'; selection: string; nonce: number }

interface Turn {
  id: string
  task: AssistantTask
  prompt: string
  answer: string
  status: 'context' | 'streaming' | 'done' | 'error'
  error?: { code: TranslateErrorCode; message: string }
  meta?: string
  selection?: string
  question?: string
}

const uid = () => Math.random().toString(36).slice(2, 11)

/** conversations survive closing the panel (for this app session); unfinished answers were cancelled */
const sessions = new Map<string, Turn[]>()
const settle = (ts: Turn[]) => ts.map(x => (x.status === 'context' || x.status === 'streaming'
  ? { ...x, status: 'error' as const, error: { code: 'FAILED' as const, message: 'aborted' } } : x))

// ---------------------------------------------------------------- tiny, safe Markdown → React

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|_[^_\s][^_]*_|`[^`]+`)/g
  let last = 0, m: RegExpExecArray | null, k = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const s = m[0]
    if (s.startsWith('**')) out.push(<strong key={k++}>{s.slice(2, -2)}</strong>)
    else if (s.startsWith('`')) out.push(<code key={k++}>{s.slice(1, -1)}</code>)
    else out.push(<em key={k++}>{s.slice(1, -1)}</em>)
    last = m.index + s.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  let para: string[] = []
  const flushPara = () => { if (para.length) { blocks.push(<p key={blocks.length}>{inline(para.join(' '))}</p>); para = [] } }
  const flushList = () => {
    if (!list) return
    const items = list.items.map((it, i) => <li key={i}>{inline(it)}</li>)
    blocks.push(list.ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>)
    list = null
  }
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd()
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    const li = /^\s*[-*•]\s+(.*)$/.exec(line)
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (!line.trim()) { flushPara(); flushList(); continue }
    if (h) { flushPara(); flushList(); blocks.push(<h4 key={blocks.length}>{inline(h[2])}</h4>); continue }
    if (li || ol) {
      flushPara()
      const ordered = !!ol
      if (list && list.ordered !== ordered) flushList()
      if (!list) list = { ordered, items: [] }
      list.items.push((li ?? ol)![1])
      continue
    }
    flushList()
    para.push(line.trim())
  }
  flushPara()
  flushList()
  return <div className="md">{blocks.map((b, i) => <Fragment key={i}>{b}</Fragment>)}</div>
}

// ---------------------------------------------------------------- panel

export function AssistantPanel({ controller, book, progress, request, onOpenSettings }: {
  controller: EngineController | null
  book: { id: string; title: string; authors: string[] }
  /** 0..1 reading position, shown as the spoiler boundary */
  progress: number
  request: AiRequest | null
  onOpenSettings: () => void
}) {
  const t = useT()
  const ui = useSettings(s => s.settings.lang)
  const tr = useSettings(s => s.settings.translation)
  const [turns, setTurns] = useState<Turn[]>(() => sessions.get(book.id) ?? [])
  useEffect(() => { sessions.set(book.id, settle(turns)) }, [turns, book.id])
  const [question, setQuestion] = useState('')
  const [who, setWho] = useState<string | null>(null)
  const [avail, setAvail] = useState<{ claude: boolean; openai: boolean } | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const turnsRef = useRef(turns)
  turnsRef.current = turns
  const live = useRef<string | null>(null)

  useEffect(() => { bc.assistant.available().then(setAvail) }, [])
  useEffect(() => bc.assistant.onDelta(d => {
    setTurns(ts => ts.map(x => (x.id === d.id ? { ...x, status: 'streaming', answer: x.answer + d.text } : x)))
  }), [])
  useEffect(() => () => { if (live.current) bc.assistant.cancel(live.current) }, [])
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }) }, [turns])

  const run = async (task: AssistantTask, opts: { selection?: string; question?: string } = {}) => {
    if (live.current) return
    const id = uid()
    live.current = id
    const prompt = task === 'recap' ? t('ai.recapPrompt')
      : task === 'explain' ? t('ai.explainPrompt', { text: clip(opts.selection ?? '', 140) })
      : task === 'who' ? t('ai.whoPrompt', { name: opts.selection ?? '' })
      : opts.question ?? ''
    const history = turnsRef.current.filter(x => x.status === 'done').slice(-3)
      .flatMap(x => [{ role: 'user' as const, text: x.prompt }, { role: 'assistant' as const, text: x.answer }])
    setTurns(ts => [...ts, { id, task, prompt, answer: '', status: 'context', ...opts }])
    const ctx = await (controller?.readSoFar(CONTEXT_CHARS) ?? Promise.resolve({ text: '', trimmed: false }))
    const res = await bc.assistant.ask({
      id, task, lang: ui, book: { title: book.title, authors: book.authors }, readSoFar: ctx.text, trimmed: ctx.trimmed, selection: opts.selection, question: opts.question, history,
      provider: tr.provider === 'openai' ? 'openai' : 'claude',
      model: tr.provider === 'openai' ? tr.openaiModel : tr.claudeModel,
    })
    live.current = null
    setTurns(ts => ts.map(x => {
      if (x.id !== id) return x
      if (!res.ok) return { ...x, status: 'error', error: { code: res.code, message: res.message } }
      const meta = res.tokens ? t('ai.meta', {
        model: res.model ?? '', input: fmtK(res.tokens.input), cached: fmtK(res.tokens.cached),
      }) : res.model
      return { ...x, status: 'done', answer: res.text || x.answer, meta }
    }))
    if (!res.ok && res.code === 'NO_KEY') bc.assistant.available().then(setAvail)
  }

  // requests from the selection menu
  const lastNonce = useRef(0)
  useEffect(() => {
    if (!request || request.nonce === lastNonce.current) return
    lastNonce.current = request.nonce
    void run(request.task, { selection: request.selection })
  }, [request?.nonce])

  const stop = () => { if (live.current) bc.assistant.cancel(live.current) }
  const busy = turns.some(x => x.status === 'context' || x.status === 'streaming')
  const noKey = avail && !avail.claude && !avail.openai
  const send = () => {
    const q = question.trim()
    if (!q || busy) return
    setQuestion('')
    void run('ask', { question: q })
  }

  if (noKey) {
    return (
      <div className="ai-pane">
        <div className="rp-empty ai-setup">
          <Sparkle size={30} weight="duotone" />
          <p className="ai-setup-title">{t('ai.setupTitle')}</p>
          <p className="faint">{t('ai.setupText')}</p>
          <button className="btn primary sm" onClick={onOpenSettings}><Key size={14} /> {t('ai.setupBtn')}</button>
        </div>
      </div>
    )
  }

  return (
    <div className="ai-pane">
      <div className="ai-boundary"><LockSimple size={13} weight="bold" /> {t('ai.boundary', { pct: Math.round(progress * 100) })}</div>
      <div className="ai-quick">
        <button className="chip" disabled={busy} onClick={() => run('recap')}><ClockCounterClockwise size={13} /> {t('ai.recap')}</button>
        <button className={`chip ${who != null ? 'on' : ''}`} disabled={busy} onClick={() => setWho(w => (w == null ? '' : null))}><UserFocus size={13} /> {t('ai.who')}</button>
      </div>
      {who != null && (
        <form className="ai-who" onSubmit={e => { e.preventDefault(); if (who.trim()) { void run('who', { selection: who.trim() }); setWho(null) } }}>
          <input className="input" autoFocus placeholder={t('ai.whoPlaceholder')} value={who} onChange={e => setWho(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setWho(null) } }} />
        </form>
      )}

      <div className="ai-list" ref={listRef} aria-live="polite">
        {!turns.length && (
          <div className="ai-hello">
            <Sparkle size={22} weight="duotone" />
            <p>{t('ai.hello')}</p>
          </div>
        )}
        {turns.map(x => (
          <article key={x.id} className={`ai-turn ${x.status}`}>
            <div className="ai-q">{x.prompt}</div>
            {x.status === 'context' && <div className="ai-wait"><span className="spinner" /> {t('ai.collecting')}</div>}
            {(x.status === 'streaming' || x.status === 'done') && (
              <div className="ai-a">
                <Markdown text={x.answer} />
                {x.status === 'streaming' && <span className="ai-caret" aria-hidden="true" />}
              </div>
            )}
            {x.status === 'error' && x.error && (
              <div className="ai-error">
                <span>{x.error.message === 'aborted' ? t('ai.stopped') : t(`tr.err.${x.error.code}` as TKey)}</span>
                {x.error.code === 'FAILED' && x.error.message !== 'aborted' && <span className="faint ai-error-detail">{x.error.message}</span>}
                <div className="ai-error-actions">
                  {(x.error.code === 'NO_KEY' || x.error.code === 'AUTH') && <button className="btn sm" onClick={onOpenSettings}><Key size={13} /> {t('ai.setupBtn')}</button>}
                  <button className="btn sm ghost" disabled={busy} onClick={() => run(x.task, { selection: x.selection, question: x.question })}><ArrowsClockwise size={13} /> {t('tr.retry')}</button>
                </div>
              </div>
            )}
            {x.status === 'done' && (
              <div className="ai-foot">
                <span className="faint">{x.meta}</span>
                <button className="icon-btn sm" aria-label={t('reader.copy')} data-tip={t('reader.copy')} onClick={() => {
                  navigator.clipboard.writeText(x.answer)
                  useUi.getState().toast({ kind: 'success', text: t('common.copied') })
                }}><Copy size={14} /></button>
              </div>
            )}
          </article>
        ))}
      </div>

      <form className="ai-input" onSubmit={e => { e.preventDefault(); send() }}>
        <textarea className="input" rows={2} placeholder={t('ai.askPlaceholder')} value={question} onChange={e => setQuestion(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
            if (e.key === 'Escape') e.stopPropagation()
          }} />
        {busy
          ? <button type="button" className="icon-btn ai-send" aria-label={t('ai.stop')} data-tip={t('ai.stop')} onClick={stop}><Stop size={16} weight="fill" /></button>
          : <button type="submit" className="icon-btn ai-send" aria-label={t('ai.send')} data-tip={t('ai.send')} disabled={!question.trim()}><ArrowUp size={16} weight="bold" /></button>}
      </form>
    </div>
  )
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s)
const fmtK = (n: number) => (n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n))
