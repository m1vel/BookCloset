import { app } from 'electron'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'

/**
 * Portable build: keep all data next to the executable, so the app can live on a USB stick.
 * Must run before `app.whenReady()`.
 */
export function setupDataDir() {
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR
  if (process.env.BC_USER_DATA) app.setPath('userData', process.env.BC_USER_DATA)
  else if (portableDir) app.setPath('userData', join(portableDir, 'BookCloset Data'))
}

export const dataDir = () => app.getPath('userData')
export const booksDir = () => ensure(join(dataDir(), 'books'))
export const coversDir = () => ensure(join(dataDir(), 'covers'))
export const annotationsDir = () => ensure(join(dataDir(), 'annotations'))
export const cacheDir = () => ensure(join(dataDir(), 'cache'))

function ensure(dir: string) {
  mkdirSync(dir, { recursive: true })
  return dir
}
