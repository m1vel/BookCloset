import { Plus } from '@phosphor-icons/react'
import { useT } from '../i18n'

const FORMATS = ['EPUB', 'FB2', 'PDF', 'MOBI', 'AZW3', 'DjVu', 'DOCX', 'RTF', 'TXT', 'HTML', 'CBZ', 'CBR', 'CHM', 'ODT', 'MD']

/** Illustrated empty state: an empty wooden shelf with a leaning book. */
export function EmptyShelf({ onAdd }: { onAdd: () => void }) {
  const t = useT()
  return (
    <div className="empty-shelf rise-in">
      <svg className="empty-illu" viewBox="0 0 360 200" aria-hidden="true">
        <defs>
          <linearGradient id="es-b1" x1="0" x2="1">
            <stop offset="0" stopColor="var(--accent-2)" />
            <stop offset="1" stopColor="var(--accent)" />
          </linearGradient>
        </defs>
        <rect x="40" y="150" width="280" height="12" rx="3" fill="var(--line-2)" />
        <rect x="52" y="162" width="10" height="22" rx="2" fill="var(--line-2)" />
        <rect x="298" y="162" width="10" height="22" rx="2" fill="var(--line-2)" />
        <g className="es-books">
          <rect x="120" y="62" width="26" height="88" rx="3" fill="url(#es-b1)" />
          <rect x="125" y="74" width="16" height="2" fill="var(--accent-ink)" opacity=".6" />
          <rect x="125" y="132" width="16" height="2" fill="var(--accent-ink)" opacity=".6" />
          <rect x="150" y="48" width="22" height="102" rx="3" fill="var(--ink-2)" opacity=".85" />
          <rect x="154" y="60" width="14" height="2" fill="var(--bg)" opacity=".6" />
          <rect x="176" y="70" width="30" height="80" rx="3" fill="var(--gold)" opacity=".9" />
          <rect x="182" y="84" width="18" height="10" rx="1" fill="var(--bg)" opacity=".35" />
          <g transform="rotate(16 240 150)">
            <rect x="216" y="66" width="24" height="84" rx="3" fill="var(--ink-3)" opacity=".7" />
          </g>
        </g>
        <circle cx="280" cy="52" r="3" fill="var(--accent)" opacity=".5" />
        <circle cx="96" cy="40" r="2" fill="var(--gold)" opacity=".6" />
        <circle cx="300" cy="96" r="1.6" fill="var(--ink-3)" opacity=".6" />
      </svg>
      <h2 className="display">{t('lib.empty.title')}</h2>
      <p className="muted">{t('lib.empty.text')}</p>
      <button className="btn primary lg" onClick={onAdd}><Plus size={17} weight="bold" /> {t('lib.add')}</button>
      <div className="format-cloud">
        {FORMATS.map(f => <span key={f} className="badge">{f}</span>)}
        <span className="badge accent">+12</span>
      </div>
    </div>
  )
}
