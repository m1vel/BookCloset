const open = async (page, wait, pred) => {
  const id = await page.evaluate(src => {
    const f = new Function('b', `return (${src})(b)`)
    return window.__bc.lib.getState().books.find(b => f(b))?.id
  }, pred.toString())
  await page.evaluate(id => window.__bc.openBookById(id), id)
  await page.waitForSelector('.paged-scroll', { timeout: 20000 })
  await wait(2500)
}

export default async ({ page, shot, wait }) => {
  await page.waitForSelector('.sidebar', { timeout: 15000 })
  await page.evaluate(() => window.__bc.settings.getState().update(s => { s.uiTheme = 'paper'; s.reader.pageTheme = 'auto' }))
  for (const [name, pred] of [
    ['djvu', b => b.format === 'djvu'],
    ['pdf', b => b.format === 'pdf' && b.fileName.startsWith('Пушкин')],
  ]) {
    await open(page, wait, pred)
    await page.mouse.move(720, 500)
    await page.mouse.wheel(0, 1400)
    await wait(2500)
    await page.mouse.move(400, 400)
    await page.mouse.down()
    await page.mouse.move(1000, 450, { steps: 16 })
    await page.mouse.up()
    await wait(600)
    await shot(`ps-${name}-select`)
    const dot = await page.$('.sel-dot >> nth=1')
    if (dot) { await dot.click(); await wait(500) }
    await page.mouse.move(720, 600)
    await wait(300)
    await shot(`ps-${name}-highlight`)
    await page.evaluate(() => window.__bc.ui.getState().navigate({ name: 'library', filter: { kind: 'all' } }))
    await wait(500)
  }
}
