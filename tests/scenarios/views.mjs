// Seeds reading history and captures stats / settings / notes / library in all three themes.
export default async ({ page, shot, wait }) => {
  await page.waitForSelector('.sidebar', { timeout: 15000 })
  const seeded = await page.evaluate(async () => {
    const st = await window.bc.stats.get()
    if (st.sessions.some(s => s.start < Date.now() - 30 * 86400000)) return false
    const books = window.__bc.lib.getState().books.filter(b => ['fb2', 'epub', 'pdf', 'docx', 'cbz'].includes(b.format))
    const DAY = 86400000
    let seed = 7
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    for (let d = 95; d >= 0; d--) {
      if (rnd() < 0.28 && d > 3) continue
      const n = 1 + Math.floor(rnd() * 2)
      for (let k = 0; k < n; k++) {
        const b = books[Math.floor(rnd() * books.length)]
        const start = Date.now() - d * DAY - (10 + k * 3) * 3600000
        const seconds = Math.round(300 + rnd() * 2700)
        await window.bc.stats.add({ bookId: b.id, start, end: start + seconds * 1000, seconds, progressFrom: 0, progressTo: 0.1, pages: Math.round(seconds / 75) })
      }
    }
    // a couple of reading-progress states for the shelf
    const lib = window.__bc.lib.getState()
    const pick = f => lib.books.find(f)
    const fb2 = pick(b => b.format === 'fb2' && !b.fileName.includes('1251'))
    const epub = pick(b => b.format === 'epub')
    const pdf = pick(b => b.format === 'pdf' && b.fileName.startsWith('Пушкин'))
    const cbz = pick(b => b.format === 'cbz')
    if (fb2) await lib.update(fb2.id, { status: 'reading', progress: 0.36, openedAt: Date.now() - 1000 })
    if (epub) await lib.update(epub.id, { status: 'reading', progress: 0.62, openedAt: Date.now() - 50000 })
    if (pdf) await lib.update(pdf.id, { status: 'reading', progress: 0.12, openedAt: Date.now() - 90000 })
    if (cbz) await lib.update(cbz.id, { status: 'finished', progress: 1, favorite: true })
    return true
  })
  console.log('seeded', seeded)
  await page.evaluate(() => window.__bc.lib.getState().load())
  for (const theme of ['paper', 'midnight', 'glass']) {
    await page.evaluate(th => window.__bc.settings.getState().update(s => { s.uiTheme = th }), theme)
    await page.evaluate(() => window.__bc.ui.getState().navigate({ name: 'library', filter: { kind: 'all' } }))
    await wait(1600)
    await shot(`view-library-${theme}`)
    await page.evaluate(() => window.__bc.ui.getState().navigate({ name: 'stats' }))
    await wait(1200)
    await shot(`view-stats-${theme}`)
    if (theme === 'paper') {
      await page.evaluate(() => window.__bc.ui.getState().navigate({ name: 'settings' }))
      await wait(900)
      await shot('view-settings')
      await page.evaluate(() => window.__bc.ui.getState().navigate({ name: 'notes' }))
      await wait(900)
      await shot('view-notes')
      await page.evaluate(() => window.__bc.ui.getState().navigate({ name: 'library', filter: { kind: 'all' } }))
      await wait(500)
      await page.evaluate(() => window.__bc.ui.getState().showDetails(window.__bc.lib.getState().books.find(b => b.format === 'fb2').id))
      await wait(800)
      await shot('view-details')
      await page.keyboard.press('Escape')
      await page.evaluate(() => window.__bc.settings.getState().update(s => { s.library.view = 'list' }))
      await wait(700)
      await shot('view-list')
      await page.evaluate(() => window.__bc.settings.getState().update(s => { s.library.view = 'grid' }))
    }
  }
  await page.evaluate(() => window.__bc.settings.getState().update(s => { s.uiTheme = 'paper' }))
}
