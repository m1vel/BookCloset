import type { Settings } from './types'

export const SETTINGS_VERSION = 1

export function defaultSettings(lang: 'ru' | 'en' = 'ru'): Settings {
  return {
    version: SETTINGS_VERSION,
    lang,
    uiTheme: 'paper',
    reader: {
      flow: 'paginated',
      fontFamily: 'Literata',
      fontSize: 19,
      lineHeight: 1.6,
      gap: 6,
      margin: 56,
      maxWidth: 720,
      columns: 2,
      justify: true,
      hyphenate: true,
      pageTheme: 'auto',
      animated: true,
      overrideBookStyles: false,
      paragraphIndent: true,
      brightness: 1,
    },
    paged: {
      mode: 'scroll',
      fit: 'width',
      zoom: 1,
      rtl: false,
      invertInDark: false,
      coverAlone: true,
    },
    comic: {
      mode: 'single',
      fit: 'page',
      zoom: 1,
      rtl: false,
      invertInDark: false,
      coverAlone: true,
    },
    library: {
      view: 'grid',
      sort: 'recent',
      coverSize: 168,
      copyFiles: true,
      group: 'none',
    },
    goals: { dailyMinutes: 30 },
    tts: { rate: 1, voices: {} },
    autoRead: { speed: 40, pageSeconds: 30, ruler: true, rulerLines: 2 },
    quoteCard: { style: 'paper', format: 'square', font: 'cormorant', showCover: true, showBrand: true },
    schedule: {
      mode: 'off',
      dayTheme: 'paper',
      nightTheme: 'midnight',
      dayPage: 'auto',
      nightPage: 'night',
      dayStart: '07:00',
      nightStart: '21:30',
      warmth: 0.25,
    },
    translation: {
      enabled: true,
      provider: 'free',
      targetLang: lang,
      claudeModel: 'claude-opus-5-5',
      openaiModel: 'gpt-5-mini',
      yandexFolderId: '',
      useContext: true,
      autoWord: false,
    },
  }
}

/** Deep-merges stored settings over defaults so new keys appear after updates. */
export function mergeSettings(stored: any, lang: 'ru' | 'en' = 'ru'): Settings {
  const base = defaultSettings(lang)
  const merge = (a: any, b: any): any => {
    if (!b || typeof b !== 'object' || Array.isArray(b)) return b ?? a
    const out: any = { ...a }
    for (const k of Object.keys(b)) {
      out[k] = a && typeof a[k] === 'object' && !Array.isArray(a[k]) && a[k] !== null
        ? merge(a[k], b[k]) : b[k]
    }
    return out
  }
  const out = merge(base, stored)
  // API keys never live in settings.json (they are kept encrypted by the main process)
  delete (out.translation as any).keys
  // the first build shipped translation disabled while it was a stub
  if (stored?.translation && !('claudeModel' in stored.translation)) out.translation.enabled = true
  return out
}
