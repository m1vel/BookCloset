import { memo, useState, type CSSProperties } from 'react'
import type { BookRecord } from '../../../shared/types'
import { coverUrl } from '../api'
import { useLibrary } from '../store/library'
import { FORMAT_LABEL } from '../../../shared/formats'

/** Cloth-bound palette for generated covers: [cloth, ink/foil] */
const CLOTH: [string, string, string][] = [
  ['#6e2a24', '#e9c98f', 'oxblood'],
  ['#1f3a5a', '#d9c18b', 'navy'],
  ['#2f4f3a', '#e2cf9a', 'forest'],
  ['#4a2f52', '#e6c992', 'plum'],
  ['#8a5a1f', '#f5e6c4', 'ochre'],
  ['#21474a', '#e8d6a6', 'teal'],
  ['#3a3633', '#e0c690', 'charcoal'],
  ['#7a3b4a', '#f1d9a8', 'rose'],
  ['#2b3e2c', '#c9d6b0', 'moss'],
  ['#5b3a29', '#f0d7a4', 'walnut'],
]

export function hashString(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export const clothFor = (b: Pick<BookRecord, 'title' | 'id'>) => CLOTH[hashString(b.title || b.id) % CLOTH.length]

function GeneratedCover({ book }: { book: BookRecord }) {
  const [cloth, foil] = clothFor(book)
  const author = book.authors[0] ?? ''
  const title = book.title || book.fileName
  const long = title.length > 38
  // shrink the type so that the longest word always fits on one line
  const longest = Math.max(4, ...title.split(/\s+/).map(w => w.length))
  return (
    <div className="gen-cover" style={{ '--cloth': cloth, '--foil': foil, '--longest': longest } as CSSProperties}>
      <div className="gen-frame">
        <div className="gen-author">{author}</div>
        <svg className="gen-orn" viewBox="0 0 60 12" aria-hidden="true">
          <path d="M0 6h22M38 6h22" stroke="currentColor" strokeWidth=".8" />
          <path d="M30 1.5l4.5 4.5L30 10.5 25.5 6z" fill="currentColor" />
        </svg>
        <div className={`gen-title ${long ? 'long' : ''}`}>{title}</div>
        <div className="gen-format">{FORMAT_LABEL[book.format]}</div>
      </div>
    </div>
  )
}

export const Cover = memo(function Cover({ book, className = '', style }: {
  book: BookRecord; className?: string; style?: CSSProperties
}) {
  const version = useLibrary(s => s.coverVersion[book.id])
  const [failed, setFailed] = useState(false)
  const showImage = book.hasCover && !failed
  return (
    <div className={`cover ${className}`} style={style}>
      {showImage
        ? <img src={coverUrl(book.id, version)} alt="" loading="lazy" decoding="async" draggable={false}
            onError={() => setFailed(true)} />
        : <GeneratedCover book={book} />}
      <span className="cover-spine" aria-hidden="true" />
    </div>
  )
})
