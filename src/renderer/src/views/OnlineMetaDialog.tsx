import { useEffect, useMemo, useRef, useState } from 'react'
import { X, MagnifyingGlass, Check, ImageBroken, WifiSlash, BookOpenText } from '@phosphor-icons/react'
import type { BookRecord, MetaCandidate } from '../../../shared/types'
import { bc } from '../api'
import { useT } from '../i18n'
import { useLibrary } from '../store/library'
import { useUi } from '../store/ui'
import { IconButton } from '../components/ui'
import { queryFor, matchScore, applyCoverFromUrl } from '../library/online'
import { sanitizeHtml } from '../formats/sanitize'

type Field = 'cover' | 'desc' | 'year' | 'authors'

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/** Open Library descriptions are plain text with blank-line paragraphs and markdown-ish links. */
function plainToHtml(text: string) {
  return text
    .replace(/\r/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .split(/\n{2,}|-{5,}/)
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => `<p>${escapeHtml(p)}</p>`)
    .join('')
}

/** Remote thumbnails go through main (CSP keeps remote images out of the renderer). */
function useThumb(url?: string) {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!url) return
    let alive = true, obj: string | null = null
    bc.meta.image(url).then(bytes => {
      if (!alive) return
      if (!bytes) { setFailed(true); return }
      obj = URL.createObjectURL(new Blob([bytes as BlobPart]))
      setSrc(obj)
    }).catch(() => alive && setFailed(true))
    return () => { alive = false; if (obj) URL.revokeObjectURL(obj) }
  }, [url])
  return { src, failed: failed || !url }
}

function ResultCard({ c, score, selected, onSelect }: {
  c: MetaCandidate; score: number; selected: boolean; onSelect: () => void
}) {
  const t = useT()
  const { src, failed } = useThumb(c.thumbUrl)
  const pct = Math.round(score * 100)
  return (
    <button type="button" className={`meta-card ${selected ? 'selected' : ''}`} onClick={onSelect} aria-pressed={selected}>
      <div className="meta-thumb">
        {src ? <img src={src} alt="" draggable={false} />
          : failed ? <span className="meta-nocover"><ImageBroken size={22} /><small>{t('online.noCover')}</small></span>
          : <span className="meta-thumb-loading" />}
        {selected && <span className="meta-check"><Check size={14} weight="bold" /></span>}
      </div>
      <div className="meta-info">
        <div className="meta-title clamp-2" title={c.title}>{c.title}</div>
        <div className="meta-authors truncate">{c.authors.join(', ') || '—'}</div>
        <div className="meta-facts faint truncate">
          {[c.year, c.publisher, c.pages ? t('online.pages', { n: c.pages }) : null].filter(Boolean).join(' · ')}
        </div>
        <div className="meta-foot">
          <span className="meta-source">{c.source}</span>
          <span className={`meta-score ${pct >= 72 ? 'good' : pct >= 50 ? 'mid' : ''}`} data-tip={t('online.match')}>
            <i style={{ width: `${pct}%` }} />
          </span>
        </div>
      </div>
    </button>
  )
}

export function OnlineMetaDialog({ book, onClose }: { book: BookRecord; onClose: () => void }) {
  const t = useT()
  const initial = queryFor(book)
  const [title, setTitle] = useState(initial.title)
  const [author, setAuthor] = useState(initial.author ?? '')
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'offline'>('idle')
  const [results, setResults] = useState<MetaCandidate[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [desc, setDesc] = useState<Record<string, string | null>>({})
  const [fields, setFields] = useState<Record<Field, boolean>>({
    cover: true, desc: !book.description, year: !book.published, authors: !book.authors.length,
  })
  const [applying, setApplying] = useState(false)
  const seq = useRef(0)

  const ranked = useMemo(() => results
    .map(c => ({ c, s: matchScore(book, c) }))
    .sort((a, b) => (b.s - a.s) || (Number(!!b.c.coverUrl) - Number(!!a.c.coverUrl))), [results, book])
  const sel = ranked.find(r => r.c.id === selected)?.c

  const search = async () => {
    if (!title.trim()) return
    const my = ++seq.current
    setState('loading')
    try {
      const list = await bc.meta.search({ title: title.trim(), author: author.trim() || undefined, lang: initial.lang })
      if (my !== seq.current) return
      setResults(list)
      setState(list.length || navigator.onLine ? 'done' : 'offline')
      const best = list.map(c => ({ c, s: matchScore(book, c) })).sort((a, b) => b.s - a.s)[0]
      setSelected(best && best.s >= 0.5 ? best.c.id : null)
    } catch {
      if (my === seq.current) setState('offline')
    }
  }

  useEffect(() => { search() }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose() }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])

  // descriptions: Google Books has them inline, Open Library needs a second request
  useEffect(() => {
    if (!sel || sel.id in desc) return
    if (sel.description) { setDesc(d => ({ ...d, [sel.id]: sel.description! })); return }
    if (!sel.detailsKey) { setDesc(d => ({ ...d, [sel.id]: null })); return }
    bc.meta.details(sel.detailsKey).then(r => {
      setDesc(d => ({ ...d, [sel.id]: r.description ? plainToHtml(r.description) : null }))
    }).catch(() => setDesc(d => ({ ...d, [sel.id]: null })))
  }, [sel?.id])

  const selDesc = sel ? desc[sel.id] : undefined
  const available: Record<Field, boolean> = {
    cover: !!sel?.coverUrl,
    desc: !!selDesc,
    year: !!(sel?.year || sel?.publisher),
    authors: !!sel?.authors.length,
  }
  const chosen = (Object.keys(fields) as Field[]).filter(f => fields[f] && available[f])

  const apply = async () => {
    if (!sel || !chosen.length) return
    setApplying(true)
    const ui = useUi.getState()
    const patch: Partial<BookRecord> = {}
    if (chosen.includes('desc') && selDesc) patch.description = selDesc
    if (chosen.includes('year')) {
      if (sel.year) patch.published = sel.year
      if (sel.publisher) patch.publisher = sel.publisher
    }
    if (chosen.includes('authors')) patch.authors = sel.authors
    if (Object.keys(patch).length) await useLibrary.getState().update(book.id, patch)
    let ok = true
    if (chosen.includes('cover')) ok = await applyCoverFromUrl(book.id, sel.coverUrl!)
    setApplying(false)
    ui.toast(ok ? { kind: 'success', text: t('online.applied') } : { kind: 'error', text: t('online.coverFailed') })
    if (ok) onClose()
  }

  const toggle = (f: Field) => setFields(s => ({ ...s, [f]: !s[f] }))
  const FIELDS: [Field, string][] = [
    ['cover', t('online.applyCover')], ['desc', t('online.applyDesc')],
    ['year', t('online.applyYear')], ['authors', t('online.applyAuthors')],
  ]

  return (
    <div className="dialog-backdrop" onPointerDown={e => e.target === e.currentTarget && onClose()}>
      <div className="dialog meta-dialog" role="dialog" aria-modal="true" aria-labelledby="meta-title">
        <header className="meta-head">
          <div>
            <h2 id="meta-title">{t('online.title')}</h2>
            <div className="faint">{t('online.sub')}</div>
          </div>
          <IconButton label={t('common.close')} onClick={onClose}><X size={18} /></IconButton>
        </header>

        <form className="meta-search" onSubmit={e => { e.preventDefault(); search() }}>
          <label className="field"><span>{t('online.query')}</span>
            <input className="input" value={title} onChange={e => setTitle(e.target.value)} autoFocus /></label>
          <label className="field"><span>{t('online.author')}</span>
            <input className="input" value={author} onChange={e => setAuthor(e.target.value)} /></label>
          <button type="submit" className="btn" disabled={state === 'loading' || !title.trim()}>
            {state === 'loading' ? <span className="spinner" /> : <MagnifyingGlass size={16} />} {t('online.search')}
          </button>
        </form>

        <div className="meta-body">
          {state === 'loading' && !results.length ? (
            <div className="meta-grid" aria-busy="true">
              {Array.from({ length: 6 }, (_, i) => <div key={i} className="meta-card skeleton"><div className="meta-thumb" /><div className="meta-info"><i /><i /><i /></div></div>)}
            </div>
          ) : state === 'offline' ? (
            <div className="meta-empty"><WifiSlash size={30} /><p>{t('online.offline')}</p></div>
          ) : state === 'done' && !results.length ? (
            <div className="meta-empty"><BookOpenText size={30} /><p>{t('online.empty')}</p></div>
          ) : (
            <div className={`meta-grid ${state === 'loading' ? 'stale' : ''}`}>
              {ranked.map(({ c, s }) => (
                <ResultCard key={c.id} c={c} score={s} selected={c.id === selected} onSelect={() => setSelected(c.id)} />
              ))}
            </div>
          )}
          {sel && (
            <aside className="meta-preview">
              <span className="eyebrow">{t('book.description')}</span>
              {selDesc === undefined ? <div className="meta-desc-loading"><i /><i /><i /></div>
                : selDesc ? <div className="desc-html" dangerouslySetInnerHTML={{ __html: sanitizeHtml(selDesc) }} />
                : <div className="faint meta-nodesc">{t('online.noDesc')}</div>}
            </aside>
          )}
        </div>

        <footer className="meta-actions">
          <div className="chips" role="group" aria-label={t('online.apply')}>
            {FIELDS.map(([f, label]) => (
              <button key={f} type="button" className={`chip ${fields[f] && available[f] ? 'on' : ''}`}
                disabled={!available[f]} aria-pressed={fields[f] && available[f]} onClick={() => toggle(f)}>
                {fields[f] && available[f] && <Check size={12} weight="bold" />} {label}
              </button>
            ))}
          </div>
          <button className="btn primary" disabled={!sel || !chosen.length || applying} onClick={apply}>
            {applying ? <span className="spinner" /> : <Check size={16} weight="bold" />} {t('online.apply')}
          </button>
        </footer>
      </div>
    </div>
  )
}
