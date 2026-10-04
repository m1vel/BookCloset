import { Sun, Moon } from '@phosphor-icons/react'
import type { PageTheme, UiTheme } from '../../../shared/types'
import { useSettings } from '../store/settings'
import { useAppearance } from '../store/appearance'
import { useT, type TKey } from '../i18n'
import { Segmented, Slider } from '../components/ui'
import { PAGE_THEMES, resolvePageTheme } from '../engines/page-themes'

const THEMES: UiTheme[] = ['paper', 'midnight', 'glass']
const PAGES: PageTheme[] = ['auto', 'white', 'paper', 'sepia', 'gray', 'night', 'oled']

function Period({ night }: { night: boolean }) {
  const t = useT()
  const sc = useSettings(s => s.settings.schedule)
  const update = useSettings(s => s.update)
  const theme = night ? sc.nightTheme : sc.dayTheme
  const page = night ? sc.nightPage : sc.dayPage
  return (
    <div className={`period ${night ? 'is-night' : ''}`}>
      <div className="period-head">
        {night ? <Moon size={16} weight="fill" /> : <Sun size={16} weight="fill" />}
        <b>{t(night ? 'set.night' : 'set.day')}</b>
        {sc.mode === 'time' && (
          <input type="time" className="input time" value={night ? sc.nightStart : sc.dayStart}
            onChange={e => update(s => { if (night) s.schedule.nightStart = e.target.value; else s.schedule.dayStart = e.target.value })} />
        )}
      </div>
      <Segmented block value={theme} onChange={v => update(s => { if (night) s.schedule.nightTheme = v; else s.schedule.dayTheme = v })}
        options={THEMES.map(th => ({ value: th, label: t(`set.theme.${th}` as TKey) }))} />
      <div className="swatches small">
        {PAGES.map(p => {
          const def = PAGE_THEMES[resolvePageTheme(p, theme)]
          return (
            <button key={p} className={`swatch ${page === p ? 'on' : ''} ${p === 'auto' ? 'auto' : ''}`} data-tip={t(`page.${p}` as TKey)}
              style={{ background: def.bg, color: def.fg }}
              onClick={() => update(s => { if (night) s.schedule.nightPage = p; else s.schedule.dayPage = p })}>Aa</button>
          )
        })}
      </div>
    </div>
  )
}

export function ScheduleSettings() {
  const t = useT()
  const sc = useSettings(s => s.settings.schedule)
  const update = useSettings(s => s.update)
  const { night } = useAppearance()
  return (
    <div className="schedule">
      <div className="set-row">
        <div>
          <div className="set-label">{t('set.schedule')}</div>
          {night !== null && <div className="set-note">{t(night ? 'set.scheduleNight' : 'set.scheduleDay')}</div>}
        </div>
        <Segmented value={sc.mode} onChange={v => update(s => { s.schedule.mode = v })} options={[
          { value: 'off', label: t('set.schedule.off') },
          { value: 'time', label: t('set.schedule.time') },
          { value: 'system', label: t('set.schedule.system') },
        ]} />
      </div>
      {sc.mode !== 'off' && (
        <>
          <div className="periods">
            <Period night={false} />
            <Period night />
          </div>
          <div className="set-row">
            <div className="set-label">{t('set.warmth')}</div>
            <div style={{ width: 260, display: 'flex', gap: 12, alignItems: 'center' }}>
              <Slider label={t('set.warmth')} min={0} max={0.6} step={0.05} value={sc.warmth} onChange={v => update(s => { s.schedule.warmth = v })} />
              <span className="ap-value tabular">{Math.round(sc.warmth * 100)}%</span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
