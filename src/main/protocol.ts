import { net, protocol } from 'electron'
import { join, normalize, extname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { existsSync } from 'node:fs'
import { bookFilePath, coverPath, getBook } from './library'
import { cacheDir } from './paths'

/**
 * `app://bookcloset/…` serves the renderer bundle in production (a real origin is needed for
 * book iframes, blobs and fonts to be same-origin).
 * `bc://book/<id>`, `bc://cover/<id>`, `bc://cache/<id>/<path>` serve library files.
 */
export function registerSchemes() {
  const privileges = {
    standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true,
  }
  protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges },
    { scheme: 'bc', privileges: { ...privileges, bypassCSP: false } },
  ])
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.avif': 'image/avif', '.bmp': 'image/bmp', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.otf': 'font/otf', '.htm': 'text/html', '.xhtml': 'application/xhtml+xml', '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream', '.ico': 'image/x-icon',
}

export const CSP = [
  "default-src 'self' app: bc: blob: data:",
  "script-src 'self' app: 'wasm-unsafe-eval'",
  "worker-src 'self' app: blob:",
  "style-src 'self' app: bc: 'unsafe-inline' blob: data:",
  "img-src 'self' app: bc: blob: data:",
  "font-src 'self' app: bc: blob: data:",
  "media-src 'self' app: bc: blob: data:",
  "connect-src 'self' app: bc: blob: data: https:",
  "frame-src 'self' app: blob: data:",
  "object-src 'none'",
].join('; ')

async function serveFile(path: string, extraHeaders: Record<string, string> = {}) {
  if (!existsSync(path)) return new Response('Not found', { status: 404 })
  const res = await net.fetch(pathToFileURL(path).toString())
  const headers = new Headers(res.headers)
  const type = MIME[extname(path).toLowerCase()]
  if (type) headers.set('Content-Type', type)
  headers.set('Access-Control-Allow-Origin', '*')
  for (const [k, v] of Object.entries(extraHeaders)) headers.set(k, v)
  return new Response(res.body, { status: res.status, headers })
}

export function handleProtocols(rendererDir: string) {
  protocol.handle('app', req => {
    const url = new URL(req.url)
    let p = decodeURIComponent(url.pathname)
    if (p === '/' || p === '') p = '/index.html'
    const file = normalize(join(rendererDir, p))
    if (!file.startsWith(normalize(rendererDir))) return new Response('Forbidden', { status: 403 })
    const headers: Record<string, string> = file.endsWith('.html') ? { 'Content-Security-Policy': CSP } : {}
    return serveFile(file, headers)
  })

  protocol.handle('bc', req => {
    const url = new URL(req.url)
    const kind = url.hostname
    const parts = decodeURIComponent(url.pathname).split('/').filter(Boolean)
    const id = parts[0]
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return new Response('Bad request', { status: 400 })
    if (kind === 'book') {
      const b = getBook(id)
      if (!b) return new Response('Not found', { status: 404 })
      return serveFile(bookFilePath(b))
    }
    if (kind === 'cover') return serveFile(coverPath(id), { 'Cache-Control': 'no-cache' })
    if (kind === 'cache') {
      const base = normalize(join(cacheDir(), id))
      const file = normalize(join(base, ...parts.slice(1)))
      if (!file.startsWith(base)) return new Response('Forbidden', { status: 403 })
      return serveFile(file)
    }
    return new Response('Not found', { status: 404 })
  })
}
