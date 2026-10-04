import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { X, Copy, DownloadSimple, Check, WarningCircle } from '@phosphor-icons/react'
import type { QuoteCardPrefs } from '../../../shared/types'
import { bc, coverUrl } from '../api'
import { useT, type TKey } from '../i18n'
import { useUi } from '../store/ui'
import { useLibrary } from '../store/library'
import { useSettings } from '../store/settings'
import { IconButton, Segmented, Toggle } from '../components/ui'
import { renderQuoteCard, canvasToPng, cleanQuote } from './card'

const STYLES: QuoteCardPrefs['style'][] = ['paper', 'night', 'cover']
const FORMATS: QuoteCardPrefs['format'][] = ['square', 'story', 'wide']
const FONT_PREVIEW: Record<QuoteCardPrefs['font'], [string, string]> = {
  cormorant: ['Cormorant', "'Cormorant Garamond', serif"],
  literata: ['Literata', "'Literata', serif"],
  manrope: ['Manrope', "'Manrope Variable', sans-serif"],
}

const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'quote'

/** Global host: opened from the reader selection, a highlight, or the notes page. */
export function QuoteCardHost() {
  const req = useUi(s => s.quoteCard)
  return req ? <QuoteCardDialog key={`${req.bookId}:${req.text.length}`} /> : null
}

function QuoteCardDialog() {
  const t = useT()
  const req = useUi(s => s.quoteCard)!
  const book = useLibrary(s => s.books.find(b => b.id === req.bookId))
  const version = useLibrary(s => s.coverVersion[req.bookId])
  const prefs = useSettings(s => s.settings.quoteCard)
  const update = useSettings(s => s.update)
  const [text, setText] = useState(() => cleanQuote(req.text))
  const [debounced, setDebounced] = useState(text)
  const [truncated, setTruncated] = useState(false)
  const [busy, setBusy] = useState<'copy' | 'save' | null>(null)
  const [copied, setCopied] = useState(false)
  const holder = useRef<HTMLDivElement>(null)
  const current = useRef<HTMLCanvasElement | null>(null)
  const seq = useRef(0)
  const close = () => useUi.getState().showQuoteCard(null)
  const set = <K extends keyof QuoteCardPrefs>(k: K, v: QuoteCardPrefs[K]) => update(s => { s.quoteCard[k] = v })

  useEffect(() => {
    const id = setTimeout(() => setDebounced(text), 250)
    return () => clearTimeout(id)
  }, [text])

  // render off-DOM and swap in when done, so the preview never flashes empty
  useEffect(() => {
    if (!book) return
    const my = ++seq.current
    const canvas = document.createElement('canvas')
    canvas.className = 'qc-canvas'
    canvas.setAttribute('role', 'img')
    canvas.setAttribute('aria-label', t('quote.preview'))
    renderQuoteCard(canvas, { text: debounced || '…', book, chapter: req.chapter, coverVersion: version }, prefs).then(r => {
      if (my !== seq.current || !holder.current) return
      holder.current.replaceChildren(canvas)
      current.current = canvas
      setTruncated(r.truncated)
    }).catch(e => console.warn('quote card render failed', e))
  }, [debounced, prefs, book?.id, book?.title, book?.hasCover, version])

  // the dialog owns the keyboard while open (no page turns behind it)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation()
      if (e.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [])

  if (!book) return null

  const png = async () => {
    // make sure the last keystrokes are rendered
    if (debounced !== text) {
      setDebounced(text)
      await new Promise(r => setTimeout(r, 120))
    }
    return canvasToPng(current.current!)
  }
  const copy = async () => {
    if (!current.current) return
    setBusy('copy')
    try {
      const ok = await bc.copyImage(await png())
      if (ok) {
        setCopied(true)
        setTimeout(() => setCopied(false), 1800)
        useUi.getState().toast({ kind: 'success', text: t('quote.copied') })
      }
    } finally { setBusy(null) }
  }
  const save = async () => {
    if (!current.current) return
    setBusy('save')
    try {
      const ok = await bc.savePng(`${safeName(book.title)} — ${t('quote.fileSuffix')}.png`, await png())
      if (ok) useUi.getState().toast({ kind: 'success', text: t('quote.saved') })
    } finally { setBusy(null) }
  }

  return (
    <div className="dialog-backdrop" onPointerDown={e => e.target === e.currentTarget && close()}>
      <div className="dialog qc-dialog" role="dialog" aria-modal="true" aria-labelledby="qc-title">
        <section className={`qc-stage fmt-${prefs.format}`}>
          <div className="qc-holder" ref={holder} />
        </section>
        <aside className="qc-side">
          <header className="qc-head">
            <h2 id="qc-title">{t('quote.title')}</h2>
            <IconButton label={t('common.close')} onClick={close}><X size={18} /></IconButton>
          </header>

          <div className="qc-group">
            <span className="eyebrow">{t('quote.style')}</span>
            <div className="qc-styles" role="radiogroup" aria-label={t('quote.style')}>
              {STYLES.map(s => (
                <button key={s} type="button" role="radio" aria-checked={prefs.style === s}
                  className={`qc-style qc-style-${s} ${prefs.style === s ? 'on' : ''}`} onClick={() => set('style', s)}
                  style={s === 'cover' ? { '--qc-cover': book.coverColor ?? '#3a3633' } as CSSProperties : undefined}>
                  <span className="qc-swatch">
                    {s === 'cover' && book.hasCover && <img src={coverUrl(book.id, version)} alt="" />}
                    <span className="qc-swatch-mark">“</span>
                    <i /><i /><i />
                  </span>
                  <span className="qc-style-label">{t(`quote.style.${s}` as TKey)}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="qc-group">
            <span className="eyebrow">{t('quote.format')}</span>
            <Segmented block value={prefs.format} onChange={v => set('format', v)} label={t('quote.format')}
              options={FORMATS.map(f => ({ value: f, label: <span className="qc-fmt"><i className={`qc-ratio r-${f}`} />{t(`quote.format.${f}` as TKey)}</span> }))} />
          </div>

          <div className="qc-group">
            <span className="eyebrow">{t('quote.font')}</span>
            <Segmented block value={prefs.font} onChange={v => set('font', v)} label={t('quote.font')}
              options={(Object.keys(FONT_PREVIEW) as QuoteCardPrefs['font'][]).map(f => ({
                value: f, label: <span style={{ fontFamily: FONT_PREVIEW[f][1], fontSize: f === 'cormorant' ? 16 : 13.5 }}>{FONT_PREVIEW[f][0]}</span>,
              }))} />
          </div>

          <div className="qc-group qc-text">
            <label className="eyebrow" htmlFor="qc-text">{t('quote.text')}</label>
            <textarea id="qc-text" className="input" value={text} maxLength={2000} onChange={e => setText(e.target.value)} />
            {truncated && <div className="qc-warn" role="status"><WarningCircle size={15} weight="fill" /> {t('quote.truncated')}</div>}
          </div>

          <div className="qc-toggles">
            <Toggle checked={prefs.showCover} onChange={v => set('showCover', v)} label={t('quote.showCover')} />
            <Toggle checked={prefs.showBrand} onChange={v => set('showBrand', v)} label={t('quote.showBrand')} />
          </div>

          <footer className="qc-actions">
            <button className="btn" onClick={save} disabled={!!busy}>
              {busy === 'save' ? <span className="spinner" /> : <DownloadSimple size={16} />} {t('quote.save')}
            </button>
            <button className="btn primary" onClick={copy} disabled={!!busy}>
              {busy === 'copy' ? <span className="spinner" /> : copied ? <Check size={16} weight="bold" /> : <Copy size={16} />}
              {copied ? t('common.copied') : t('quote.copy')}
            </button>
          </footer>
        </aside>
      </div>
    </div>
  )
}
