// Final QA captures: English UI, scrolled reflow on a white page, context menu, drop overlay.
export default async ({ page, shot, wait }) => {
  await page.waitForSelector('.sidebar', { timeout: 15000 })
  const set = fn => page.evaluate(src => window.__bc.settings.getState().update(new Function('s', src)), fn)

  // English UI + midnight
  await set("s.lang = 'en'; s.uiTheme = 'midnight'")
  await page.evaluate(() => window.__bc.ui.getState().navigate({ name: 'library', filter: { kind: 'all' } }))
  await wait(1200)
  await shot('qa-01-english')

  // context menu on a card
  const card = await page.$('.book-card >> nth=2')
  const box = await card.boundingBox()
  await page.mouse.click(box.x + box.width / 2, box.y + 120, { button: 'right' })
  await wait(500)
  await shot('qa-02-context')
  await page.keyboard.press('Escape')

  // drop overlay (synthetic dragenter with files)
  await page.evaluate(() => {
    const dt = new DataTransfer()
    dt.items.add(new File(['x'], 'book.epub'))
    window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true }))
  })
  await wait(500)
  await shot('qa-03-drop')
  await page.evaluate(() => {
    const dt = new DataTransfer()
    dt.items.add(new File(['x'], 'book.epub'))
    window.dispatchEvent(new DragEvent('dragleave', { dataTransfer: dt, bubbles: true }))
  })

  // scrolled reflow on a white page, EPUB
  await set("s.lang = 'ru'; s.uiTheme = 'paper'; s.reader.flow = 'scrolled'; s.reader.pageTheme = 'white'; s.reader.fontFamily = 'PT Serif'")
  const id = await page.evaluate(() => window.__bc.lib.getState().books.find(b => b.format === 'epub').id)
  await page.evaluate(id => window.__bc.openBookById(id), id)
  await page.waitForSelector('.reflow-host', { timeout: 20000 })
  await wait(2500)
  await page.mouse.move(720, 500)
  await page.mouse.wheel(0, 2600)
  await wait(1500)
  await page.mouse.move(720, 20)
  await wait(400)
  await shot('qa-04-scrolled-white')

  // sepia, single column, Lora
  await set("s.reader.flow = 'paginated'; s.reader.pageTheme = 'sepia'; s.reader.columns = 1; s.reader.fontFamily = 'Lora'")
  await wait(1800)
  await page.keyboard.press('ArrowRight')
  await wait(800)
  await page.mouse.move(720, 500)
  await wait(3200)
  await shot('qa-05-sepia-single')

  // restore defaults
  await set("s.reader.pageTheme = 'auto'; s.reader.columns = 2; s.reader.fontFamily = 'Literata'; s.reader.flow = 'paginated'")
  await page.evaluate(() => window.__bc.ui.getState().navigate({ name: 'library', filter: { kind: 'all' } }))
  await wait(800)
}
