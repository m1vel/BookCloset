import {
  type ReactNode, type CSSProperties, useEffect, useLayoutEffect, useRef, useState, forwardRef,
  type ButtonHTMLAttributes,
} from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle, WarningCircle, Info, X } from '@phosphor-icons/react'
import { useUi } from '../store/ui'
import { useT } from '../i18n'

// ---------------------------------------------------------------- IconButton
interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  shortcut?: string
  active?: boolean
  size?: 'sm' | 'md' | 'lg'
}
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, shortcut, active, size = 'md', className = '', children, ...rest }, ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      data-tip={label}
      data-tip-key={shortcut}
      className={`icon-btn ${size !== 'md' ? size : ''} ${active ? 'active' : ''} ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
})

// ---------------------------------------------------------------- Segmented
export function Segmented<T extends string | number>({ value, options, onChange, block, label }: {
  value: T
  options: { value: T; label: ReactNode; title?: string }[]
  onChange: (v: T) => void
  block?: boolean
  label?: string
}) {
  return (
    <div className={`segmented ${block ? 'block' : ''}`} role="radiogroup" aria-label={label}>
      {options.map(o => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? 'on' : ''}
          data-tip={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- Slider
export function Slider({ value, min, max, step = 1, onChange, label, format }: {
  value: number; min: number; max: number; step?: number
  onChange: (v: number) => void; label: string; format?: (v: number) => string
}) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <input
      className="slider"
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      aria-label={label}
      aria-valuetext={format?.(value)}
      style={{ '--pct': `${pct}%` } as CSSProperties}
      onChange={e => onChange(Number(e.target.value))}
    />
  )
}

// ---------------------------------------------------------------- Switch
export function Toggle({ checked, onChange, label, hint }: {
  checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode
}) {
  return (
    <label className="toggle-row" onClick={e => { e.preventDefault(); onChange(!checked) }}>
      <span>
        {label}
        {hint && <div className="faint" style={{ fontSize: 12, fontWeight: 500 }}>{hint}</div>}
      </span>
      <button type="button" role="switch" aria-checked={checked} className={`switch ${checked ? 'on' : ''}`} />
    </label>
  )
}

// ---------------------------------------------------------------- Popover
export type Placement = 'bottom-start' | 'bottom-end' | 'bottom' | 'top' | 'top-start' | 'top-end' | 'right-start' | 'left-start'

export function Popover({ anchor, open, onClose, placement = 'bottom-start', children, className = '', style, offset = 8 }: {
  anchor: HTMLElement | DOMRect | { x: number; y: number } | null
  open: boolean
  onClose: () => void
  placement?: Placement
  children: ReactNode
  className?: string
  style?: CSSProperties
  offset?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; origin: string } | null>(null)

  useLayoutEffect(() => {
    if (!open || !anchor || !ref.current) return
    const r = anchor instanceof HTMLElement ? anchor.getBoundingClientRect()
      : 'width' in anchor ? anchor : new DOMRect(anchor.x, anchor.y, 0, 0)
    const el = ref.current
    const w = el.offsetWidth, h = el.offsetHeight
    const vw = window.innerWidth, vh = window.innerHeight
    let left = r.left, top = r.bottom + offset, origin = 'top left'
    switch (placement) {
      case 'bottom-end': left = r.right - w; origin = 'top right'; break
      case 'bottom': left = r.left + r.width / 2 - w / 2; origin = 'top center'; break
      case 'top': left = r.left + r.width / 2 - w / 2; top = r.top - h - offset; origin = 'bottom center'; break
      case 'top-start': top = r.top - h - offset; origin = 'bottom left'; break
      case 'top-end': left = r.right - w; top = r.top - h - offset; origin = 'bottom right'; break
      case 'right-start': left = r.right + offset; top = r.top; origin = 'top left'; break
      case 'left-start': left = r.left - w - offset; top = r.top; origin = 'top right'; break
    }
    if (top + h > vh - 8 && placement.startsWith('bottom')) top = Math.max(8, r.top - h - offset)
    if (top < 8) top = placement.startsWith('top') ? r.bottom + offset : 8
    left = Math.max(8, Math.min(left, vw - w - 8))
    top = Math.max(8, Math.min(top, vh - h - 8))
    setPos({ left, top, origin })
  }, [open, anchor, placement, offset])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (ref.current?.contains(t)) return
      if (anchor instanceof HTMLElement && anchor.contains(t)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    const onBlur = () => onClose()
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', onBlur)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [open, anchor, onClose])

  if (!open) return null
  return createPortal(
    <div
      ref={ref}
      className={`popover ${className}`}
      style={{ ...style, left: pos?.left ?? -9999, top: pos?.top ?? -9999, '--origin': pos?.origin } as CSSProperties}
      role="dialog"
    >
      {children}
    </div>,
    document.body,
  )
}

export function MenuItem({ icon, children, onClick, danger, checked, disabled }: {
  icon?: ReactNode; children: ReactNode; onClick?: () => void; danger?: boolean; checked?: boolean; disabled?: boolean
}) {
  return (
    <button type="button" className={`menu-item ${danger ? 'danger' : ''}`} onClick={onClick} disabled={disabled}
      style={disabled ? { opacity: .45 } : undefined}>
      {icon}
      <span className="truncate">{children}</span>
      {checked && <CheckCircle className="check" size={16} weight="fill" />}
    </button>
  )
}
export const MenuSep = () => <div className="menu-sep" />

// ---------------------------------------------------------------- Dialogs
export function DialogHost() {
  const t = useT()
  const confirmReq = useUi(s => s.confirmReq)
  const promptReq = useUi(s => s.promptReq)
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (promptReq) {
      setValue(promptReq.value)
      setTimeout(() => inputRef.current?.select(), 30)
    }
  }, [promptReq])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        confirmReq?.resolve(false)
        promptReq?.resolve(null)
      }
    }
    if (confirmReq || promptReq) document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [confirmReq, promptReq])

  if (confirmReq) {
    return createPortal(
      <div className="dialog-backdrop" onPointerDown={e => e.target === e.currentTarget && confirmReq.resolve(false)}>
        <div className="dialog" role="alertdialog" aria-modal="true">
          <h2 className="display">{confirmReq.title}</h2>
          {confirmReq.text && <p>{confirmReq.text}</p>}
          <div className="dialog-actions">
            <button className="btn ghost" onClick={() => confirmReq.resolve(false)}>{t('common.cancel')}</button>
            <button autoFocus className={`btn ${confirmReq.danger ? 'danger' : 'primary'}`} onClick={() => confirmReq.resolve(true)}>
              {confirmReq.confirm}
            </button>
          </div>
        </div>
      </div>,
      document.body,
    )
  }
  if (promptReq) {
    return createPortal(
      <div className="dialog-backdrop" onPointerDown={e => e.target === e.currentTarget && promptReq.resolve(null)}>
        <form className="dialog" role="dialog" aria-modal="true"
          onSubmit={e => { e.preventDefault(); if (value.trim()) promptReq.resolve(value.trim()) }}>
          <h2 className="display">{promptReq.title}</h2>
          <div className="field" style={{ marginTop: 14 }}>
            <label htmlFor="prompt-input">{promptReq.label}</label>
            <input id="prompt-input" ref={inputRef} className="input" value={value} onChange={e => setValue(e.target.value)} />
          </div>
          <div className="dialog-actions">
            <button type="button" className="btn ghost" onClick={() => promptReq.resolve(null)}>{t('common.cancel')}</button>
            <button type="submit" className="btn primary" disabled={!value.trim()}>{promptReq.confirm}</button>
          </div>
        </form>
      </div>,
      document.body,
    )
  }
  return null
}

// ---------------------------------------------------------------- Toasts
export function Toasts() {
  const toasts = useUi(s => s.toasts)
  const dismiss = useUi(s => s.dismiss)
  return createPortal(
    <div className="toasts" aria-live="polite">
      {toasts.map(t => (
        <div key={t.id} className={`toast ${t.kind}`} role="status">
          <span className="t-icon">
            {t.kind === 'success' ? <CheckCircle size={18} weight="fill" />
              : t.kind === 'error' ? <WarningCircle size={18} weight="fill" />
                : t.kind === 'progress' ? <span className="spinner" style={{ width: 16, height: 16 }} />
                  : <Info size={18} weight="fill" />}
          </span>
          <span className="t-text">
            {t.text}
            {t.sub && <div className="t-sub">{t.sub}</div>}
          </span>
          {t.action && <button className="btn sm" onClick={() => { t.action!.run(); dismiss(t.id) }}>{t.action.label}</button>}
          {t.kind !== 'progress' && (
            <button className="icon-btn sm" aria-label="close" onClick={() => dismiss(t.id)}><X size={14} /></button>
          )}
          {t.progress != null && <span className="t-bar" style={{ width: `${Math.round(t.progress * 100)}%` }} />}
        </div>
      ))}
    </div>,
    document.body,
  )
}

// ---------------------------------------------------------------- Tooltips (global, data-tip driven)
export function TooltipLayer() {
  const [tip, setTip] = useState<{ text: string; key?: string; x: number; y: number; below: boolean } | null>(null)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    let current: Element | null = null
    const show = (el: HTMLElement) => {
      const text = el.dataset.tip
      if (!text) return
      const r = el.getBoundingClientRect()
      const below = r.top < 60
      setTip({ text, key: el.dataset.tipKey, x: r.left + r.width / 2, y: below ? r.bottom + 8 : r.top - 8, below })
    }
    const over = (e: PointerEvent) => {
      const el = (e.target as Element)?.closest?.('[data-tip]') as HTMLElement | null
      if (el === current) return
      current = el
      if (timer) clearTimeout(timer)
      setTip(null)
      if (el) timer = setTimeout(() => show(el), 450)
    }
    const hide = () => { if (timer) clearTimeout(timer); current = null; setTip(null) }
    document.addEventListener('pointerover', over)
    document.addEventListener('pointerdown', hide)
    document.addEventListener('wheel', hide, { passive: true })
    window.addEventListener('blur', hide)
    return () => {
      document.removeEventListener('pointerover', over)
      document.removeEventListener('pointerdown', hide)
      document.removeEventListener('wheel', hide)
      window.removeEventListener('blur', hide)
    }
  }, [])
  const ref = useRef<HTMLDivElement>(null)
  const [dx, setDx] = useState(0)
  useLayoutEffect(() => {
    if (!tip || !ref.current) return
    const w = ref.current.offsetWidth
    const left = tip.x - w / 2
    setDx(left < 8 ? 8 - left : left + w > window.innerWidth - 8 ? window.innerWidth - 8 - (left + w) : 0)
  }, [tip])
  if (!tip) return null
  return createPortal(
    <div ref={ref} className="tooltip" style={{
      left: tip.x + dx, top: tip.y,
      transform: `translate(-50%, ${tip.below ? '0' : '-100%'})`,
    }}>
      {tip.text}{tip.key && <span className="kbd">{tip.key}</span>}
    </div>,
    document.body,
  )
}
