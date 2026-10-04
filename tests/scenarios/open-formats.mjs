// Opens one book per format (from an already imported library) and screenshots the reader.
// usage: node tests/run.mjs open-formats [--only=epub,fb2]
const only = process.argv.find(a => a.startsWith('--only='))?.slice(7)?.split(',')

export default async ({ page, shot, wait }) => {
  await page.waitForSelector('.sidebar', { timeout: 15000 })
  const books = await page.evaluate(() => window.__bc.lib.getState().books.map(b => ({ id: b.id, format: b.format, file: b.fileName })))
  const seen = new Set()
  for (const b of books.sort((a, b) => a.file.localeCompare(b.file))) {
    const key = b.format + (b.file.includes('1251') ? '-1251' : b.file.includes('koi8') ? '-koi8' : '')
    if (seen.has(key)) continue
    if (only && !only.includes(b.format)) continue
    seen.add(key)
    await page.evaluate(id => window.__bc.openBookById(id), b.id)
    try {
      await page.waitForFunction(() => {
        const err = document.querySelector('.reader-error')
        const loading = document.querySelector('.reader-loading')
        return err || (!loading && document.querySelector('.reader-stage'))
      }, null, { timeout: 30000 })
    } catch { /* screenshot anyway */ }
    await wait(b.format === 'djvu' || b.format === 'pdf' ? 3500 : 2200)
    const err = await page.evaluate(() => document.querySelector('.err-detail')?.textContent ?? null)
    console.log(key.padEnd(10), b.file, err ? `ERROR: ${err}` : 'ok')
    // move the mouse to the top so the chrome is visible
    await page.mouse.move(700, 20)
    await wait(300)
    await shot(`reader-${key}`)
    await page.keyboard.press('Escape')
    await wait(400)
    await page.evaluate(() => window.__bc.ui.getState().navigate({ name: 'library', filter: { kind: 'all' } }))
    await wait(400)
  }
}
