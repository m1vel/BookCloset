import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { MagnifyingGlass, X, Cards, Export, SpeakerHigh, Trash, BookOpen, Confetti, ArrowRight } from '@phosphor-icons/react'
import type { VocabEntry } from '../../../shared/types'
import { bc } from '../api'
import { useT, type TKey } from '../i18n'
import { useSettings } from '../store/settings'
import { useLibrary } from '../store/library'
import { useUi } from '../store/ui'
import { useVocab, ankiExport } from '../store/vocab'
import { GRADES, schedule, formatWait, isDue, isLearned, type Grade } from '../vocab/srs'
import { IconButton, Segmented } from '../components/ui'
import { pickVoice } from './reader/ReadAloud'
import { openBookById } from './open'

function speak(text: string, lang: string) {
  speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  const v = pickVoice(speechSynthesis.getVoices(), lang, useSettings.getState().settings.tts.voices)
  if (v) u.voice = v
  u.lang = v?.lang ?? lang
  speechSynthesis.speak(u)
}

/** Context sentence with the term emphasised. */
function Context({ text, term }: { text: string; term: string }) {
  const i = text.toLocaleLowerCase().indexOf(term.toLocaleLowerCase())
  if (i < 0) return <>{text}</>
  return <>{text.slice(0, i)}<mark>{text.slice(i, i + term.length)}</mark>{text.slice(i + term.length)}</>
}

const langName = (code: string, ui: string) => {
  try { return new Intl.DisplayNames([ui], { type: 'language' }).of(code) ?? code } catch { return code }
}

export default function VocabView() {
  const t = useT()
  const ui = useSettings(s => s.settings.lang)
  const entries = useVocab(s => s.entries)
  // subscribe to the minute tick, but compute with the real clock
  useVocab(s => s.now)
  const now = Date.now()
  const [q, setQ] = useState('')
  const [lang, setLang] = useState<string>('all')
  const [review, setReview] = useState(false)
  useEffect(() => { useVocab.getState().load() }, [])

  const langs = useMemo(() => [...new Set(entries.map(e => e.lang))].sort(), [entries])
  const scoped = lang === 'all' ? entries : entries.filter(e => e.lang === lang)
  const due = scoped.filter(e => isDue(e, now))
  const learned = scoped.filter(isLearned).length
  const shown = useMemo(() => {
    const needle = q.trim().toLocaleLowerCase()
    const list = needle ? scoped.filter(e => `${e.term} ${e.translation} ${e.context ?? ''}`.toLocaleLowerCase().includes(needle)) : scoped
    return [...list].sort((a, b) => b.createdAt - a.createdAt)
  }, [scoped, q])

  const exportAnki = async () => {
    const ok = await bc.saveText('BookCloset vocabulary (Anki).txt', ankiExport(scoped))
    if (ok) useUi.getState().toast({ kind: 'success', text: t('vocab.exported', { n: scoped.length }), sub: t('vocab.exportedHint') })
  }

  if (review) return <ReviewSession cards={due} onExit={() => setReview(false)} />

  return (
    <div className="notes-view vocab-view">
      <header className="lib-header drag-region">
        <div className="lib-title">
          <span className="eyebrow">{t('vocab.count', { n: entries.length })}</span>
          <h1 className="display">{t('nav.vocab')}</h1>
        </div>
        <div className="lib-tools no-drag">
          <div className="search-field lib-search">
            <MagnifyingGlass size={16} />
            <input className="input" placeholder={t('vocab.search')} value={q} onChange={e => setQ(e.target.value)} />
            {q && <IconButton size="sm" className="clear" label={t('common.close')} onClick={() => setQ('')}><X size={14} /></IconButton>}
          </div>
          {entries.length > 0 && <button className="btn" onClick={exportAnki}><Export size={16} /> {t('vocab.exportAnki')}</button>}
        </div>
      </header>
      <div className="lib-scroll">
        {!entries.length ? (
          <div className="empty rise-in vocab-empty">
            <Cards size={46} weight="duotone" />
            <h3 className="display">{t('vocab.empty')}</h3>
            <p className="muted">{t('vocab.emptyHint')}</p>
          </div>
        ) : (
          <>
            <section className="vocab-hero rise-in">
              <div className="vh-main">
                <div className="vh-due display tabular">{due.length}</div>
                <div>
                  <div className="vh-label">{due.length ? t('vocab.dueNow') : t('vocab.nothingDue')}</div>
                  <div className="faint vh-sub">
                    {due.length ? t('vocab.dueHint') : nextDueLabel(scoped, now, ui, t)}
                  </div>
                </div>
                <button className="btn primary lg" disabled={!due.length} onClick={() => setReview(true)}>
                  <Cards size={18} /> {t('vocab.review')}
                </button>
              </div>
              <dl className="vh-stats">
                <div><dt>{t('vocab.total')}</dt><dd className="tabular">{scoped.length}</dd></div>
                <div><dt>{t('vocab.learning')}</dt><dd className="tabular">{scoped.length - learned}</dd></div>
                <div><dt>{t('vocab.learned')}</dt><dd className="tabular">{learned}</dd></div>
              </dl>
            </section>
            {langs.length > 1 && (
              <div className="vocab-filter">
                <Segmented value={lang} onChange={setLang} label={t('vocab.language')}
                  options={[{ value: 'all', label: t('vocab.allLangs') }, ...langs.map(l => ({ value: l, label: langName(l, ui) }))]} />
              </div>
            )}
            <div className="vocab-list" role="list">
              {shown.map(e => <VocabRow key={e.id} e={e} now={now} />)}
              {!shown.length && <div className="faint vocab-none">{t('vocab.noMatches')}</div>}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function nextDueLabel(list: VocabEntry[], now: number, ui: string, t: ReturnType<typeof useT>) {
  const next = Math.min(...list.map(e => e.srs.due))
  return Number.isFinite(next) ? t('vocab.nextIn', { time: formatWait(next - now, ui) }) : ''
}

function VocabRow({ e, now }: { e: VocabEntry; now: number }) {
  const t = useT()
  const ui = useSettings(s => s.settings.lang)
  const hasBook = useLibrary(s => !!e.bookId && s.books.some(b => b.id === e.bookId))
  const dueIn = e.srs.due - now
  return (
    <article className="vocab-row" role="listitem">
      <div className="vr-term">
        <span className="vr-word">{e.term}</span>
        <span className="vr-lang">{e.lang}</span>
      </div>
      <div className="vr-tr">
        <div className="vr-translation">{e.translation}</div>
        {e.meanings && <div className="vr-meanings faint truncate" title={e.meanings}>{e.meanings}</div>}
      </div>
      <div className="vr-ctx">
        {e.context && <div className="vr-sentence clamp-2"><Context text={e.context} term={e.term} /></div>}
        {e.bookTitle && <div className="vr-book faint truncate">{e.bookTitle}</div>}
      </div>
      <div className={`vr-due tabular ${dueIn <= 0 ? 'now' : ''}`}>
        {dueIn <= 0 ? t('vocab.dueBadge') : formatWait(dueIn, ui)}
      </div>
      <div className="vr-actions">
        <IconButton size="sm" label={t('vocab.listen')} onClick={() => speak(e.term, e.lang)}><SpeakerHigh size={15} /></IconButton>
        {hasBook && <IconButton size="sm" label={t('vocab.openInBook')} onClick={() => openBookById(e.bookId!, e.cfi ?? e.page)}><BookOpen size={15} /></IconButton>}
        <IconButton size="sm" label={t('common.delete')} onClick={() => useVocab.getState().remove(e.id)}><Trash size={15} /></IconButton>
      </div>
    </article>
  )
}

// ---------------------------------------------------------------- review session

function ReviewSession({ cards, onExit }: { cards: VocabEntry[]; onExit: () => void }) {
  const t = useT()
  const ui = useSettings(s => s.settings.lang)
  // fixed at the start; "again" puts the card back at the end of this session
  const [queue, setQueue] = useState(() => [...cards].sort((a, b) => a.srs.due - b.srs.due).slice(0, 100).map(c => c.id))
  const [shown, setShown] = useState(false)
  const [done, setDone] = useState(0)
  const [tally, setTally] = useState<Record<Grade, number>>({ again: 0, hard: 0, good: 0, easy: 0 })
  const entries = useVocab(s => s.entries)
  const card = entries.find(e => e.id === queue[0])
  const total = done + queue.length

  const grade = (g: Grade) => {
    if (!card || !shown) return
    useVocab.getState().grade(card.id, g)
    setTally(x => ({ ...x, [g]: x[g] + 1 }))
    setQueue(q => (g === 'again' ? [...q.slice(1), q[0]] : q.slice(1)))
    if (g !== 'again') setDone(d => d + 1)
    setShown(false)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      if (e.key === 'Escape') { e.preventDefault(); onExit() }
      else if ((e.key === ' ' || e.key === 'Enter') && !shown) { e.preventDefault(); setShown(true) }
      else if (shown && /^[1-4]$/.test(e.key)) { e.preventDefault(); grade(GRADES[Number(e.key) - 1]) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // pronounce the word when a card appears
  useEffect(() => { if (card) speak(card.term, card.lang) }, [card?.id])

  const header = (
    <header className="review-head drag-region">
      <button className="btn ghost sm no-drag" onClick={onExit}><X size={15} /> {t('vocab.finish')}</button>
      <div className="review-progress no-drag" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
        <div className="progress-line"><i style={{ width: `${total ? (done / total) * 100 : 100}%` }} /></div>
        <span className="tabular faint">{done} / {total}</span>
      </div>
    </header>
  )

  if (!card) {
    return (
      <div className="review">
        {header}
        <div className="review-done rise-in">
          <Confetti size={52} weight="duotone" />
          <h2 className="display">{t('vocab.sessionDone')}</h2>
          <p className="muted">{t('vocab.sessionStats', { n: done })}</p>
          <div className="review-tally">
            {GRADES.map(g => <span key={g} className={`tally g-${g}`}>{t(`vocab.g.${g}` as TKey)} · <b className="tabular">{tally[g]}</b></span>)}
          </div>
          <button className="btn primary" onClick={onExit}><ArrowRight size={16} /> {t('vocab.backToList')}</button>
        </div>
      </div>
    )
  }

  const preview = (g: Grade) => formatWait(schedule(card.srs, g).due - Date.now(), ui)
  return (
    <div className="review">
      {header}
      <div className="review-stage">
        <article key={card.id} className={`flashcard ${shown ? 'shown' : ''}`} aria-live="polite">
          <div className="fc-meta">
            <span className="vr-lang">{card.lang} → {card.target}</span>
            {card.bookTitle && <span className="faint truncate">{card.bookTitle}</span>}
          </div>
          <div className="fc-term display">
            {card.term}
            <IconButton size="sm" label={t('vocab.listen')} onClick={() => speak(card.term, card.lang)}><SpeakerHigh size={17} /></IconButton>
          </div>
          {card.context && <p className="fc-context"><Context text={card.context} term={card.term} /></p>}
          <div className="fc-answer" hidden={!shown}>
            <div className="fc-sep" />
            <div className="fc-translation">{card.translation}</div>
            {card.meanings && <div className="fc-meanings faint">{card.meanings}</div>}
          </div>
        </article>
        <div className="review-actions">
          {!shown ? (
            <button className="btn primary lg reveal-btn" onClick={() => setShown(true)}>
              {t('vocab.show')} <kbd>Space</kbd>
            </button>
          ) : (
            <div className="grade-row">
              {GRADES.map((g, i) => (
                <GradeButton key={g} grade={g} onClick={() => grade(g)} hint={preview(g)}>
                  {t(`vocab.g.${g}` as TKey)} <kbd>{i + 1}</kbd>
                </GradeButton>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function GradeButton({ grade, hint, onClick, children }: { grade: Grade; hint: string; onClick: () => void; children: ReactNode }) {
  return (
    <button className={`grade-btn g-${grade}`} onClick={onClick}>
      <span className="gb-label">{children}</span>
      <span className="gb-hint tabular">{hint}</span>
    </button>
  )
}
