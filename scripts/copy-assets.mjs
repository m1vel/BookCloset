// Copies runtime assets of pdf.js (CMaps, standard fonts, wasm decoders) into the renderer public dir.
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pdfjs = resolve(root, 'node_modules/pdfjs-dist')
const out = resolve(root, 'src/renderer/public/pdfjs')

mkdirSync(out, { recursive: true })
for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  const src = resolve(pdfjs, dir)
  if (existsSync(src)) cpSync(src, resolve(out, dir), { recursive: true })
}
console.log('pdf.js assets copied →', out)
