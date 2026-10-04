import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Copy, NotePencil, MagnifyingGlass, Translate, Trash, TextUnderline, Highlighter, Quotes, SpeakerHigh } from '@phosphor-icons/react'
import type { HighlightColor } from '../../../../shared/types'
import { HIGHLIGHT_COLORS } from '../../engines/types'
import { useT } from '../../i18n'

/** A floating element positioned above (or below) a viewport rect. */
function Floater({ rect, children, className = '', onClose, gap = 10 }: {
  rect: DOMRect; children: ReactNode; className?: string; onClose?: () => void; gap?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; below: boolean } | null>(null)
  useLayoutEffect(() => {
    const el = ref.current!
    const w = el.offsetWidth, h = el.offsetHeight
    let below = rect.top - h - gap < 54
    let top = below ? rect.bottom + gap : rect.top - h - gap
    if (below && top + h > window.innerHeight - 8) { below = false; top = Math.max(8, rect.top - h - gap) }
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, rect.left + rect.width / 2 - w / 2))
    setPos({ left, top, below })
  }, [rect.left, rect.top, rect.width, rect.height])
  useEffect(() => {
    if (!onClose) return
    const down = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onClose() }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    document.addEventListener('pointerdown', down, true)
    document.addEventListener('keydown', key, true)
    return () => { document.removeEventListener('pointerdown', down, true); document.removeEventListener('keydown', key, true) }
  }, [onClose])
  return createPortal(
    <div ref={ref} className={`floater ${pos?.below ? 'below' : ''} ${className}`}
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}>
      {children}
    </div>,
    document.body,
  )
}

const COLORS = Object.keys(HIGHLIGHT_COLORS) as HighlightColor[]

export function SelectionMenu({ rect, onHighlight, onNote, onCopy, onSearch, onTranslate, onQuoteCard, onReadFrom }: {
  rect: DOMRect
  onHighlight: (c: HighlightColor) => void
  onNote: () => void
  onCopy: () => void
  onSearch: () => void
  onTranslate?: () => void
  onQuoteCard: () => void
  onReadFrom: () => void
}) {
  const t = useT()
  return (
    <Floater rect={rect} className="sel-menu">
      <div className="sel-colors">
        {COLORS.slice(0, 5).map(c => (
          <button key={c} className="sel-dot" style={{ background: HIGHLIGHT_COLORS[c] }} aria-label={`${t('reader.highlight')} ${c}`}
            onPointerDown={e => e.preventDefault()} onClick={() => onHighlight(c)} />
        ))}
      </div>
      <span className="sel-sep" />
      <button className="sel-btn" onPointerDown={e => e.preventDefault()} onClick={onNote}><NotePencil size={16} /> {t('reader.note')}</button>
      <button className="sel-btn icon" data-tip={t('reader.copy')} aria-label={t('reader.copy')} onPointerDown={e => e.preventDefault()} onClick={onCopy}><Copy size={16} /></button>
      <button className="sel-btn icon" data-tip={t('reader.searchSel')} aria-label={t('reader.searchSel')} onPointerDown={e => e.preventDefault()} onClick={onSearch}><MagnifyingGlass size={16} /></button>
      <button className="sel-btn icon" data-tip={t('quote.make')} aria-label={t('quote.make')} onPointerDown={e => e.preventDefault()} onClick={onQuoteCard}><Quotes size={16} /></button>
      <button className="sel-btn icon" data-tip={t('tts.readFrom')} aria-label={t('tts.readFrom')} onPointerDown={e => e.preventDefault()} onClick={onReadFrom}><SpeakerHigh size={16} /></button>
      {onTranslate && (
        <button className="sel-btn" onPointerDown={e => e.preventDefault()} onClick={onTranslate}><Translate size={16} /> {t('reader.translate')}</button>
      )}
    </Floater>
  )
}

export function AnnotationMenu({ rect, color, style, onColor, onStyle, onNote, onCopy, onQuoteCard, onDelete, onClose }: {
  rect: DOMRect
  color?: HighlightColor
  style?: string
  onColor: (c: HighlightColor) => void
  onStyle: (s: 'highlight' | 'underline') => void
  onNote: () => void
  onCopy: () => void
  onQuoteCard: () => void
  onDelete: () => void
  onClose: () => void
}) {
  const t = useT()
  return (
    <Floater rect={rect} className="sel-menu" onClose={onClose}>
      <div className="sel-colors">
        {COLORS.slice(0, 5).map(c => (
          <button key={c} className={`sel-dot ${c === color ? 'on' : ''}`} style={{ background: HIGHLIGHT_COLORS[c] }} aria-label={c} onClick={() => onColor(c)} />
        ))}
      </div>
      <span className="sel-sep" />
      <button className={`sel-btn icon ${style !== 'underline' ? 'on' : ''}`} aria-label={t('reader.highlight')} data-tip={t('reader.highlight')} onClick={() => onStyle('highlight')}><Highlighter size={16} /></button>
      <button className={`sel-btn icon ${style === 'underline' ? 'on' : ''}`} aria-label="underline" onClick={() => onStyle('underline')}><TextUnderline size={16} /></button>
      <button className="sel-btn" onClick={onNote}><NotePencil size={16} /> {t('reader.note')}</button>
      <button className="sel-btn icon" aria-label={t('reader.copy')} data-tip={t('reader.copy')} onClick={onCopy}><Copy size={16} /></button>
      <button className="sel-btn icon" aria-label={t('quote.make')} data-tip={t('quote.make')} onClick={onQuoteCard}><Quotes size={16} /></button>
      <button className="sel-btn icon danger" aria-label={t('reader.removeHighlight')} data-tip={t('reader.removeHighlight')} onClick={onDelete}><Trash size={16} /></button>
    </Floater>
  )
}

export function NoteEditor({ rect, quote, initial, onSave, onClose }: {
  rect: DOMRect; quote?: string; initial?: string; onSave: (text: string) => void; onClose: () => void
}) {
  const t = useT()
  const [text, setText] = useState(initial ?? '')
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { setTimeout(() => ref.current?.focus(), 30) }, [])
  return (
    <Floater rect={rect} className="note-editor" onClose={onClose}>
      {quote && <blockquote className="ne-quote clamp-3">{quote}</blockquote>}
      <textarea ref={ref} className="input" placeholder={t('reader.notePlaceholder')} value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) onSave(text) }} />
      <div className="ne-actions">
        <span className="faint" style={{ fontSize: 11.5 }}><span className="kbd">Ctrl</span> + <span className="kbd">Enter</span></span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn ghost sm" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn primary sm" onClick={() => onSave(text)}>{t('book.save')}</button>
        </div>
      </div>
    </Floater>
  )
}

export function FootnotePopup({ rect, html, onClose }: { rect: DOMRect; html: string; onClose: () => void }) {
  return (
    <Floater rect={rect} className="footnote-pop" onClose={onClose}>
      <div className="fn-body" dangerouslySetInnerHTML={{ __html: html }} />
    </Floater>
  )
}

export function TrashIcon() { return <Trash size={16} /> }
