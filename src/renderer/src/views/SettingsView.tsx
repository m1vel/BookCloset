import { useEffect, useState } from 'react'
import { Check, FolderOpen, Translate, Palette, BookOpenText, Books, FileArchive, Info, Keyboard } from '@phosphor-icons/react'
import type { UiTheme } from '../../../shared/types'
import { useSettings } from '../store/settings'
import { useT, type TKey } from '../i18n'
import { bc } from '../api'
import { Segmented } from '../components/ui'
import { LogoMark } from '../components/Logo'
import { ReflowAppearance } from './reader/Appearance'
import { TranslationSettings } from './TranslationSettings'
import { ScheduleSettings } from './ScheduleSettings'

const THEMES: UiTheme[] = ['paper', 'midnight', 'glass']
const FORMATS = [
  ['EPUB', 'EPUB 2/3, fixed layout'], ['FB2', 'FB2, FB2.ZIP'], ['MOBI', 'MOBI, AZW, AZW3, KF8, PRC'], ['PDF', 'PDF'],
  ['DjVu', 'DjVu'], ['TXT', 'UTF-8/16, CP1251, KOI8-R, CP866'], ['HTML', 'HTML, XHTML, MHT'], ['DOCX', 'DOCX, DOC, ODT, RTF'],
  ['MD', 'Markdown'], ['CHM', 'CHM'], ['CBZ', 'CBZ, CBR, CB7, CBT'], ['ZIP', 'ZIP, RAR, 7Z'], ['IMG', 'JPG, PNG, WEBP, GIF'],
  ['Calibre', 'LIT, LRF, SNB, TCR, PML…'],
]

function ThemePreview({ theme }: { theme: UiTheme }) {
  return (
    <div className="theme-preview" data-theme={theme}>
      <div className="tp-bg" />
      <div className="tp-side">
        <span className="tp-logo" />
        <span className="tp-line w60 on" />
        <span className="tp-line w80" />
        <span className="tp-line w50" />
      </div>
      <div className="tp-main">
        <span className="tp-title" />
        <div className="tp-books">
          <span className="tp-book b1" /><span className="tp-book b2" /><span className="tp-book b3" />
        </div>
        <span className="tp-shelf" />
      </div>
    </div>
  )
}

export default function SettingsView() {
  const t = useT()
  const s = useSettings(st => st.settings)
  const update = useSettings(st => st.update)
  const [info, setInfo] = useState<{ version: string; dataDir: string; isPortable: boolean } | null>(null)
  const [calibre, setCalibre] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    bc.info().then(setInfo)
    bc.calibre.find().then(setCalibre)
  }, [])

  return (
    <div className="settings">
      <header className="lib-header drag-region">
        <div className="lib-title">
          <span className="eyebrow">BookCloset</span>
          <h1 className="display">{t('set.title')}</h1>
        </div>
      </header>
      <div className="lib-scroll">
        <div className="settings-col rise-in">
          <section className="set-section">
            <h2 className="set-h"><Palette size={18} /> {t('set.appearance')}</h2>
            <div className="card set-card">
              <div className="set-label">{t('set.theme')}</div>
              <div className="theme-cards">
                {THEMES.map(th => (
                  <button key={th} className={`theme-card ${s.uiTheme === th ? 'on' : ''}`} onClick={() => update(x => { x.uiTheme = th })}
                    aria-pressed={s.uiTheme === th}>
                    <ThemePreview theme={th} />
                    <div className="tc-text">
                      <div className="tc-name">{t(`set.theme.${th}` as TKey)} {s.uiTheme === th && <Check size={14} weight="bold" />}</div>
                      <div className="tc-desc">{t(`set.theme.${th}.d` as TKey)}</div>
                    </div>
                  </button>
                ))}
              </div>
              <ScheduleSettings />
              <div className="set-row">
                <div className="set-label">{t('set.language')}</div>
                <Segmented value={s.lang} onChange={v => update(x => { x.lang = v })} options={[
                  { value: 'ru', label: 'Русский' }, { value: 'en', label: 'English' },
                ]} />
              </div>
            </div>
          </section>

          <section className="set-section">
            <h2 className="set-h"><BookOpenText size={18} /> {t('set.reading')}</h2>
            <div className="card set-card">
              <p className="set-hint">{t('set.readingHint')}</p>
              <div className="set-reader"><ReflowAppearance /></div>
            </div>
          </section>

          <section className="set-section">
            <h2 className="set-h"><Translate size={18} /> {t('set.translation')}</h2>
            <TranslationSettings />
          </section>

          <section className="set-section">
            <h2 className="set-h"><Books size={18} /> {t('set.library')}</h2>
            <div className="card set-card">
              <div className="set-row">
                <div>
                  <div className="set-label">{t('set.dataDir')}</div>
                  <code className="set-path">{info?.dataDir}</code>
                  {info?.isPortable && <div className="set-note">{t('set.portable')}</div>}
                </div>
                <button className="btn sm" onClick={() => bc.openDataDir()}><FolderOpen size={15} /> {t('set.openDataDir')}</button>
              </div>
            </div>
          </section>

          <section className="set-section">
            <h2 className="set-h"><FileArchive size={18} /> {t('set.formats')}</h2>
            <div className="card set-card">
              <div className="set-label">{t('set.supported')}</div>
              <div className="format-table">
                {FORMATS.map(([k, v]) => (
                  <div key={k} className="fmt-row"><span className="badge">{k}</span><span className="muted">{v}</span></div>
                ))}
              </div>
              <div className="set-row">
                <div>
                  <div className="set-label">{t('set.calibre')}</div>
                  <div className="set-note">{calibre === undefined ? '…' : calibre ? t('set.calibreFound', { path: calibre }) : t('set.calibreMissing')}</div>
                </div>
                {!calibre && <button className="btn sm" onClick={() => bc.openExternal('https://calibre-ebook.com/download_windows')}>calibre-ebook.com</button>}
              </div>
            </div>
          </section>

          <section className="set-section">
            <h2 className="set-h"><Keyboard size={18} /> Hotkeys</h2>
            <div className="card set-card hotkeys">
              {[
                ['→ / Space / PgDn', s.lang === 'ru' ? 'Следующая страница' : 'Next page'],
                ['← / Shift+Space / PgUp', s.lang === 'ru' ? 'Предыдущая страница' : 'Previous page'],
                ['T', t('reader.toc')], ['Ctrl F', t('reader.search')], ['Ctrl B', t('reader.addBookmark')],
                ['Ctrl + / Ctrl −', s.lang === 'ru' ? 'Размер шрифта / масштаб' : 'Font size / zoom'],
                ['F11', t('reader.fullscreen')], ['Esc', t('reader.back')],
              ].map(([k, v]) => (
                <div key={k} className="hk-row"><span className="hk-keys">{k.split(' / ').map(x => <span key={x} className="kbd">{x}</span>)}</span><span>{v}</span></div>
              ))}
            </div>
          </section>

          <section className="set-section">
            <h2 className="set-h"><Info size={18} /> {t('set.about')}</h2>
            <div className="card set-card about">
              <LogoMark size={44} />
              <div>
                <div className="logo-word">Book<span>Closet</span></div>
                <div className="muted">{t('set.version', { v: info?.version ?? '' })}</div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
