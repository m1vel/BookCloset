import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { Play, Pause, Minus, Plus, X, Ruler } from '@phosphor-icons/react'
import type { AutoReadPrefs } from '../../../../shared/types'
import type { EngineController, Relocation } from '../../engines/types'
import { useT } from '../../i18n'

export const SPEED_STEPS = [10, 15, 20, 25, 30, 40, 50, 60, 75, 90, 110, 130, 160, 200, 250]
export const PAGE_STEPS = [5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 60, 75, 90, 120, 150, 180]

/** Neighbouring value in a stepped scale (+1 = larger), also from values between steps. */
export function stepValue(steps: number[], value: number, dir: 1 | -1) {
  if (dir > 0) return steps.find(s => s > value) ?? steps[steps.length - 1]
  return [...steps].reverse().find(s => s < value) ?? steps[0]
}

interface AutoReadOptions {
  ctrl: RefObject<EngineController | null>
  relocRef: RefObject<Relocation | null>
  running: boolean
  paused: boolean
  /** scrolled flow / PDF scroll mode rather than pages */
  continuous: boolean
  prefs: AutoReadPrefs
  onActivity: () => void
  onEnd: () => void
}

/**
 * Drives auto-reading: smooth scrolling in continuous layouts (crossing into the next section at
 * an edge), or a page timer in paginated ones. Frame-rate independent; paused while UI is open.
 */
export function useAutoRead(o: AutoReadOptions) {
  const opts = useRef(o)
  opts.current = o
  const elapsed = useRef(0)
  /** share of the current page's timer (paginated); read by the bar and the guided ruler */
  const progress = useRef(0)

  // a manual page turn restarts the page timer
  const lastLocation = useRef<unknown>(null)
  useEffect(() => {
    const id = setInterval(() => {
      const loc = opts.current.relocRef.current?.location
      if (loc !== lastLocation.current) { lastLocation.current = loc; elapsed.current = 0; progress.current = 0 }
    }, 200)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (!o.running || o.paused) return
    let raf = 0
    let last = performance.now()
    let carry = 0
    let edgeLock = 0
    let activityAt = 0
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const { ctrl, prefs, relocRef, continuous } = opts.current
      const c = ctrl.current
      if (c) {
        if (now - activityAt > 5000) { activityAt = now; opts.current.onActivity() }
        if (continuous) {
          carry += prefs.speed * dt
          const px = Math.floor(carry)
          if (px >= 1) {
            carry -= px
            if (c.scrollStep(px) === 'edge' && now > edgeLock) {
              if (relocRef.current?.atEnd || (relocRef.current?.fraction ?? 0) > 0.9995) { opts.current.onEnd(); return }
              edgeLock = now + 1200
              c.next()
            }
          }
        } else {
          // paginated: page timer
          elapsed.current += dt
          const p = elapsed.current / prefs.pageSeconds
          progress.current = Math.min(1, p)
          if (p >= 1) {
            elapsed.current = 0
            if (relocRef.current?.atEnd) { opts.current.onEnd(); return }
            c.next()
          }
        }
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [o.running, o.paused, o.continuous])

  return progress
}

/** Re-renders only this component as a ref-held value changes (rounded to `steps`). */
function useRefValue(ref: RefObject<number>, steps = 100) {
  const [v, setV] = useState(0)
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const n = Math.round((ref.current ?? 0) * steps) / steps
      setV(old => (old === n ? old : n))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [ref, steps])
  return v
}

export function AutoReadBar({ continuous, prefs, paused, manualPause, progressRef, focus, onToggle, onSpeed, onRuler, onClose }: {
  continuous: boolean
  prefs: AutoReadPrefs
  /** paused for any reason (menus, panels…) */
  paused: boolean
  manualPause: boolean
  progressRef: RefObject<number>
  focus: boolean
  onToggle: () => void
  onSpeed: (dir: 1 | -1) => void
  onRuler: () => void
  onClose: () => void
}) {
  const t = useT()
  const progress = useRefValue(progressRef)
  const value = continuous ? t('auto.speed', { n: prefs.speed }) : t('auto.perPage', { n: prefs.pageSeconds })
  // r=11 of 24 at 42px puts the ring just outside the 34px button
  const r = 11, circ = 2 * Math.PI * r
  return (
    <div className={`auto-bar ${paused ? 'paused' : ''}`} role="toolbar" aria-label={t('auto.title')}>
      <button className="auto-play" onClick={onToggle} aria-label={manualPause ? t('auto.resume') : t('auto.pause')} data-tip={`${manualPause ? t('auto.resume') : t('auto.pause')} · Space`}>
        {!continuous && (
          <svg className="auto-ring" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r={r} />
            <circle cx="12" cy="12" r={r} className="fill" style={{ strokeDasharray: circ, strokeDashoffset: circ * (1 - progress) } as CSSProperties} />
          </svg>
        )}
        {manualPause ? <Play size={15} weight="fill" /> : <Pause size={15} weight="fill" />}
      </button>
      <button className="icon-btn sm" onClick={() => onSpeed(-1)} aria-label={t('auto.slower')} data-tip={`${t('auto.slower')} · −`}><Minus size={15} weight="bold" /></button>
      <span className="auto-value tabular" aria-live="polite">{value}</span>
      <button className="icon-btn sm" onClick={() => onSpeed(1)} aria-label={t('auto.faster')} data-tip={`${t('auto.faster')} · +`}><Plus size={15} weight="bold" /></button>
      {focus && (
        <button className={`icon-btn sm ${prefs.ruler ? 'active' : ''}`} onClick={onRuler} aria-pressed={prefs.ruler} aria-label={t('focus.ruler')} data-tip={t('focus.ruler')}>
          <Ruler size={16} />
        </button>
      )}
      <span className="auto-sep" />
      <button className="icon-btn sm" onClick={onClose} aria-label={t('auto.stop')} data-tip={`${t('auto.stop')} · S`}><X size={15} weight="bold" /></button>
    </div>
  )
}

/**
 * Reading ruler: dims everything above and below a band. The band follows the pointer, steps
 * line by line with ↑/↓ ('ruler-step' events), or glides down the page with the auto-read timer.
 */
export function FocusRuler({ stage, height, color, accent, guided, onOverflow }: {
  stage: RefObject<HTMLDivElement | null>
  height: number
  color: string
  accent: string
  /** paginated auto-read progress: the band moves from the top to the bottom of the page */
  guided: RefObject<number> | null
  onOverflow: (dir: 1 | -1) => void
}) {
  const [y, setY] = useRulerPosition(stage, true)
  const bounds = () => {
    const h = stage.current?.clientHeight ?? window.innerHeight
    return [h * 0.09 + height / 2, h * 0.9 - height / 2] as const
  }
  const overflow = useRef(onOverflow)
  overflow.current = onOverflow
  useEffect(() => {
    const onStep = (e: Event) => {
      const dir = (e as CustomEvent<1 | -1>).detail
      const [lo, hi] = bounds()
      setY(cur => {
        const base = cur ?? lo
        const next = base + dir * height * 0.5
        if (next > hi + 1) { overflow.current(1); return lo }
        if (next < lo - 1) { overflow.current(-1); return hi }
        return next
      })
    }
    window.addEventListener('ruler-step', onStep)
    return () => window.removeEventListener('ruler-step', onStep)
  }, [height])
  const g = useRefValue(guided ?? NO_PROGRESS, 400)
  useEffect(() => {
    if (!guided) return
    const [lo, hi] = bounds()
    setY(lo + (hi - lo) * g)
  }, [g, guided])
  if (y == null) return null
  const top = Math.max(0, y - height / 2)
  return (
    <div className="focus-ruler" aria-hidden="true" style={{ '--dim': color, '--ruler-accent': accent } as CSSProperties}>
      <div className="fr-dim top" style={{ height: top }} />
      <div className="fr-band" style={{ top, height }} />
      <div className="fr-dim bottom" style={{ top: top + height }} />
    </div>
  )
}

const NO_PROGRESS = { current: 0 }

/** Tracks the ruler position: follows the pointer over the stage, also across book iframes. */
export function useRulerPosition(stage: RefObject<HTMLDivElement | null>, enabled: boolean) {
  const [y, setY] = useState<number | null>(null)
  useEffect(() => {
    if (!enabled) return
    const at = (clientY: number) => {
      const r = stage.current?.getBoundingClientRect()
      if (r && clientY >= r.top && clientY <= r.bottom) setY(clientY - r.top)
    }
    const a = (e: PointerEvent) => at(e.clientY)
    const b = (e: Event) => at((e as CustomEvent).detail.y)
    window.addEventListener('pointermove', a)
    window.addEventListener('reader-pointer', b)
    return () => { window.removeEventListener('pointermove', a); window.removeEventListener('reader-pointer', b) }
  }, [enabled])
  return [y, setY] as const
}
