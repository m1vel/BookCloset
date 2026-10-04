import { useEffect, useMemo, useRef, useState } from 'react'
import { Fire, Clock, BookOpen, Lightning, Timer, CalendarCheck, Target, ChartBar } from '@phosphor-icons/react'
import type { ReadingSession } from '../../../shared/types'
import { bc } from '../api'
import { useLibrary } from '../store/library'
import { useSettings } from '../store/settings'
import { useT, formatDuration } from '../i18n'
import { Cover } from '../components/Cover'
import { Slider } from '../components/ui'
import { openBookById } from './open'

const DAY = 86_400_000
const dayKey = (ts: number) => {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const startOfDay = (ts: number) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime() }

interface Tip { x: number; y: number; value: string; label: string }

function useStats() {
  const [sessions, setSessions] = useState<ReadingSession[] | null>(null)
  useEffect(() => { bc.stats.get().then(s => setSessions(s.sessions)) }, [])
  return sessions
}

export default function StatsView() {
  const t = useT()
  const lang = useSettings(s => s.settings.lang)
  const goal = useSettings(s => s.settings.goals.dailyMinutes)
  const update = useSettings(s => s.update)
  const books = useLibrary(s => s.books)
  const sessions = useStats()
  const locale = lang === 'ru' ? 'ru-RU' : 'en-US'

  const data = useMemo(() => {
    if (!sessions) return null
    const byDay = new Map<string, number>()
    const byBook = new Map<string, number>()
    let total = 0, pages = 0
    for (const s of sessions) {
      byDay.set(dayKey(s.start), (byDay.get(dayKey(s.start)) ?? 0) + s.seconds)
      byBook.set(s.bookId, (byBook.get(s.bookId) ?? 0) + s.seconds)
      total += s.seconds
      pages += s.pages
    }
    const today = startOfDay(Date.now())
    const todaySec = byDay.get(dayKey(today)) ?? 0
    let week = 0
    for (let i = 0; i < 7; i++) week += byDay.get(dayKey(today - i * DAY)) ?? 0
    // streak: consecutive days with ≥ 1 minute, counting from today (or yesterday if today is empty)
    let streak = 0
    let d = (byDay.get(dayKey(today)) ?? 0) >= 60 ? today : today - DAY
    while ((byDay.get(dayKey(d)) ?? 0) >= 60) { streak++; d -= DAY }
    const last30 = Array.from({ length: 30 }, (_, i) => {
      const ts = today - (29 - i) * DAY
      return { ts, minutes: Math.round((byDay.get(dayKey(ts)) ?? 0) / 60) }
    })
    const top = [...byBook.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([id, sec]) => ({ book: books.find(b => b.id === id), sec })).filter(x => x.book)
    return {
      byDay, todaySec, week, streak, total, last30, top,
      finished: books.filter(b => b.status === 'finished').length,
      speed: total > 600 ? Math.round(pages / (total / 3600)) : null,
      avgSession: sessions.length ? total / sessions.length : 0,
      count: sessions.length,
    }
  }, [sessions, books])

  if (!data) return <div className="stats" />
  const goalPct = Math.min(1, data.todaySec / 60 / Math.max(1, goal))

  return (
    <div className="stats">
      <header className="lib-header drag-region">
        <div className="lib-title">
          <span className="eyebrow">{t('nav.stats')}</span>
          <h1 className="display">{t('stats.title')}</h1>
        </div>
      </header>
      <div className="lib-scroll">
        {!data.count ? (
          <div className="empty rise-in">
            <ChartBar size={44} weight="duotone" />
            <h3 className="display">{t('stats.empty')}</h3>
          </div>
        ) : (
          <div className="stats-grid rise-in">
            <section className="card stat-hero">
              <GoalRing pct={goalPct} />
              <div className="hero-figure">
                <span className="stat-label">{t('stats.today')}</span>
                <span className="hero-value">{Math.round(data.todaySec / 60)}<small> {t('common.min')}</small></span>
                <span className="stat-sub">{goalPct >= 1 ? t('stats.goalDone') : t('stats.goalOf', { n: goal })}</span>
                <div className="goal-edit">
                  <Target size={14} />
                  <span>{t('set.goal')}: <b>{goal} {t('common.min')}</b></span>
                </div>
                <Slider label={t('set.goal')} min={5} max={180} step={5} value={goal}
                  onChange={v => update(s => { s.goals.dailyMinutes = v })} />
              </div>
            </section>

            <div className="kpis">
              <Kpi icon={<CalendarCheck size={18} />} label={t('stats.week')} value={formatDuration(data.week, lang)} />
              <Kpi icon={<Fire size={18} />} label={t('stats.streak')} value={t('stats.streakDays', { n: data.streak })} />
              <Kpi icon={<BookOpen size={18} />} label={t('stats.finished')} value={String(data.finished)} />
              <Kpi icon={<Clock size={18} />} label={t('stats.total')} value={formatDuration(data.total, lang)} />
              <Kpi icon={<Lightning size={18} />} label={t('stats.speed')} value={data.speed != null ? `${data.speed} ${t('stats.pagesPerHour')}` : '—'} />
              <Kpi icon={<Timer size={18} />} label={t('stats.avgSession')} value={formatDuration(data.avgSession, lang)} />
            </div>

            <section className="card chart-card wide">
              <div className="card-head">
                <h2 className="display">{t('stats.last30')}</h2>
                <span className="faint">{t('stats.minutes')}</span>
              </div>
              <BarChart days={data.last30} goal={goal} locale={locale} />
            </section>

            <section className="card chart-card wide">
              <div className="card-head">
                <h2 className="display">{t('stats.calendar')}</h2>
              </div>
              <Heatmap byDay={data.byDay} locale={locale} lang={lang} />
            </section>

            {data.top.length > 0 && (
              <section className="card chart-card wide">
                <div className="card-head"><h2 className="display">{t('stats.topBooks')}</h2></div>
                <div className="top-books">
                  {data.top.map(({ book, sec }) => (
                    <button key={book!.id} className="top-row" onClick={() => openBookById(book!.id)}>
                      <Cover book={book!} className="top-cover" />
                      <div className="top-main">
                        <div className="top-title truncate">{book!.title}</div>
                        <div className="top-bar"><i style={{ width: `${(sec / data.top[0].sec) * 100}%` }} /></div>
                      </div>
                      <span className="top-val">{formatDuration(sec, lang)}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Kpi({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="card kpi">
      <span className="kpi-icon">{icon}</span>
      <span className="stat-label">{label}</span>
      <span className="kpi-value">{value}</span>
    </div>
  )
}

/** Daily goal meter: accent fill on a lighter step of the same hue. */
function GoalRing({ pct }: { pct: number }) {
  const r = 52, c = 2 * Math.PI * r
  return (
    <svg className="goal-ring" viewBox="0 0 128 128" role="img" aria-label={`${Math.round(pct * 100)}%`}>
      <circle cx="64" cy="64" r={r} className="ring-track" />
      <circle cx="64" cy="64" r={r} className="ring-fill" strokeDasharray={`${c * pct} ${c}`} transform="rotate(-90 64 64)" />
      <text x="64" y="70" textAnchor="middle" className="ring-text">{Math.round(pct * 100)}%</text>
    </svg>
  )
}

function niceMax(v: number) {
  if (v <= 10) return 10
  const steps = [15, 20, 30, 45, 60, 90, 120, 180, 240, 300, 480, 600]
  return steps.find(s => s >= v) ?? Math.ceil(v / 60) * 60
}

/** 30-day column chart (single series → no legend; the title names it). */
function BarChart({ days, goal, locale }: { days: { ts: number; minutes: number }[]; goal: number; locale: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(800)
  const [tip, setTip] = useState<Tip | null>(null)
  useEffect(() => {
    const ro = new ResizeObserver(() => setW(ref.current?.clientWidth ?? 800))
    ro.observe(ref.current!)
    return () => ro.disconnect()
  }, [])
  const H = 210, padL = 34, padB = 26, padT = 10
  const max = niceMax(Math.max(goal, ...days.map(d => d.minutes)))
  const plotW = w - padL - 6, plotH = H - padB - padT
  const band = plotW / days.length
  const barW = Math.min(24, band - 2)
  const y = (v: number) => padT + plotH - (v / max) * plotH
  const ticks = [0, max / 2, max].map(v => Math.round(v))
  const fmt = (ts: number) => new Date(ts).toLocaleDateString(locale, { day: 'numeric', month: 'short' })
  return (
    <div ref={ref} className="chart" onPointerLeave={() => setTip(null)}>
      <svg width={w} height={H} role="img" aria-label="minutes per day">
        {ticks.map(v => (
          <g key={v}>
            <line x1={padL} x2={w - 4} y1={y(v)} y2={y(v)} className="grid" />
            <text x={padL - 8} y={y(v) + 4} textAnchor="end" className="axis">{v}</text>
          </g>
        ))}
        <line x1={padL} x2={w - 4} y1={y(goal)} y2={y(goal)} className="goal-line" />
        {days.map((d, i) => {
          const x = padL + i * band + (band - barW) / 2
          const h = Math.max(0, (d.minutes / max) * plotH)
          const top = y(d.minutes)
          const rr = Math.min(4, h)
          const path = h > 0
            ? `M${x},${padT + plotH} V${top + rr} Q${x},${top} ${x + rr},${top} H${x + barW - rr} Q${x + barW},${top} ${x + barW},${top + rr} V${padT + plotH} Z`
            : ''
          return (
            <g key={d.ts}>
              {path && <path d={path} className={`bar ${d.minutes >= goal ? 'met' : ''} ${tip?.label === fmt(d.ts) ? 'hover' : ''}`} />}
              <rect x={padL + i * band} y={padT} width={band} height={plotH} fill="transparent" tabIndex={0}
                aria-label={`${fmt(d.ts)}: ${d.minutes}`}
                onPointerMove={() => setTip({ x: padL + i * band + band / 2, y: top, value: `${d.minutes}`, label: fmt(d.ts) })}
                onFocus={() => setTip({ x: padL + i * band + band / 2, y: top, value: `${d.minutes}`, label: fmt(d.ts) })} />
              {(i % 5 === 4 || i === days.length - 1) && (
                <text x={padL + i * band + band / 2} y={H - 6} textAnchor="middle" className="axis">{fmt(d.ts)}</text>
              )}
            </g>
          )
        })}
      </svg>
      {tip && (
        <div className="chart-tip" style={{ left: tip.x, top: tip.y }}>
          <b>{tip.value}</b> <span>min</span>
          <div className="faint">{tip.label}</div>
        </div>
      )}
      <table className="sr-only">
        <tbody>{days.map(d => <tr key={d.ts}><td>{fmt(d.ts)}</td><td>{d.minutes}</td></tr>)}</tbody>
      </table>
    </div>
  )
}

/** Calendar heatmap: sequential single-hue ramp (empty → light → dark). */
function Heatmap({ byDay, locale, lang }: { byDay: Map<string, number>; locale: string; lang: 'ru' | 'en' }) {
  const t = useT()
  const [tip, setTip] = useState<Tip | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(600)
  useEffect(() => {
    const ro = new ResizeObserver(() => setWidth(ref.current?.clientWidth ?? 600))
    ro.observe(ref.current!)
    return () => ro.disconnect()
  }, [])
  const cell = Math.max(12, Math.min(16, Math.floor((width - 30) / 53) - 3)), gap = 3
  const weeks = Math.max(12, Math.min(53, Math.floor((width - 34) / (cell + gap))))
  const today = startOfDay(Date.now())
  // Monday-first grid ending with the current week
  const dow = (new Date(today).getDay() + 6) % 7
  const start = today - (dow + (weeks - 1) * 7) * DAY
  const level = (sec: number) => (sec < 60 ? 0 : sec < 15 * 60 ? 1 : sec < 30 * 60 ? 2 : sec < 60 * 60 ? 3 : 4)
  const cells: { x: number; y: number; ts: number; sec: number }[] = []
  for (let wk = 0; wk < weeks; wk++) for (let d = 0; d < 7; d++) {
    const ts = start + (wk * 7 + d) * DAY
    if (ts > today) continue
    cells.push({ x: wk, y: d, ts, sec: byDay.get(dayKey(ts)) ?? 0 })
  }
  const months: { x: number; label: string }[] = []
  let lastMonth = -1
  for (let wk = 0; wk < weeks; wk++) {
    const m = new Date(start + wk * 7 * DAY).getMonth()
    if (m !== lastMonth) { months.push({ x: wk, label: new Date(start + wk * 7 * DAY).toLocaleDateString(locale, { month: 'short' }) }); lastMonth = m }
  }
  const dayNames = lang === 'ru' ? ['Пн', '', 'Ср', '', 'Пт', '', ''] : ['Mon', '', 'Wed', '', 'Fri', '', '']
  const W = 30 + weeks * (cell + gap), H = 20 + 7 * (cell + gap)
  return (
    <div ref={ref} className="chart heatmap" onPointerLeave={() => setTip(null)}>
      <svg width={W} height={H} role="img" aria-label={t('stats.calendar')}>
        {months.map(m => <text key={m.x} x={30 + m.x * (cell + gap)} y={11} className="axis">{m.label}</text>)}
        {dayNames.map((n, i) => n && <text key={i} x={0} y={20 + i * (cell + gap) + 11} className="axis">{n}</text>)}
        {cells.map(c => (
          <rect key={c.ts} x={30 + c.x * (cell + gap)} y={20 + c.y * (cell + gap)} width={cell} height={cell} rx={3}
            className={`hm l${level(c.sec)} ${c.ts === today ? 'today' : ''}`} tabIndex={0}
            aria-label={`${new Date(c.ts).toLocaleDateString(locale)}: ${Math.round(c.sec / 60)}`}
            onPointerMove={() => setTip({ x: 30 + c.x * (cell + gap) + cell / 2, y: 20 + c.y * (cell + gap), value: `${Math.round(c.sec / 60)}`, label: new Date(c.ts).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'long' }) })} />
        ))}
      </svg>
      <div className="hm-legend">
        <span>{t('stats.less')}</span>
        {[0, 1, 2, 3, 4].map(l => <i key={l} className={`hm-key l${l}`} />)}
        <span>{t('stats.more')}</span>
      </div>
      {tip && (
        <div className="chart-tip" style={{ left: tip.x, top: tip.y }}>
          <b>{tip.value}</b> <span>min</span>
          <div className="faint">{tip.label}</div>
        </div>
      )}
    </div>
  )
}
