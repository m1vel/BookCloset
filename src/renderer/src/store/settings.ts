import { create } from 'zustand'
import type { Settings, ReaderPrefs, PagedPrefs } from '../../../shared/types'
import { defaultSettings } from '../../../shared/defaults'
import { bc } from '../api'

interface SettingsState {
  settings: Settings
  loaded: boolean
  load: () => Promise<void>
  update: (fn: (s: Settings) => void) => void
  setReader: (patch: Partial<ReaderPrefs>) => void
  setPaged: (patch: Partial<PagedPrefs>) => void
  setComic: (patch: Partial<PagedPrefs>) => void
}

let saveTimer: ReturnType<typeof setTimeout> | null = null

export const useSettings = create<SettingsState>((set, get) => ({
  settings: defaultSettings(),
  loaded: false,
  load: async () => {
    const s = await bc.settings.get()
    set({ settings: s, loaded: true })
  },
  update: fn => {
    const next: Settings = structuredClone(get().settings)
    fn(next)
    set({ settings: next })
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => bc.settings.set(get().settings), 250)
  },
  setReader: patch => get().update(s => { Object.assign(s.reader, patch) }),
  setPaged: patch => get().update(s => { Object.assign(s.paged, patch) }),
  setComic: patch => get().update(s => { Object.assign(s.comic, patch) }),
}))
