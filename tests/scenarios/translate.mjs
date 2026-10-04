// Selection translation: phrase, single word (double-click), Russian → English auto-switch, error state, settings, PDF.
const openBook = async (page, wait, pred) => {
  const id = await page.evaluate(src => {
    const f = new Function('b', `return (${src})(b)`)
    return window.__bc.lib.getState().books.find(b => f(b))?.id
  }, pred.toString())
  // start from the beginning so positions are deterministic between runs
  await page.evaluate(id => window.__bc.lib.getState().update(id, { location: undefined, progress: 0 }), id)
  await page.evaluate(id => window.__bc.openBookById(id), id)
  await wait(3000)
}
const waitTranslation = async (page) => {
  await page.waitForSelector('.tr-pop', { timeout: 10000 })
  await page.waitForFunction(() => !document.querySelector('.tr-skeleton'), null, { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(400)
}
const drag = async (page, a, b) => {
  await page.mouse.move(a[0], a[1])
  await page.mouse.down()
  await page.mouse.move(b[0], b[1], { steps: 14 })
  await page.mouse.up()
  await page.waitForTimeout(500)
}

export default async ({ page, shot, wait }) => {
  await page.waitForSelector('.sidebar', { timeout: 15000 })
  await page.evaluate(() => window.__bc.settings.getState().update(s => {
    s.lang = 'ru'; s.uiTheme = 'paper'
    Object.assign(s.reader, { pageTheme: 'auto', flow: 'paginated', columns: 2, fontFamily: 'Literata' })
    Object.assign(s.translation, { enabled: true, provider: 'free', targetLang: 'ru', autoWord: false, bilingual: false })
  }))

  // ---- English phrase from Alice
  await openBook(page, wait, b => b.format === 'epub')
  for (let i = 0; i < 4; i++) { await page.keyboard.press('ArrowRight'); await wait(400) }
  await wait(800)
  await drag(page, [160, 300], [600, 360])
  await shot('tr-01-selection-menu')
  const btn = await page.$('.sel-btn:has-text("Перевести")')
  if (!btn) throw new Error('no translate button')
  await btn.click()
  await waitTranslation(page)
  await shot('tr-02-phrase')
  console.log('phrase:', (await page.textContent('.tr-text').catch(() => '?'))?.slice(0, 120))
  await page.keyboard.press('Escape')
  await wait(300)

  // ---- single word on double-click (autoWord)
  await page.evaluate(() => window.__bc.settings.getState().update(s => { s.translation.autoWord = true }))
  await wait(300)
  await page.mouse.dblclick(820, 420)
  await waitTranslation(page)
  await shot('tr-03-word')
  console.log('word:', await page.textContent('.tr-source').catch(() => '?'), '→', await page.textContent('.tr-text').catch(() => '?'))
  await page.keyboard.press('Escape')
  await page.evaluate(() => window.__bc.settings.getState().update(s => { s.translation.autoWord = false }))

  // ---- error state: Claude without a key
  await page.evaluate(() => window.__bc.settings.getState().update(s => { s.translation.provider = 'claude' }))
  await drag(page, [160, 420], [500, 450])
  await (await page.$('.sel-btn:has-text("Перевести")'))?.click()
  await waitTranslation(page)
  await shot('tr-04-no-key')
  await page.keyboard.press('Escape')
  await page.evaluate(() => window.__bc.settings.getState().update(s => { s.translation.provider = 'free' }))
  await page.evaluate(() => window.__bc.ui.getState().navigate({ name: 'library', filter: { kind: 'all' } }))
  await wait(500)

  // ---- Russian text → auto-switch to English
  await openBook(page, wait, b => b.format === 'fb2' && !b.fileName.includes('1251'))
  for (let i = 0; i < 3; i++) { await page.keyboard.press('ArrowRight'); await wait(400) }
  await wait(600)
  await drag(page, [780, 200], [1300, 260])
  await page.keyboard.press('Control+t')
  await waitTranslation(page)
  await shot('tr-05-russian')
  console.log('ru→', (await page.textContent('.tr-text').catch(() => '?'))?.slice(0, 120))
  await page.keyboard.press('Escape')
  await page.evaluate(() => window.__bc.ui.getState().navigate({ name: 'library', filter: { kind: 'all' } }))
  await wait(500)

  // ---- PDF (text layer)
  await openBook(page, wait, b => b.format === 'pdf' && b.fileName.startsWith('Attention'))
  await page.mouse.move(720, 500)
  await page.mouse.wheel(0, 1300)
  await wait(2000)
  await drag(page, [560, 420], [1000, 470])
  await (await page.$('.sel-btn:has-text("Перевести")'))?.click()
  await waitTranslation(page)
  await shot('tr-06-pdf')
  await page.keyboard.press('Escape')
  await page.evaluate(() => window.__bc.ui.getState().navigate({ name: 'library', filter: { kind: 'all' } }))
  await wait(400)

  // ---- settings
  await page.evaluate(() => window.__bc.ui.getState().navigate({ name: 'settings' }))
  await wait(800)
  await page.evaluate(() => {
    const h = [...document.querySelectorAll('.set-h')].find(x => x.textContent.includes('Перевод'))
    h?.scrollIntoView({ block: 'start' })
  })
  await wait(400)
  await shot('tr-07-settings-free')
  await page.click('.provider-card:has-text("Claude")')
  await wait(500)
  await shot('tr-08-settings-claude')
  await page.click('.provider-card:has-text("Google")')
  await page.click('button:has-text("Проверить")')
  await page.waitForSelector('.test-result', { timeout: 20000 }).catch(() => {})
  console.log('test:', await page.textContent('.test-result').catch(() => '?'))
}
