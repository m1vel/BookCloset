// Quote cards: from a reader selection, all styles/formats/fonts, long-quote truncation, clipboard, notes page entry.
const drag = async (page, a, b) => {
  await page.mouse.move(a[0], a[1])
  await page.mouse.down()
  await page.mouse.move(b[0], b[1], { steps: 14 })
  await page.mouse.up()
  await page.waitForTimeout(500)
}
const rendered = page => page.waitForFunction(() => {
  const c = document.querySelector('.qc-canvas')
  return c && c.width > 0
}, null, { timeout: 15000 })

export default async ({ app, page, shot, wait }) => {
  await page.waitForSelector('.sidebar', { timeout: 15000 })
  await page.evaluate(() => window.__bc.settings.getState().update(s => {
    s.lang = 'ru'; s.uiTheme = 'paper'; s.schedule.mode = 'off'
    Object.assign(s.reader, { pageTheme: 'auto', flow: 'paginated', columns: 2, fontFamily: 'Literata' })
    s.quoteCard = { style: 'paper', format: 'square', font: 'cormorant', showCover: true, showBrand: true }
  }))
  // FB2 with a cover
  const id = await page.evaluate(() => window.__bc.lib.getState().books.find(b => b.format === 'fb2' && b.hasCover).id)
  await page.evaluate(id => window.__bc.lib.getState().update(id, { location: undefined, progress: 0 }), id)
  await page.evaluate(id => window.__bc.openBookById(id), id)
  await wait(3000)
  for (let i = 0; i < 3; i++) { await page.keyboard.press('ArrowRight'); await wait(400) }
  await wait(600)
  await drag(page, [180, 300], [620, 420])
  await shot('qc-01-selection-menu')
  const btn = await page.$('.sel-menu button[aria-label="Карточка цитаты"]')
  if (!btn) throw new Error('no quote card button in the selection menu')
  await btn.click()
  await rendered(page)
  await wait(600)
  console.log('quote text:', (await page.inputValue('#qc-text')).slice(0, 120))
  await shot('qc-02-paper-square')

  // keys inside the dialog must not turn pages behind it
  const before = await page.evaluate(() => window.__bc.lib.getState().books.find(b => b.format === 'fb2' && b.hasCover).progress)
  await page.keyboard.press('ArrowRight')
  await wait(500)
  const after = await page.evaluate(() => window.__bc.lib.getState().books.find(b => b.format === 'fb2' && b.hasCover).progress)
  console.log('page turned behind dialog:', before !== after)

  const pick = async (sel, name) => { await page.click(sel); await wait(250); await rendered(page); await wait(700); await shot(name) }
  await pick('.qc-style-night', 'qc-03-night-square')
  await page.click('.segmented button:has-text("Literata")')
  await pick('.qc-style-cover', 'qc-04-cover-literata')
  await page.click('.segmented button:has-text("Manrope")')
  await pick('.segmented button:has-text("Сторис")', 'qc-05-cover-story-manrope')
  await page.click('.segmented button:has-text("Cormorant")')
  await page.click('.qc-style-paper')
  await pick('.segmented button:has-text("16:9")', 'qc-06-paper-wide')

  // a very long quote gets shortened with a warning
  await page.fill('#qc-text', 'Береги честь смолоду. '.repeat(3) + 'Не приведи бог видеть русский бунт, бессмысленный и беспощадный! '.repeat(14))
  await wait(700)
  await rendered(page)
  await wait(500)
  console.log('truncation warning shown:', !!(await page.$('.qc-warn')))
  await shot('qc-07-long-wide')

  // copy to clipboard via main, then read it back
  await page.click('.segmented button:has-text("1:1")')
  await wait(800)
  await page.click('.qc-actions .btn.primary')
  await wait(1200)
  const clip = await app.evaluate(() => { const s = globalThis.__bcTestClipboard; return s ? `${s.width}x${s.height}` : 'none' })
  console.log('clipboard image:', clip)
  await page.keyboard.press('Escape')
  await wait(400)
  console.log('dialog closed:', !(await page.$('.qc-dialog')))

  // entry point on the notes page (hover action)
  await page.keyboard.press('Escape')
  await page.evaluate(() => window.__bc.ui.getState().navigate({ name: 'notes' }))
  await wait(1200)
  const item = await page.$('.ng-item')
  if (item) {
    await item.hover()
    await wait(300)
    await shot('qc-08-notes-hover')
    await page.click('.ng-item .ng-card')
    await rendered(page)
    await wait(600)
    await page.evaluate(() => window.__bc.settings.getState().update(s => { s.uiTheme = 'midnight' }))
    await wait(700)
    await shot('qc-09-from-notes-midnight')
    await page.keyboard.press('Escape')
  } else console.log('no notes to test')
  await page.evaluate(() => window.__bc.settings.getState().update(s => { s.uiTheme = 'paper' }))
}
