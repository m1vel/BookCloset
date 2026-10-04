import type { PageTheme, UiTheme } from '../../../shared/types'

export interface PageThemeDef {
  bg: string
  fg: string
  link: string
  accent: string
  dark: boolean
}

export const PAGE_THEMES: Record<Exclude<PageTheme, 'auto'>, PageThemeDef> = {
  white: { bg: '#ffffff', fg: '#1d1c1a', link: '#2f63b0', accent: '#9f4f1a', dark: false },
  paper: { bg: '#f8f1e3', fg: '#33281c', link: '#9a4a17', accent: '#9f4f1a', dark: false },
  sepia: { bg: '#ecdfc5', fg: '#45351f', link: '#87420f', accent: '#8f4a17', dark: false },
  gray: { bg: '#46484e', fg: '#e3e1dc', link: '#a9c3ff', accent: '#e3ab5d', dark: true },
  night: { bg: '#18191e', fg: '#cfcac1', link: '#e3ab5d', accent: '#e3ab5d', dark: true },
  oled: { bg: '#000000', fg: '#aeaba6', link: '#d9a35a', accent: '#d9a35a', dark: true },
}

export function resolvePageTheme(pt: PageTheme, ui: UiTheme): Exclude<PageTheme, 'auto'> {
  if (pt !== 'auto') return pt
  return ui === 'paper' ? 'paper' : 'night'
}

/** Applies reader chrome tokens to <html> so portaled popovers match the page. */
export function applyReaderChrome(name: Exclude<PageTheme, 'auto'> | null, ui: UiTheme) {
  const root = document.documentElement
  if (!name) {
    delete root.dataset.reader
    delete root.dataset.readerDark
    root.style.removeProperty('--page-bg')
    root.style.removeProperty('--page-fg')
    root.style.removeProperty('--page-accent')
    return
  }
  const t = PAGE_THEMES[name]
  root.dataset.reader = name
  root.dataset.readerDark = t.dark ? '1' : '0'
  root.style.setProperty('--page-bg', t.bg)
  root.style.setProperty('--page-fg', t.fg)
  root.style.setProperty('--page-accent', ui === 'glass' && t.dark ? '#a9bfff' : ui === 'midnight' && t.dark ? '#e3ab5d' : t.accent)
}
