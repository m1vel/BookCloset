import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * Tiny JSON document store: keeps the value in memory and persists it atomically
 * (write to a temp file, then rename) with a short debounce.
 */
export class JsonStore<T> {
  private value: T
  private timer: NodeJS.Timeout | null = null

  constructor(private file: string, defaults: () => T, migrate?: (v: any) => T) {
    let loaded: T | null = null
    try {
      if (existsSync(file)) loaded = JSON.parse(readFileSync(file, 'utf8'))
    } catch (e) {
      console.error('Failed to read', file, e)
      try { renameSync(file, file + '.corrupt-' + Date.now()) } catch { /* ignore */ }
    }
    this.value = loaded ? (migrate ? migrate(loaded) : loaded) : defaults()
  }

  get(): T {
    return this.value
  }

  set(value: T) {
    this.value = value
    this.schedule()
  }

  update(fn: (v: T) => void) {
    fn(this.value)
    this.schedule()
  }

  private schedule() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), 300)
  }

  flush() {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = this.file + '.tmp'
    writeFileSync(tmp, JSON.stringify(this.value), 'utf8')
    renameSync(tmp, this.file)
  }
}
