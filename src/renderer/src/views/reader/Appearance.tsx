import { Minus, Plus, TextAa, ArrowCounterClockwise, Check } from '@phosphor-icons/react'
import type { PageTheme, PagedPrefs } from '../../../../shared/types'
import { defaultSettings } from '../../../../shared/defaults'
import { useSettings } from '../../store/settings'
import { useT, type TKey } from '../../i18n'
import { Segmented, Slider, Toggle } from '../../components/ui'
import { READING_FONTS } from '../../styles/fonts'
import { PAGE_THEMES, resolvePageTheme } from '../../engines/page-themes'
import { useAppearance, setPageTheme } from '../../store/appearance'

const THEMES: PageTheme[] = ['auto', 'white', 'paper', 'sepia', 'gray', 'night', 'oled']

/** Autoscroll speed / page time and the focus ruler; shared by both appearance popovers. */
function AutoReadSection({ continuous }: { continuous: boolean }) {
  const t = useT()
  const a = useSettings(s => s.settings.autoRead)
  const update = useSettings(s => s.update)
  return (
    <section className="ap-sliders ap-auto">
      <div className="ap-label eyebrow">{t('auto.settings')}</div>
      {continuous ? (
        <>
          <div className="ap-row">
            <span className="ap-label">{t('auto.speedLabel')}</span>
            <span className="ap-value tabular">{t('auto.speed', { n: a.speed })}</span>
          </div>
          <Slider label={t('auto.speedLabel')} min={10} max={250} step={5} value={a.speed} onChange={v => update(s => { s.autoRead.speed = v })} />
        </>
      ) : (
        <>
          <div className="ap-row">
            <span className="ap-label">{t('auto.pageLabel')}</span>
            <span className="ap-value tabular">{t('auto.perPage', { n: a.pageSeconds })}</span>
          </div>
          <Slider label={t('auto.pageLabel')} min={5} max={180} step={5} value={a.pageSeconds} onChange={v => update(s => { s.autoRead.pageSeconds = v })} />
        </>
      )}
      <Toggle label={t('focus.ruler')} checked={a.ruler} onChange={v => update(s => { s.autoRead.ruler = v })} />
      {a.ruler && (
        <div className="ap-row">
          <span className="ap-label">{t('focus.rulerLines')}</span>
          <Segmented value={a.rulerLines} onChange={v => update(s => { s.autoRead.rulerLines = v })}
            options={[1, 2, 3, 4].map(n => ({ value: n, label: String(n) }))} />
        </div>
      )}
    </section>
  )
}

function PageThemePicker() {
  const t = useT()
  const { page: pageTheme, ui } = useAppearance()
  return (
    <div className="swatches" role="radiogroup" aria-label={t('type.theme')}>
      {THEMES.map(name => {
        const def = PAGE_THEMES[resolvePageTheme(name, ui)]
        return (
          <button key={name} role="radio" aria-checked={pageTheme === name}
            className={`swatch ${pageTheme === name ? 'on' : ''} ${name === 'auto' ? 'auto' : ''}`}
            data-tip={t(`page.${name}` as TKey)}
            style={{ background: def.bg, color: def.fg }}
            onClick={() => setPageTheme(name)}>
            {pageTheme === name ? <Check size={14} weight="bold" /> : <span>Aa</span>}
          </button>
        )
      })}
    </div>
  )
}

export function ReflowAppearance() {
  const t = useT()
  const r = useSettings(s => s.settings.reader)
  const setReader = useSettings(s => s.setReader)
  return (
    <div className="appearance">
      <section>
        <div className="ap-label">{t('type.theme')}</div>
        <PageThemePicker />
      </section>
      <section>
        <div className="ap-label">{t('type.font')}</div>
        <div className="font-grid">
          {READING_FONTS.map(f => (
            <button key={f.id} className={`font-chip ${r.fontFamily === f.id ? 'on' : ''}`}
              style={{ fontFamily: f.family || 'inherit' }}
              onClick={() => setReader({ fontFamily: f.id })}>
              <span className="font-sample">{f.id === 'original' ? <TextAa size={18} /> : 'Аа'}</span>
              <span className="font-name">{f.id === 'original' ? t('type.original') : f.label}</span>
            </button>
          ))}
        </div>
      </section>
      <section className="ap-sliders">
        <div className="ap-row">
          <span className="ap-label">{t('type.size')}</span>
          <span className="ap-value tabular">{r.fontSize}px</span>
        </div>
        <div className="slider-row">
          <button className="icon-btn sm" aria-label="-" onClick={() => setReader({ fontSize: Math.max(12, r.fontSize - 1) })}><Minus size={14} weight="bold" /></button>
          <Slider label={t('type.size')} min={12} max={34} value={r.fontSize} onChange={v => setReader({ fontSize: v })} />
          <button className="icon-btn sm" aria-label="+" onClick={() => setReader({ fontSize: Math.min(34, r.fontSize + 1) })}><Plus size={14} weight="bold" /></button>
        </div>
        <div className="ap-row">
          <span className="ap-label">{t('type.lineHeight')}</span>
          <span className="ap-value tabular">{r.lineHeight.toFixed(2)}</span>
        </div>
        <Slider label={t('type.lineHeight')} min={1.1} max={2.3} step={0.05} value={r.lineHeight} onChange={v => setReader({ lineHeight: v })} />
        <div className="ap-row">
          <span className="ap-label">{t('type.margins')}</span>
          <span className="ap-value tabular">{r.gap}%</span>
        </div>
        <Slider label={t('type.margins')} min={2} max={16} step={0.5} value={r.gap} onChange={v => setReader({ gap: v })} />
        <div className="ap-row">
          <span className="ap-label">{t('type.width')}</span>
          <span className="ap-value tabular">{r.maxWidth}px</span>
        </div>
        <Slider label={t('type.width')} min={440} max={1200} step={20} value={r.maxWidth} onChange={v => setReader({ maxWidth: v })} />
      </section>
      <section className="ap-two">
        <div>
          <div className="ap-label">{t('type.layout')}</div>
          <Segmented block value={r.flow} onChange={v => setReader({ flow: v })} options={[
            { value: 'paginated', label: t('type.paginated') }, { value: 'scrolled', label: t('type.scrolled') },
          ]} />
        </div>
        <div>
          <div className="ap-label">{t('type.columns')}</div>
          <Segmented block value={r.columns} onChange={v => setReader({ columns: v })} options={[
            { value: 1, label: t('type.columns1') }, { value: 2, label: t('type.columns2') },
          ]} />
        </div>
      </section>
      <section className="ap-toggles">
        <Toggle label={t('type.justify')} checked={r.justify} onChange={v => setReader({ justify: v })} />
        <Toggle label={t('type.hyphenate')} checked={r.hyphenate} onChange={v => setReader({ hyphenate: v })} />
        <Toggle label={t('type.indent')} checked={r.paragraphIndent} onChange={v => setReader({ paragraphIndent: v })} />
        <Toggle label={t('type.override')} checked={r.overrideBookStyles} onChange={v => setReader({ overrideBookStyles: v })} />
        <Toggle label={t('type.animation')} checked={r.animated} onChange={v => setReader({ animated: v })} />
      </section>
      <AutoReadSection continuous={r.flow === 'scrolled'} />
      <button className="btn ghost sm ap-reset" onClick={() => {
        const d = defaultSettings().reader
        setReader({ ...d, pageTheme: r.pageTheme })
      }}><ArrowCounterClockwise size={14} /> {t('type.reset')}</button>
    </div>
  )
}

export function PagedAppearance({ prefs: p, setPrefs: setPaged }: { prefs: PagedPrefs; setPrefs: (p: Partial<PagedPrefs>) => void }) {
  const t = useT()
  return (
    <div className="appearance">
      <section>
        <div className="ap-label">{t('type.theme')}</div>
        <PageThemePicker />
      </section>
      <section>
        <div className="ap-label">{t('type.layout')}</div>
        <Segmented block value={p.mode} onChange={v => setPaged({ mode: v })} options={[
          { value: 'single', label: t('paged.single') },
          { value: 'spread', label: t('paged.spread') },
          { value: 'scroll', label: t('paged.scroll') },
        ]} />
      </section>
      <section>
        <div className="ap-row">
          <Segmented value={p.fit} onChange={v => setPaged({ fit: v })} options={[
            { value: 'width', label: t('paged.fitWidth') },
            { value: 'page', label: t('paged.fitPage') },
            { value: 'custom', label: `${Math.round(p.zoom * 100)}%` },
          ]} />
          <div className="zoom-btns">
            <button className="icon-btn sm" aria-label={t('paged.zoomOut')} data-tip={t('paged.zoomOut')}
              onClick={() => setPaged({ fit: 'custom', zoom: Math.max(0.2, +(p.zoom / 1.15).toFixed(2)) })}><Minus size={14} weight="bold" /></button>
            <button className="icon-btn sm" aria-label={t('paged.zoomIn')} data-tip={t('paged.zoomIn')}
              onClick={() => setPaged({ fit: 'custom', zoom: Math.min(6, +(p.zoom * 1.15).toFixed(2)) })}><Plus size={14} weight="bold" /></button>
          </div>
        </div>
      </section>
      <section className="ap-toggles">
        <Toggle label={t('paged.rtl')} checked={p.rtl} onChange={v => setPaged({ rtl: v })} />
        <Toggle label={t('paged.coverAlone')} checked={p.coverAlone} onChange={v => setPaged({ coverAlone: v })} />
        <Toggle label={t('paged.invert')} checked={p.invertInDark} onChange={v => setPaged({ invertInDark: v })} />
      </section>
      <AutoReadSection continuous={p.mode === 'scroll'} />
    </div>
  )
}
