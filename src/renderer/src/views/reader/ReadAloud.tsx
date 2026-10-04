import { useEffect, useRef, useState, type RefObject } from 'react'
import {
  Play, Pause, SkipBack, SkipForward, X, Minus, Plus, UserSound, MoonStars, Check, GearSix,
} from '@phosphor-icons/react'
import type { EngineController, SpeechCursor } from '../../engines/types'
import { bc } from '../../api'
import { useT } from '../../i18n'
import { useSettings } from '../../store/settings'
import { Popover } from '../../components/ui'

export const RATE_STEPS = [0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.35, 1.5, 1.75, 2, 2.5]
const langKey = (lang: string) => lang.slice(0, 2).toLowerCase()

// automated tests run silently (BC_TEST): speech still runs, at zero volume
let silent = false
bc.info().then(i => { silent = !!(i as { test?: boolean }).test }).catch(() => {})

export function useVoices() {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => speechSynthesis.getVoices())
  useEffect(() => {
    const on = () => setVoices(speechSynthesis.getVoices())
    speechSynthesis.addEventListener('voiceschanged', on)
    on()
    return () => speechSynthesis.removeEventListener('voiceschanged', on)
  }, [])
  return voices
}

export function pickVoice(voices: SpeechSynthesisVoice[], lang: string, saved: Record<string, string>) {
  const key = langKey(lang)
  return voices.find(v => v.voiceURI === saved[key])
    ?? voices.find(v => langKey(v.lang) === key && v.localService)
    ?? voices.find(v => langKey(v.lang) === key)
    ?? null
}

export const voiceLabel = (v: SpeechSynthesisVoice) =>
  v.name.replace(/^Microsoft\s+/, '').replace(/\s+Desktop\b/, '').replace(/\s+-\s+/, ' — ')

export type Sleep = { kind: 'off' } | { kind: 'min'; until: number } | { kind: 'chapter' }
export type ReadStatus = 'idle' | 'loading' | 'playing' | 'paused'

interface Options {
  ctrl: RefObject<EngineController | null>
  onActivity: () => void
  /** end of the book, sleep timer, or nothing to read */
  onStop: (reason: 'end' | 'sleep' | 'notext' | 'novoice') => void
}

/** Sentence-by-sentence reading with the system (SAPI) voices, highlighting and page following. */
export function useReadAloud(o: Options) {
  const voices = useVoices()
  const prefs = useSettings(s => s.settings.tts)
  const [status, setStatus] = useState<ReadStatus>('idle')
  const [lang, setLang] = useState('en')
  const [sleep, setSleepState] = useState<Sleep>({ kind: 'off' })
  const opts = useRef(o)
  opts.current = o
  const st = useRef({
    cursor: null as SpeechCursor | null, idx: 0, token: 0,
    utt: null as SpeechSynthesisUtterance | null, sleep: { kind: 'off' } as Sleep,
    voices, prefs, status: 'idle' as ReadStatus,
  })
  st.current.voices = voices
  st.current.prefs = prefs
  st.current.status = status

  const setSleep = (s: Sleep) => { st.current.sleep = s; setSleepState(s) }

  const unmarkCurrent = () => st.current.cursor?.units[st.current.idx]?.unmark()

  const halt = () => {
    st.current.token++
    speechSynthesis.cancel()
    st.current.utt = null
  }

  const stop = (reason?: 'end' | 'sleep' | 'notext' | 'novoice') => {
    halt()
    unmarkCurrent()
    st.current.cursor = null
    setStatus('idle')
    setSleep({ kind: 'off' })
    if (reason) opts.current.onStop(reason)
  }

  const speakCurrent = () => {
    const s = st.current
    const cursor = s.cursor
    if (!cursor) return
    const unit = cursor.units[s.idx]
    if (!unit) {
      if (s.sleep.kind === 'chapter') return stop('sleep')
      void load('next')
      return
    }
    if (s.sleep.kind === 'min' && Date.now() >= s.sleep.until) return stop('sleep')
    const voice = pickVoice(s.voices, cursor.lang, s.prefs.voices)
    const token = ++s.token
    const u = new SpeechSynthesisUtterance(unit.text)
    if (voice) u.voice = voice
    u.lang = voice?.lang ?? cursor.lang
    u.rate = s.prefs.rate
    u.volume = silent ? 0 : 1
    u.onstart = () => { if (token === s.token) unit.mark() }
    u.onboundary = e => {
      if (token !== s.token || e.name !== 'word') return
      const len = e.charLength || (/^[\p{L}\p{N}'’-]+/u.exec(unit.text.slice(e.charIndex))?.[0].length ?? 1)
      unit.mark([e.charIndex, len])
    }
    u.onend = () => {
      if (token !== s.token) return
      unit.unmark()
      s.idx++
      opts.current.onActivity()
      speakCurrent()
    }
    u.onerror = e => {
      if (token !== s.token || e.error === 'interrupted' || e.error === 'canceled') return
      console.warn('speech error', e.error)
      unit.unmark()
      s.idx++
      speakCurrent()
    }
    s.utt = u // keep a reference: Chromium may drop events of collected utterances
    if (silent) (window as any).__bcSpoken = unit.text
    unit.reveal()
    unit.mark()
    speechSynthesis.speak(u)
  }

  const load = async (where: 'start' | 'next') => {
    const s = st.current
    const token = ++s.token
    setStatus('loading')
    // the engine reads the selection synchronously, before the first await
    let cur = await opts.current.ctrl.current?.speech(where) ?? null
    let hops = 0
    while (cur && !cur.units.length && hops++ < 30 && token === s.token) cur = await opts.current.ctrl.current?.speech('next') ?? null
    if (token !== s.token) return
    if (!cur || !cur.units.length) return stop(where === 'start' && hops === 0 ? 'notext' : 'end')
    if (!s.voices.length) return stop('novoice')
    s.cursor = cur
    s.idx = 0
    setLang(cur.lang)
    setStatus('playing')
    speakCurrent()
  }

  const start = () => { halt(); unmarkCurrent(); void load('start') }
  const pause = () => { if (st.current.status !== 'playing') return; halt(); setStatus('paused') }
  const resume = () => { if (st.current.status !== 'paused') return; setStatus('playing'); speakCurrent() }
  const toggle = () => (st.current.status === 'playing' ? pause() : st.current.status === 'paused' ? resume() : start())
  const skip = (dir: 1 | -1) => {
    const s = st.current
    if (!s.cursor) return
    halt()
    unmarkCurrent()
    s.idx = Math.max(0, s.idx + dir)
    setStatus('playing')
    speakCurrent()
  }
  /** re-read the current sentence (after a voice or speed change) */
  const restartSentence = () => { if (st.current.status === 'playing') { halt(); speakCurrent() } }
  /** the reader navigated by hand: continue from the new page */
  const followNavigation = () => {
    if (st.current.status === 'idle') return
    halt()
    unmarkCurrent()
    setTimeout(() => void load('start'), 450)
  }

  // stop speaking when the reader closes
  useEffect(() => () => { st.current.token++; speechSynthesis.cancel() }, [])

  return { status, lang, voices, sleep, setSleep, start, stop, toggle, pause, resume, skip, restartSentence, followNavigation }
}

export type ReadAloud = ReturnType<typeof useReadAloud>

const SLEEP_OPTIONS: (number | 'chapter' | 0)[] = [0, 15, 30, 45, 60, 'chapter']

export function ReadAloudBar({ ra }: { ra: ReadAloud }) {
  const t = useT()
  const prefs = useSettings(s => s.settings.tts)
  const update = useSettings(s => s.update)
  const [voiceEl, setVoiceEl] = useState<HTMLElement | null>(null)
  const [sleepEl, setSleepEl] = useState<HTMLElement | null>(null)
  const [, tick] = useState(0)
  useEffect(() => {
    if (ra.sleep.kind !== 'min') return
    const id = setInterval(() => tick(n => n + 1), 15_000)
    return () => clearInterval(id)
  }, [ra.sleep])

  const key = langKey(ra.lang)
  const voice = pickVoice(ra.voices, ra.lang, prefs.voices)
  const matching = ra.voices.filter(v => langKey(v.lang) === key)
  const others = ra.voices.filter(v => langKey(v.lang) !== key)
  const uiLang = useSettings(s => s.settings.lang)
  const langName = (() => { try { return new Intl.DisplayNames([uiLang], { type: 'language' }).of(key) ?? key } catch { return key } })()
  const setRate = (dir: 1 | -1) => {
    const i = RATE_STEPS.findIndex(r => r >= prefs.rate - 0.001)
    const next = RATE_STEPS[Math.max(0, Math.min(RATE_STEPS.length - 1, (i < 0 ? 4 : i) + dir))]
    update(s => { s.tts.rate = next })
    setTimeout(ra.restartSentence, 0)
  }
  const sleepLabel = ra.sleep.kind === 'min'
    ? t('tts.sleepLeft', { n: Math.max(1, Math.ceil((ra.sleep.until - Date.now()) / 60000)) })
    : ra.sleep.kind === 'chapter' ? t('tts.sleepChapter') : null
  const playing = ra.status === 'playing'

  return (
    <div className="auto-bar tts-bar" role="toolbar" aria-label={t('tts.title')}>
      <button className="icon-btn sm" onClick={() => ra.skip(-1)} aria-label={t('tts.prev')} data-tip={t('tts.prev')}><SkipBack size={15} weight="fill" /></button>
      <button className={`auto-play ${ra.status === 'loading' ? 'loading' : ''}`} onClick={ra.toggle}
        aria-label={playing ? t('auto.pause') : t('auto.resume')} data-tip={`${playing ? t('auto.pause') : t('auto.resume')} · Space`}>
        {ra.status === 'loading' ? <span className="spinner" /> : playing ? <Pause size={15} weight="fill" /> : <Play size={15} weight="fill" />}
      </button>
      <button className="icon-btn sm" onClick={() => ra.skip(1)} aria-label={t('tts.next')} data-tip={t('tts.next')}><SkipForward size={15} weight="fill" /></button>
      <span className="auto-sep" />
      <button className="icon-btn sm" onClick={() => setRate(-1)} aria-label={t('auto.slower')} data-tip={t('auto.slower')}><Minus size={14} weight="bold" /></button>
      <span className="auto-value tabular tts-rate" aria-live="polite">{+prefs.rate.toFixed(2)}×</span>
      <button className="icon-btn sm" onClick={() => setRate(1)} aria-label={t('auto.faster')} data-tip={t('auto.faster')}><Plus size={14} weight="bold" /></button>
      <span className="auto-sep" />
      <button className={`tts-chip ${voice ? '' : 'warn'}`} onClick={e => setVoiceEl(voiceEl ? null : e.currentTarget)} aria-label={t('tts.voice')} data-tip={t('tts.voice')}>
        <UserSound size={15} /> <span className="truncate">{voice ? voiceLabel(voice).split(' — ')[0] : t('tts.noVoiceShort')}</span>
      </button>
      <button className={`icon-btn sm ${ra.sleep.kind !== 'off' ? 'active' : ''}`} onClick={e => setSleepEl(sleepEl ? null : e.currentTarget)}
        aria-label={t('tts.sleep')} data-tip={sleepLabel ?? t('tts.sleep')}>
        <MoonStars size={16} />
      </button>
      {sleepLabel && <span className="tts-sleep tabular">{sleepLabel}</span>}
      <span className="auto-sep" />
      <button className="icon-btn sm" onClick={() => ra.stop()} aria-label={t('tts.stop')} data-tip={`${t('tts.stop')} · Esc`}><X size={15} weight="bold" /></button>

      <Popover anchor={voiceEl} open={!!voiceEl} onClose={() => setVoiceEl(null)} placement="top" className="tts-voices">
        <div className="menu-label eyebrow">{t('tts.voicesFor', { lang: langName })}</div>
        {matching.length ? matching.map(v => (
          <button key={v.voiceURI} className="menu-item" onClick={() => { update(s => { s.tts.voices[key] = v.voiceURI }); setVoiceEl(null); setTimeout(ra.restartSentence, 0) }}>
            <span className="truncate">{voiceLabel(v)}</span>
            {voice?.voiceURI === v.voiceURI && <Check size={14} weight="bold" className="check" />}
          </button>
        )) : (
          <div className="tts-hint">
            <p>{t('tts.noVoice', { lang: langName })}</p>
            <button className="btn sm" onClick={() => bc.openSpeechSettings()}><GearSix size={14} /> {t('tts.addVoices')}</button>
          </div>
        )}
        {others.length > 0 && (
          <>
            <div className="menu-sep" />
            <div className="menu-label eyebrow">{t('tts.otherVoices')}</div>
            {others.map(v => (
              <button key={v.voiceURI} className="menu-item" onClick={() => { update(s => { s.tts.voices[key] = v.voiceURI }); setVoiceEl(null); setTimeout(ra.restartSentence, 0) }}>
                <span className="truncate">{voiceLabel(v)}</span>
                {voice?.voiceURI === v.voiceURI && <Check size={14} weight="bold" className="check" />}
              </button>
            ))}
          </>
        )}
      </Popover>
      <Popover anchor={sleepEl} open={!!sleepEl} onClose={() => setSleepEl(null)} placement="top">
        <div className="menu-label eyebrow">{t('tts.sleep')}</div>
        {SLEEP_OPTIONS.map(o => {
          const on = o === 0 ? ra.sleep.kind === 'off' : o === 'chapter' ? ra.sleep.kind === 'chapter' : false
          return (
            <button key={String(o)} className="menu-item" onClick={() => {
              ra.setSleep(o === 0 ? { kind: 'off' } : o === 'chapter' ? { kind: 'chapter' } : { kind: 'min', until: Date.now() + o * 60_000 })
              setSleepEl(null)
            }}>
              <span>{o === 0 ? t('common.off') : o === 'chapter' ? t('tts.sleepEndChapter') : t('tts.sleepMin', { n: o })}</span>
              {on && <Check size={14} weight="bold" className="check" />}
            </button>
          )
        })}
      </Popover>
    </div>
  )
}
