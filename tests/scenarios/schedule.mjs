// Day/night schedule: force "night" by time, check library + reader warm tint, then settings.
export default async ({ page, shot, wait }) => {
  await page.waitForSelector('.sidebar', { timeout: 15000 })
  const pad = n => String(n).padStart(2, '0')
  const d = new Date(), h = d.getHours()
  const nightStart = `${pad((h + 23) % 24)}:00`, dayStart = `${pad((h + 2) % 24)}:00`
  await page.evaluate(([n, dd]) => window.__bc.settings.getState().update(s => {
    s.uiTheme = 'paper'; s.reader.pageTheme = 'auto'
    Object.assign(s.schedule, { mode: 'time', nightStart: n, dayStart: dd, nightTheme: 'midnight', nightPage: 'night', warmth: 0.3 })
  }), [nightStart, dayStart])
  await page.evaluate(() => window.__bc.ui.getState().navigate({ name: 'library', filter: { kind: 'all' } }))
  await wait(1200)
  console.log('theme attr:', await page.evaluate(() => document.documentElement.dataset.theme))
  await shot('sch-01-library-night')
  const id = await page.evaluate(() => window.__bc.lib.getState().books.find(b => b.format === 'fb2' && !b.fileName.includes('1251')).id)
  await page.evaluate(id => window.__bc.openBookById(id), id)
  await wait(3500)
  console.log('warm filter:', await page.evaluate(() => !!document.querySelector('.warm-filter')))
  await shot('sch-02-reader-night')
  await page.evaluate(() => window.__bc.ui.getState().navigate({ name: 'settings' }))
  await wait(900)
  await shot('sch-03-settings')
  await page.evaluate(() => window.__bc.settings.getState().update(s => { s.schedule.mode = 'off' }))
  await wait(600)
  console.log('after off:', await page.evaluate(() => document.documentElement.dataset.theme))
}
