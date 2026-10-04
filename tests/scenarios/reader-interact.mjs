// Exercises the reader UI on the FB2 sample: paging, TOC, appearance, selection, highlight, search, bookmarks.
export default async ({ page, shot, wait }) => {
  await page.waitForSelector('.sidebar', { timeout: 15000 })
  const id = await page.evaluate(() => window.__bc.lib.getState().books.find(b => b.format === 'fb2' && !b.fileName.includes('1251')).id)
  await page.evaluate(() => window.__bc.settings.getState().setReader({ pageTheme: 'auto', flow: 'paginated', columns: 2 }))
  await page.evaluate(id => window.__bc.openBookById(id), id)
  await page.waitForSelector('.reflow-host', { timeout: 20000 })
  await wait(2500)

  // page forward a few times
  for (let i = 0; i < 3; i++) { await page.keyboard.press('ArrowRight'); await wait(450) }
  await page.mouse.move(720, 450)
  await wait(3200) // chrome hides
  await shot('ix-01-reading')

  // TOC
  await page.mouse.move(720, 15)
  await wait(300)
  await page.click('[aria-label="Оглавление"]')
  await wait(600)
  await shot('ix-02-toc')
  const items = await page.$$('.toc-label')
  if (items[4]) await items[4].click()
  await wait(1200)
  await shot('ix-03-chapter')
  await page.click('.reader-panel [aria-label="Закрыть"]')
  await wait(500)

  // selection by mouse drag + highlight
  await page.mouse.move(180, 300)
  await page.mouse.down()
  await page.mouse.move(420, 340, { steps: 12 })
  await page.mouse.up()
  await wait(500)
  await shot('ix-04-selection')
  const dot = await page.$('.sel-dot')
  if (dot) { await dot.click(); await wait(600) }
  await page.mouse.move(720, 450)
  await shot('ix-05-highlight')

  // appearance popover
  await page.mouse.move(720, 15)
  await wait(300)
  await page.click('[aria-label="Оформление"]')
  await wait(500)
  await shot('ix-06-appearance')
  await page.click('.swatch[aria-checked="false"] >> nth=5') // night
  await wait(900)
  await shot('ix-07-night')
  await page.keyboard.press('Escape')
  await wait(300)

  // search
  await page.keyboard.press('Control+f')
  await wait(400)
  await page.keyboard.type('Пугач')
  await page.keyboard.press('Enter')
  await wait(3500)
  await shot('ix-08-search')
  const hit = await page.$('.hit')
  if (hit) { await hit.click(); await wait(1200) }
  await shot('ix-09-search-hit')
  await page.keyboard.press('Escape')
  await wait(300)

  // bookmark + notes panel
  await page.keyboard.press('Control+b')
  await wait(400)
  await page.mouse.move(720, 15)
  await wait(300)
  await page.click('[aria-label="Заметки"]')
  await wait(600)
  await shot('ix-10-notes')
  await page.click('.rp-tab >> nth=2')
  await wait(400)
  await shot('ix-11-bookmarks')

  await page.evaluate(() => window.__bc.settings.getState().setReader({ pageTheme: 'auto' }))
}
