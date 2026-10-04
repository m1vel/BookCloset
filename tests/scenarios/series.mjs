// Series & authors: migration picks up FB2/comic series, grouping, author & series pages, details block.
export default async ({ page, shot, wait }) => {
  await page.waitForSelector('.sidebar', { timeout: 15000 })
  await page.evaluate(() => window.__bc.settings.getState().update(s => { s.uiTheme = 'paper'; s.lang = 'ru'; s.schedule.mode = 'off'; s.library.view = 'grid' }))
  // wait for the background series refresh of older records
  await page.waitForFunction(() => window.__bc.lib.getState().books.every(b => (b.metaVersion ?? 1) >= 2), null, { timeout: 60000 })
  const series = await page.evaluate(() => window.__bc.lib.getState().books.filter(b => b.series).map(b => `${b.format}: ${b.series} #${b.seriesIndex ?? '-'}`))
  console.log('series found:', series)
  // demo data: put the three Alice editions into a series
  await page.evaluate(async () => {
    const lib = window.__bc.lib.getState()
    const alice = lib.books.filter(b => b.title.startsWith("Alice's")).sort((a, b) => a.format.localeCompare(b.format))
    for (const [i, b] of alice.entries()) await lib.update(b.id, { series: 'Alice (editions)', seriesIndex: i + 1 })
  })
  for (const group of ['author', 'series']) {
    await page.evaluate(g => window.__bc.settings.getState().update(s => { s.library.group = g }), group)
    await page.evaluate(() => window.__bc.ui.getState().navigate({ name: 'library', filter: { kind: 'all' } }))
    await wait(1200)
    await page.evaluate(() => document.querySelector('.lib-scroll').scrollTo(0, 520))
    await wait(500)
    await shot(`ser-01-group-${group}`)
  }
  await page.evaluate(() => window.__bc.settings.getState().update(s => { s.library.group = 'none' }))
  // author page via a click on the author name
  await page.evaluate(() => window.__bc.ui.getState().navigate({ name: 'library', filter: { kind: 'all' } }))
  await wait(800)
  const author = await page.$('.card-author .link-inline:has-text("Пушкин")')
  if (author) await author.click()
  await wait(900)
  console.log('author page title:', await page.textContent('.lib-title h1'), '| books:', await page.$$eval('.book-card', x => x.length))
  await shot('ser-02-author-page')
  // details with the series block
  const id = await page.evaluate(() => window.__bc.lib.getState().books.find(b => b.series === 'Alice (editions)' && b.seriesIndex === 2).id)
  await page.evaluate(id => window.__bc.ui.getState().showDetails(id), id)
  await wait(900)
  await shot('ser-03-details')
}
