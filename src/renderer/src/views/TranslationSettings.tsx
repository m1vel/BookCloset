import { useEffect, useState } from 'react'
import { Eye, EyeSlash, CheckCircle, WarningCircle, ArrowSquareOut, Key, Trash } from '@phosphor-icons/react'
import type { KeyStatus, TranslationProviderId } from '../../../shared/types'
import { useSettings } from '../store/settings'
import { useT, type TKey } from '../i18n'
import { bc } from '../api'
import { Toggle } from '../components/ui'
import { CLAUDE_MODELS, PROVIDERS, TARGET_LANGS, langName, translateText } from '../translation'

export function TranslationSettings() {
  const t = useT()
  const ui = useSettings(s => s.settings.lang)
  const tr = useSettings(s => s.settings.translation)
  const update = useSettings(s => s.update)
  const [keys, setKeys] = useState<KeyStatus>({})
  const [draft, setDraft] = useState('')
  const [reveal, setReveal] = useState(false)
  const [test, setTest] = useState<{ busy: boolean; ok?: boolean; text?: string } | null>(null)
  const set = (fn: (x: typeof tr) => void) => update(s => fn(s.translation))

  useEffect(() => { bc.translate.keyStatus().then(setKeys) }, [])
  useEffect(() => { setDraft(''); setTest(null) }, [tr.provider])

  const info = PROVIDERS.find(p => p.id === tr.provider)!
  const status = keys[tr.provider]

  const saveKey = async (value: string) => {
    setKeys(await bc.translate.setKey(tr.provider, value))
    setDraft('')
    setTest(null)
  }
  const runTest = async () => {
    setTest({ busy: true })
    const res = await translateText({
      text: ui === 'ru' ? 'The reader smiled and turned the page.' : 'Читатель улыбнулся и перевернул страницу.',
      to: ui === 'ru' ? 'ru' : 'en', settings: tr,
    })
    setTest(res.ok ? { busy: false, ok: true, text: res.result.text } : { busy: false, ok: false, text: t(`tr.err.${res.code}` as TKey) + (res.code !== 'NO_KEY' ? ` (${res.message.slice(0, 120)})` : '') })
  }

  return (
    <div className="card set-card">
      <p className="set-hint">{t('set.translationHint')}</p>
      <Toggle label={t('set.translationEnable')} checked={tr.enabled} onChange={v => set(x => { x.enabled = v })} />

      <div className="set-row">
        <div className="set-label">{t('set.translationTarget')}</div>
        <select className="input select" value={tr.targetLang} onChange={e => set(x => { x.targetLang = e.target.value })}>
          {TARGET_LANGS.map(code => <option key={code} value={code}>{langName(code, ui)}</option>)}
        </select>
      </div>

      <div className="set-label">{t('set.translationProvider')}</div>
      <div className="provider-grid" role="radiogroup">
        {PROVIDERS.map(p => (
          <button key={p.id} role="radio" aria-checked={tr.provider === p.id}
            className={`provider-card ${tr.provider === p.id ? 'on' : ''}`}
            onClick={() => set(x => { x.provider = p.id as TranslationProviderId })}>
            <span className="pc-name">{p.name}</span>
            <span className="pc-meta">
              {p.needsKey
                ? keys[p.id]?.set ? <><CheckCircle size={13} weight="fill" className="ok" /> {keys[p.id]!.hint}</> : <><Key size={13} /> API</>
                : t('common.free')}
            </span>
          </button>
        ))}
      </div>
      <div className="set-note">{info.needsKey ? t('set.translationPaid') : t('set.translationFree')}</div>

      {info.needsKey && (
        <div className="key-box">
          <div className="set-row">
            <div className="set-label">{t('set.translationKey')}</div>
            {info.keyUrl && (
              <button className="btn ghost sm" onClick={() => bc.openExternal(info.keyUrl!)}>
                {t('set.translationKeyGet')} <ArrowSquareOut size={13} />
              </button>
            )}
          </div>
          <form className="key-row" onSubmit={e => { e.preventDefault(); if (draft.trim()) saveKey(draft) }}>
            <div className="key-input">
              <input className="input" type={reveal ? 'text' : 'password'} autoComplete="off" spellCheck={false}
                placeholder={status?.set ? status.hint : info.keyHint} value={draft} onChange={e => setDraft(e.target.value)} />
              <button type="button" className="icon-btn sm" aria-label="show" onClick={() => setReveal(r => !r)}>
                {reveal ? <EyeSlash size={15} /> : <Eye size={15} />}
              </button>
            </div>
            <button type="submit" className="btn sm primary" disabled={!draft.trim()}>{t('set.translationKeySave')}</button>
            {status?.set && (
              <button type="button" className="icon-btn sm" aria-label={t('set.translationKeyRemove')} data-tip={t('set.translationKeyRemove')}
                onClick={() => saveKey('')}><Trash size={15} /></button>
            )}
          </form>
          <div className="set-note">{status?.set ? t('set.translationKeyStored') : t('set.translationKeyNone')}</div>

          {tr.provider === 'claude' && (
            <div className="set-row">
              <div className="set-label">{t('set.translationModel')}</div>
              <select className="input select" value={tr.claudeModel} onChange={e => set(x => { x.claudeModel = e.target.value })}>
                {CLAUDE_MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </div>
          )}
          {tr.provider === 'openai' && (
            <div className="set-row">
              <div className="set-label">{t('set.translationModel')}</div>
              <input className="input select" value={tr.openaiModel} onChange={e => set(x => { x.openaiModel = e.target.value })} />
            </div>
          )}
          {tr.provider === 'yandex' && (
            <div className="set-row">
              <div className="set-label">{t('set.translationFolder')}</div>
              <input className="input select" value={tr.yandexFolderId} onChange={e => set(x => { x.yandexFolderId = e.target.value.trim() })} />
            </div>
          )}
        </div>
      )}

      <div className="set-row">
        <button className="btn sm" onClick={runTest} disabled={test?.busy}>
          {test?.busy ? <span className="spinner" style={{ width: 14, height: 14 }} /> : null} {t('set.translationTest')}
        </button>
        {test && !test.busy && (
          <span className={`test-result ${test.ok ? 'ok' : 'bad'}`}>
            {test.ok ? <CheckCircle size={15} weight="fill" /> : <WarningCircle size={15} weight="fill" />}
            {test.ok ? t('set.translationTestOk', { text: test.text ?? '' }) : test.text}
          </span>
        )}
      </div>

      <Toggle label={t('set.translationContext')} hint={t('set.translationContextHint')} checked={tr.useContext} onChange={v => set(x => { x.useContext = v })} />
      <Toggle label={t('set.translationAutoWord')} checked={tr.autoWord} onChange={v => set(x => { x.autoWord = v })} />
    </div>
  )
}
