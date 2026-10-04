import { safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import type { KeyStatus, TranslationProviderId } from '../shared/types'
import { dataDir } from './paths'

/**
 * API keys for translation services. Encrypted with the OS keychain (DPAPI on Windows)
 * via Electron safeStorage; the renderer only ever sees whether a key is set.
 */
const file = () => join(dataDir(), 'secrets.json')

function load(): Record<string, string> {
  try {
    return existsSync(file()) ? JSON.parse(readFileSync(file(), 'utf8')) : {}
  } catch {
    return {}
  }
}

function save(data: Record<string, string>) {
  const tmp = file() + '.tmp'
  writeFileSync(tmp, JSON.stringify(data), 'utf8')
  renameSync(tmp, file())
}

export function setKey(provider: TranslationProviderId, key: string) {
  const data = load()
  const k = key.trim()
  if (!k) delete data[provider]
  else if (safeStorage.isEncryptionAvailable()) data[provider] = 'enc:' + safeStorage.encryptString(k).toString('base64')
  else data[provider] = 'raw:' + Buffer.from(k, 'utf8').toString('base64')
  save(data)
}

export function getKey(provider: TranslationProviderId): string | null {
  const v = load()[provider]
  if (!v) return null
  try {
    if (v.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(v.slice(4), 'base64'))
    if (v.startsWith('raw:')) return Buffer.from(v.slice(4), 'base64').toString('utf8')
  } catch { /* key encrypted for another user/machine */ }
  return null
}

export function keyStatus(): KeyStatus {
  const out: KeyStatus = {}
  for (const p of ['deepl', 'yandex', 'claude', 'openai'] as TranslationProviderId[]) {
    const k = getKey(p)
    out[p] = { set: !!k, hint: k ? '••••' + k.slice(-4) : '' }
  }
  return out
}
