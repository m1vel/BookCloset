import type { VocabEntry, VocabSrs } from '../../../shared/types'

export type Grade = 'again' | 'hard' | 'good' | 'easy'
export const GRADES: Grade[] = ['again', 'hard', 'good', 'easy']

const MIN = 60_000
const DAY = 86_400_000

export const newSrs = (now = Date.now()): VocabSrs => ({ due: now, interval: 0, ease: 2.5, reps: 0, lapses: 0 })

/**
 * SM-2 as popularised by Anki: new cards step 1 → 3 days, then grow by the ease factor;
 * "again" relearns in a minute and lowers ease, "hard"/"easy" shrink/stretch the step.
 */
export function schedule(s: VocabSrs, g: Grade, now = Date.now()): VocabSrs {
  const { reps, lapses } = s
  let { interval, ease } = s
  if (g === 'again') {
    return { due: now + MIN, interval: 0, ease: Math.max(1.3, ease - 0.2), reps: 0, lapses: lapses + (reps > 0 ? 1 : 0), last: now }
  }
  if (g === 'hard') {
    ease = Math.max(1.3, ease - 0.15)
    // still learning: see it again in ten minutes
    if (reps === 0) return { ...s, due: now + 10 * MIN, ease, last: now }
    interval = Math.max(1, Math.round(interval * 1.2))
  } else if (g === 'good') {
    interval = reps === 0 ? 1 : reps === 1 ? 3 : Math.max(interval + 1, Math.round(interval * ease))
  } else {
    interval = reps === 0 ? 4 : Math.max(interval + 1, Math.round(interval * ease * 1.3))
    ease += 0.15
  }
  return { due: now + interval * DAY, interval, ease, reps: reps + 1, lapses, last: now }
}

/** Human interval until the next review: "1 мин", "3 д", "2 мес". */
export function formatWait(ms: number, lang: string) {
  const ru = lang === 'ru'
  if (ms < 60 * MIN) return ru ? `${Math.max(1, Math.round(ms / MIN))} мин` : `${Math.max(1, Math.round(ms / MIN))}m`
  // a "1 day" step shows as 1 d, not 24 h
  if (ms < DAY - 30 * MIN) return ru ? `${Math.round(ms / (60 * MIN))} ч` : `${Math.round(ms / (60 * MIN))}h`
  const d = Math.round(ms / DAY)
  if (d < 31) return ru ? `${d} д` : `${d}d`
  const m = Math.round(d / 30)
  if (m < 12) return ru ? `${m} мес` : `${m}mo`
  return ru ? `${(d / 365).toFixed(1)} г` : `${(d / 365).toFixed(1)}y`
}

export const isDue = (e: VocabEntry, now = Date.now()) => e.srs.due <= now
/** a card counts as learned once its interval reaches three weeks */
export const isLearned = (e: VocabEntry) => e.srs.interval >= 21
