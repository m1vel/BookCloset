import { ru, type Dict } from './ru'
import { en } from './en'
import { useSettings } from '../store/settings'
import type { Lang } from '../../../shared/types'

const dicts: Record<Lang, Dict> = { ru, en }
export type TKey = keyof Dict

/** Plural rule helper: "{n|книга|книги|книг}" (ru: one/few/many) or "{n|book|books}" (en). */
function plural(lang: Lang, n: number, forms: string[]) {
  if (lang === 'ru') {
    const n10 = n % 10, n100 = n % 100
    if (n10 === 1 && n100 !== 11) return forms[0]
    if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return forms[1] ?? forms[0]
    return forms[2] ?? forms[1] ?? forms[0]
  }
  return n === 1 ? forms[0] : forms[1] ?? forms[0]
}

export function translate(lang: Lang, key: TKey, params?: Record<string, string | number>) {
  let s: string = dicts[lang][key] ?? dicts.en[key] ?? key
  if (params) {
    s = s.replace(/\{(\w+)\|([^}]+)\}/g, (_, k, forms) => plural(lang, Number(params[k]), forms.split('|')))
    s = s.replace(/\{(\w+)\}/g, (_, k) => (params[k] ?? '').toString())
  }
  return s
}

export function useT() {
  const lang = useSettings(s => s.settings.lang)
  return (key: TKey, params?: Record<string, string | number>) => translate(lang, key, params)
}

export const tNow = (key: TKey, params?: Record<string, string | number>) =>
  translate(useSettings.getState().settings.lang, key, params)

export function formatDuration(seconds: number, lang: Lang): string {
  const m = Math.round(seconds / 60)
  if (m < 1) return translate(lang, 'reader.lessMin')
  const h = Math.floor(m / 60)
  const mm = m % 60
  const H = translate(lang, 'common.h'), M = translate(lang, 'common.min')
  if (h === 0) return `${m} ${M}`
  return mm ? `${h} ${H} ${mm} ${M}` : `${h} ${H}`
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function formatDate(ts: number, lang: Lang) {
  return new Date(ts).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric' })
}
