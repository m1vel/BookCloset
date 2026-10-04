import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

export default async ({ page, shot, wait, root }) => {
  await page.waitForSelector('.sidebar', { timeout: 15000 })
  const dir = join(root, 'samples')
  const files = readdirSync(dir).map(f => join(dir, f)).filter(f => statSync(f).isFile())
  console.log('importing', files.length, 'files')
  const t0 = Date.now()
  await page.evaluate(async files => { await window.__bc.lib.getState().importPaths(files) }, files)
  await page.waitForFunction(() => !window.__bc.lib.getState().indexing, null, { timeout: 300000 })
  console.log('indexed in', Date.now() - t0, 'ms')
  const books = await page.evaluate(() => window.__bc.lib.getState().books.map(b => ({
    title: b.title, authors: b.authors.join(', '), format: b.format, cover: b.hasCover, indexed: b.indexed, file: b.fileName,
  })))
  console.table(books)
  await wait(1500)
  await shot('library-all')
  await page.evaluate(() => document.querySelector('.lib-scroll').scrollTo(0, 99999))
  await wait(800)
  await shot('library-all-bottom')
}
