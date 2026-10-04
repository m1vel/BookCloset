import { create } from 'zustand'
import type { PageTheme, Settings, UiTheme } from '../../../shared/types'
import { useSettings } from './settings'

/** A clock that ticks every minute and the OS dark-mode flag, for the day/night theme schedule. */
const media = window.matchMedia('(prefers-color-scheme: dark)')
export const useClock = create<{ now: number; systemDark: boolean }>(() => ({ now: Date.now(), systemDark: media.matches }))
setInterval(() => useClock.setState({ now: Date.now() }), 30_000)
media.addEventListener('change', () => useClock.setState({ systemDark: media.matches, now: Date.now() }))

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

export function isNightNow(s: Settings, now: number, systemDark: boolean): boolean | null {
  const sc = s.schedule
  if (sc.mode === 'off') return null
  if (sc.mode === 'system') return systemDark
  const d = new Date(now)
  const cur = d.getHours() * 60 + d.getMinutes()
  const day = minutes(sc.dayStart), night = minutes(sc.nightStart)
  return day < night ? cur < day || cur >= night : cur >= night && cur < day
}

export interface Appearance {
  ui: UiTheme
  page: PageTheme
  /** null when no schedule is active */
  night: boolean | null
  warmth: number
}

export function computeAppearance(s: Settings, now: number, systemDark: boolean): Appearance {
  const night = isNightNow(s, now, systemDark)
  if (night === null) return { ui: s.uiTheme, page: s.reader.pageTheme, night: null, warmth: 0 }
  const sc = s.schedule
  return night
    ? { ui: sc.nightTheme, page: sc.nightPage, night: true, warmth: sc.warmth }
    : { ui: sc.dayTheme, page: sc.dayPage, night: false, warmth: 0 }
}

/** Effective theme for the moment (manual settings, or the day/night schedule). */
export function useAppearance(): Appearance {
  const settings = useSettings(s => s.settings)
  const { now, systemDark } = useClock()
  return computeAppearance(settings, now, systemDark)
}

/** Changing the page colour while a schedule is active edits the current period's choice. */
export function setPageTheme(page: PageTheme) {
  const st = useSettings.getState()
  const { now, systemDark } = useClock.getState()
  const night = isNightNow(st.settings, now, systemDark)
  if (night === null) st.setReader({ pageTheme: page })
  else st.update(s => { if (night) s.schedule.nightPage = page; else s.schedule.dayPage = page })
}
