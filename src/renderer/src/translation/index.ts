/**
 * Selection translation: the reader selects text → "Translate" → the source language is detected
 * automatically → translated into the language chosen in the popup (default from settings).
 * Network calls and API keys live in the main process (src/main/translate.ts).
 */
import type { TranslateResponse, TranslationProviderId, TranslationSettings } from '../../../shared/types'
import { bc } from '../api'

export interface ProviderInfo {
  id: TranslationProviderId
  name: string
  needsKey: boolean
  /** uses the surrounding paragraph and book title */
  contextAware: boolean
  keyUrl?: string
  keyHint?: string
}

export const PROVIDERS: ProviderInfo[] = [
  { id: 'free', name: 'Google Translate', needsKey: false, contextAware: false },
  { id: 'deepl', name: 'DeepL', needsKey: true, contextAware: true, keyUrl: 'https://www.deepl.com/your-account/keys', keyHint: 'xxxxxxxx-…:fx' },
  { id: 'yandex', name: 'Yandex Translate', needsKey: true, contextAware: false, keyUrl: 'https://yandex.cloud/ru/docs/translate/quickstart', keyHint: 'AQVN…' },
  { id: 'claude', name: 'Claude (Anthropic)', needsKey: true, contextAware: true, keyUrl: 'https://platform.claude.com/settings/keys', keyHint: 'sk-ant-…' },
  { id: 'openai', name: 'OpenAI', needsKey: true, contextAware: true, keyUrl: 'https://platform.openai.com/api-keys', keyHint: 'sk-…' },
]

export const CLAUDE_MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
]

export const TRANSLATION_READY = true

export const TARGET_LANGS = ['ru', 'en', 'uk', 'de', 'fr', 'es', 'it', 'pt', 'pl', 'cs', 'nl', 'sv', 'fi', 'tr', 'el', 'bg', 'sr', 'be', 'kk', 'zh', 'ja', 'ko', 'ar', 'he', 'hi']

const displayNames = new Map<string, Intl.DisplayNames>()
/** Language name in the interface language, capitalised ("английский" → "Английский"). */
export function langName(code: string | undefined, ui: string): string {
  if (!code) return '—'
  try {
    if (!displayNames.has(ui)) displayNames.set(ui, new Intl.DisplayNames([ui], { type: 'language' }))
    const n = displayNames.get(ui)!.of(code) ?? code
    return n.charAt(0).toLocaleUpperCase(ui) + n.slice(1)
  } catch {
    return code
  }
}

// ---------------------------------------------------------------- local language detection
const STOP: Record<string, string[]> = {
  en: ['the', 'and', 'of', 'to', 'is', 'was', 'that', 'it', 'with', 'for', 'you', 'not', 'she', 'he', 'her', 'had', 'have'],
  de: ['der', 'die', 'und', 'das', 'ist', 'nicht', 'ich', 'sie', 'mit', 'ein', 'eine', 'auf', 'den', 'zu', 'es'],
  fr: ['le', 'la', 'les', 'et', 'est', 'une', 'des', 'que', 'pas', 'dans', 'il', 'elle', 'pour', 'qui', 'du'],
  es: ['el', 'la', 'los', 'las', 'que', 'y', 'es', 'una', 'por', 'con', 'para', 'del', 'no', 'se', 'su'],
  it: ['il', 'la', 'che', 'e', 'di', 'un', 'una', 'non', 'per', 'con', 'sono', 'gli', 'della', 'del'],
  pt: ['o', 'a', 'os', 'que', 'e', 'de', 'um', 'uma', 'não', 'com', 'para', 'por', 'do', 'da', 'se'],
  pl: ['i', 'w', 'nie', 'się', 'na', 'to', 'że', 'jest', 'z', 'do', 'jak', 'ale', 'co', 'tak'],
  nl: ['de', 'het', 'een', 'en', 'van', 'is', 'niet', 'dat', 'op', 'te', 'zijn', 'met', 'voor'],
}

/** Best-effort detection by script and stop-words; providers report the definitive language. */
export function detectLanguage(text: string): string | undefined {
  const s = text.slice(0, 2000)
  const count = (re: RegExp) => (s.match(re) ?? []).length
  const cyr = count(/[Ѐ-ӿ]/g)
  const lat = count(/[A-Za-zÀ-ÿĀ-ž]/g)
  const kana = count(/[\u3040-ヿ]/g)
  const han = count(/[一-鿿]/g)
  const hangul = count(/[가-\uD7AF]/g)
  const scripts: [string, number][] = [
    ['cyr', cyr], ['lat', lat], ['ja', kana * 3 + (kana ? han : 0)], ['zh', kana ? 0 : han], ['ko', hangul],
    ['ar', count(/[\u0600-ۿ]/g)], ['he', count(/[\u0590-\u05FF]/g)], ['el', count(/[Ͱ-Ͽ]/g)],
    ['hi', count(/[ऀ-ॿ]/g)], ['th', count(/[\u0E00-\u0E7F]/g)],
  ]
  scripts.sort((a, b) => b[1] - a[1])
  const [top, n] = scripts[0]
  if (!n) return undefined
  if (top === 'cyr') {
    if (/[іїєґ]/i.test(s)) return 'uk'
    if (/[ў]/i.test(s)) return 'be'
    if (/[әғқңөұүһі]/i.test(s)) return 'kk'
    if (/[ђћџљњ]/i.test(s)) return 'sr'
    return 'ru'
  }
  if (top !== 'lat') return top
  const words = s.toLowerCase().match(/[a-zà-ÿā-ž']+/g) ?? []
  let best = 'en', bestScore = 0
  for (const [lang, list] of Object.entries(STOP)) {
    const set = new Set(list)
    const score = words.filter(w => set.has(w)).length
    if (score > bestScore) { best = lang; bestScore = score }
  }
  if (/[ąćęłńśźż]/i.test(s)) return 'pl'
  if (/[ßäöü]/i.test(s) && best !== 'en') return 'de'
  return best
}

/** When the text is already in the target language, translate to the next sensible one. */
export function resolveTarget(detected: string | undefined, target: string, ui: string): string {
  if (!detected || detected !== target) return target
  if (target !== 'en') return 'en'
  return ui === 'en' ? 'ru' : ui
}

export interface TranslateParams {
  text: string
  to: string
  context?: string
  title?: string
  settings: TranslationSettings
  provider?: TranslationProviderId
}

export async function translateText(p: TranslateParams): Promise<TranslateResponse> {
  const provider = p.provider ?? p.settings.provider
  const info = PROVIDERS.find(x => x.id === provider)!
  return bc.translate.run({
    text: p.text,
    to: p.to,
    from: 'auto',
    fromHint: detectLanguage(p.text),
    provider,
    context: info.contextAware && p.settings.useContext ? p.context?.slice(0, 1500) : undefined,
    title: info.contextAware && p.settings.useContext ? p.title : undefined,
    model: provider === 'claude' ? p.settings.claudeModel : provider === 'openai' ? p.settings.openaiModel : undefined,
    folderId: provider === 'yandex' ? p.settings.yandexFolderId || undefined : undefined,
  })
}
