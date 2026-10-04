import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowRight, Copy, NotePencil, SpeakerHigh, X, WarningCircle, ArrowClockwise, GearSix, Translate as TranslateIcon, Info,
  Cards, Check,
} from '@phosphor-icons/react'
import { useVocab, sentenceAround } from '../../store/vocab'
import type { TranslateResponse, TranslationProviderId, KeyStatus } from '../../../../shared/types'
import { useSettings } from '../../store/settings'
import { useT, type TKey } from '../../i18n'
import { bc } from '../../api'
import {
  PROVIDERS, TARGET_LANGS, detectLanguage, langName, resolveTarget, translateText,
} from '../../translation'

const POS_RU: Record<string, string> = {
  noun: 'сущ.', verb: 'гл.', adjective: 'прил.', adverb: 'нар.', pronoun: 'мест.', preposition: 'предл.',
  conjunction: 'союз', interjection: 'межд.', particle: 'част.', abbreviation: 'сокр.', phrase: 'фраза', numeral: 'числ.',
}

interface Props {
  rect: DOMRect
  text: string
  context?: string
  title?: string
  /** last target chosen in this reading session (falls back to settings) */
  target?: string
  onTarget: (lang: string) => void
  onSave: (translation: string) => void
  onClose: () => void
  onOpenSettings: () => void
  /** where the word came from, for the vocabulary */
  origin?: { bookId: string; bookTitle: string; cfi?: string; page?: number }
}

export function TranslatePopover({ rect, text, context, title, target, onTarget, onSave, onClose, onOpenSettings, origin }: Props) {
  const t = useT()
  const ui = useSettings(s => s.settings.lang)
  const settings = useSettings(s => s.settings.translation)
  const [provider, setProvider] = useState<TranslationProviderId>(settings.provider)
  const detectedLocal = detectLanguage(text)
  const [to, setTo] = useState(() => resolveTarget(detectedLocal, target ?? settings.targetLang, ui))
  const [state, setState] = useState<{ loading: boolean; res?: TranslateResponse }>({ loading: true })
  const [keys, setKeys] = useState<KeyStatus>({})
  const [nonce, setNonce] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useEffect(() => { bc.translate.keyStatus().then(setKeys) }, [])

  useEffect(() => {
    let alive = true
    setState({ loading: true })
    translateText({ text, to, context, title, settings, provider }).then(res => { if (alive) setState({ loading: false, res }) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, to, provider, nonce])

  // position below the selection when there is room, otherwise above
  useLayoutEffect(() => {
    const el = ref.current!
    const w = el.offsetWidth, h = el.offsetHeight
    let top = rect.bottom + 12
    if (top + h > window.innerHeight - 10) top = Math.max(10, rect.top - h - 12)
    const left = Math.max(10, Math.min(window.innerWidth - w - 10, rect.left + rect.width / 2 - w / 2))
    setPos({ left, top })
  }, [rect, state])

  useEffect(() => {
    const down = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onClose() }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    document.addEventListener('pointerdown', down, true)
    document.addEventListener('keydown', key, true)
    return () => { document.removeEventListener('pointerdown', down, true); document.removeEventListener('keydown', key, true) }
  }, [onClose])

  const res = state.res
  const result = res?.ok ? res.result : null
  const source = result?.detected?.toLowerCase().split('-')[0] || detectedLocal
  const short = text.length <= 60 && !/[.!?…]\s/.test(text)
  const info = PROVIDERS.find(p => p.id === (result?.provider ?? provider))!
  const fromLang = result?.detected ?? detectedLocal ?? 'en'
  const saved = useVocab(s => (result ? s.find(text, fromLang) : undefined))
  const addToVocab = () => {
    if (!result || saved) return
    const term = text.trim()
    useVocab.getState().add({
      term, translation: result.text, lang: fromLang, target: to,
      meanings: result.meanings?.slice(0, 3).map(m => `${m.pos}: ${m.terms.slice(0, 4).join(', ')}`).join('; ') || undefined,
      context: sentenceAround(context, term, fromLang),
      bookId: origin?.bookId, bookTitle: origin?.bookTitle, cfi: origin?.cfi, page: origin?.page,
    })
  }
  const vocabSized = text.trim().length <= 60
  const available = PROVIDERS.filter(p => !p.needsKey || keys[p.id]?.set)

  const speak = () => {
    try {
      speechSynthesis.cancel()
      const u = new SpeechSynthesisUtterance(text)
      if (source) u.lang = source
      const voice = speechSynthesis.getVoices().find(v => v.lang.toLowerCase().startsWith(source ?? ''))
      if (voice) u.voice = voice
      u.rate = 0.9
      speechSynthesis.speak(u)
    } catch { /* no voices */ }
  }

  const errorText = (code: string) => t(`tr.err.${code}` as TKey)

  return createPortal(
    <div ref={ref} className="tr-pop" role="dialog" aria-label={t('reader.translate')}
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}>
      <header className="tr-head">
        <span className="tr-lang" title={t('tr.detected')}>{langName(source, ui)}</span>
        <ArrowRight size={14} className="tr-arrow" />
        <select className="tr-select" value={to} aria-label={t('set.translationTarget')}
          onChange={e => { setTo(e.target.value); onTarget(e.target.value) }}>
          {TARGET_LANGS.map(code => <option key={code} value={code}>{langName(code, ui)}</option>)}
        </select>
        <span className="tr-spacer" />
        <select className="tr-select tr-provider" value={provider} aria-label={t('set.translationProvider')}
          onChange={e => setProvider(e.target.value as TranslationProviderId)}>
          {available.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          {!available.some(p => p.id === provider) && <option value={provider}>{info.name}</option>}
        </select>
        <button className="icon-btn sm" aria-label={t('common.close')} onClick={onClose}><X size={15} /></button>
      </header>

      <div className="tr-body">
        {short && (
          <div className="tr-source">
            <span className="tr-word">{text}</span>
            {result?.pronunciation && <span className="tr-pron">[{result.pronunciation}]</span>}
            <button className="icon-btn sm" aria-label={t('tr.listen')} data-tip={t('tr.listen')} onClick={speak}><SpeakerHigh size={15} /></button>
          </div>
        )}

        {state.loading && (
          <div className="tr-skeleton" aria-busy="true">
            <i style={{ width: '92%' }} /><i style={{ width: '78%' }} />{text.length > 120 && <i style={{ width: '85%' }} />}
          </div>
        )}

        {result && (
          <>
            <p className={`tr-text ${short ? 'is-word' : ''}`}>{result.text}</p>
            {result.meanings?.length ? (
              <dl className="tr-meanings">
                {result.meanings.slice(0, 5).map((m, i) => (
                  <div key={i}>
                    <dt>{ui === 'ru' ? POS_RU[m.pos] ?? m.pos : m.pos}</dt>
                    <dd>{m.terms.join(' · ')}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {result.note && <div className="tr-note"><Info size={14} weight="bold" /> {result.note}</div>}
          </>
        )}

        {res && !res.ok && (
          <div className="tr-error">
            <WarningCircle size={22} weight="duotone" />
            <div>
              <b>{errorText(res.code)}</b>
              {res.code !== 'NO_KEY' && <div className="tr-error-detail">{res.message}</div>}
            </div>
          </div>
        )}
      </div>

      <footer className="tr-foot">
        {result ? (
          <>
            <button className="icon-btn sm" aria-label={t('reader.copy')} data-tip={t('reader.copy')} onClick={() => { navigator.clipboard.writeText(result.text) }}><Copy size={15} /></button>
            <button className="btn sm ghost" onClick={() => onSave(result.text)}><NotePencil size={14} /> {t('tr.saveNote')}</button>
            {vocabSized && (
              <button className={`btn sm ${saved ? 'ghost tr-saved' : ''}`} onClick={addToVocab} disabled={!!saved} aria-pressed={!!saved}>
                {saved ? <Check size={14} weight="bold" /> : <Cards size={14} />} {saved ? t('vocab.inVocab') : t('vocab.add')}
              </button>
            )}
            <span className="tr-spacer" />
            <span className="tr-by"><TranslateIcon size={12} /> {result.fallback ? 'MyMemory' : info.name}</span>
          </>
        ) : res && !res.ok ? (
          <>
            <button className="btn sm" onClick={() => setNonce(n => n + 1)}><ArrowClockwise size={14} /> {t('tr.retry')}</button>
            {provider !== 'free' && <button className="btn sm ghost" onClick={() => setProvider('free')}>{t('tr.useFree')}</button>}
            <span className="tr-spacer" />
            <button className="btn sm ghost" onClick={onOpenSettings}><GearSix size={14} /> {t('nav.settings')}</button>
          </>
        ) : <span className="tr-by faint">{t('tr.translating')}</span>}
      </footer>
    </div>,
    document.body,
  )
}
