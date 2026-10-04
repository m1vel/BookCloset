// AI assistant: setup state, recap/explain/who/ask with a mock streamed model (BC_TEST + "test-mock-key"),
// spoiler boundary = end of the current page, stop, invalid key error, PDF context.
const lastTurn = page => page.evaluate(() => {
  const t = [...document.querySelectorAll('.ai-turn')].pop()
  return t ? { cls: t.className, q: t.querySelector('.ai-q')?.textContent, a: t.querySelector('.ai-a')?.textContent?.replace(/\s+/g, ' ').slice(0, 400), err: t.querySelector('.ai-error')?.textContent?.slice(0, 160) } : null
})
const waitDone = page => page.waitForFunction(() => {
  const t = [...document.querySelectorAll('.ai-turn')].pop()
  return t && (t.classList.contains('done') || t.classList.contains('error'))
}, null, { timeout: 30000 })
const openBook = async (page, wait, pred) => {
  const id = await page.evaluate(src => {
    const f = new Function('b', `return (${src})(b)`)
    return window.__bc.lib.getState().books.find(b => f(b))?.id
  }, pred.toString())
  await page.evaluate(id => window.__bc.lib.getState().update(id, { location: undefined, progress: 0 }), id)
  await page.evaluate(() => window.__bc.ui.getState().navigate({ name: 'library', filter: { kind: 'all' } }))
  await wait(300)
  await page.evaluate(id => window.__bc.openBookById(id), id)
  await wait(3200)
}

export default async ({ page, shot, wait }) => {
  await page.waitForSelector('.sidebar', { timeout: 15000 })
  await page.evaluate(() => window.__bc.settings.getState().update(s => {
    s.lang = 'ru'; s.uiTheme = 'paper'; s.schedule.mode = 'off'
    Object.assign(s.reader, { pageTheme: 'auto', flow: 'paginated', columns: 2, fontFamily: 'Literata' })
    Object.assign(s.translation, { provider: 'free', bilingual: false })
    s.paged.mode = 'single'; s.paged.fit = 'page'
  }))
  await page.evaluate(async () => { await window.bc.translate.setKey('claude', ''); await window.bc.translate.setKey('openai', '') })

  // ---- no key: setup prompt
  await openBook(page, wait, b => b.format === 'epub')
  for (let i = 0; i < 5; i++) { await page.keyboard.press('ArrowRight'); await wait(350) }
  await page.keyboard.press('a')
  await wait(700)
  console.log('setup shown:', !!(await page.$('.ai-setup')))
  await shot('ai-01-setup')
  await page.keyboard.press('a')

  // ---- mock model
  await page.evaluate(() => window.bc.translate.setKey('claude', 'test-mock-key'))
  await page.keyboard.press('a')
  await wait(600)
  await page.click('.ai-quick .chip:has-text("Пересказ")')
  await wait(400)
  await shot('ai-02-streaming')
  await waitDone(page)
  const recap = await lastTurn(page)
  const pageEnd = await page.evaluate(() => {
    const v = document.querySelector('foliate-view')
    const doc = v.renderer.getContents()[0].doc
    const r = doc.createRange(); r.setStart(doc.body, 0)
    const last = v.lastLocation?.range
    return last ? last.toString().replace(/­/g, '').replace(/\s+/g, ' ').trim().slice(-50) : null
  })
  console.log('recap:', JSON.stringify(recap))
  console.log('visible page ends with:', JSON.stringify(pageEnd))
  await wait(300)
  await shot('ai-03-recap')

  // ---- explain a selection, then "who is this" on a name
  await page.keyboard.press('a') // close panel to select text
  await wait(400)
  await page.mouse.move(160, 420); await page.mouse.down(); await page.mouse.move(520, 470, { steps: 12 }); await page.mouse.up()
  await wait(500)
  await page.click('.sel-menu button[aria-label="Объяснить (AI)"]')
  await wait(300)
  await waitDone(page)
  console.log('explain:', JSON.stringify(await lastTurn(page)))
  await page.click('.ai-quick .chip:has-text("Кто это?")')
  await page.fill('.ai-who input', 'Белый Кролик')
  await page.keyboard.press('Enter')
  await waitDone(page)
  console.log('who:', JSON.stringify(await lastTurn(page)))

  // ---- free question with history
  await page.fill('.ai-input textarea', 'Почему Алиса последовала за Кроликом?')
  await page.keyboard.press('Enter')
  await waitDone(page)
  console.log('ask:', JSON.stringify(await lastTurn(page)))
  await shot('ai-04-conversation')

  // ---- stop while streaming
  await page.click('.ai-quick .chip:has-text("Пересказ")')
  await wait(350)
  await page.click('.ai-send')
  await waitDone(page)
  console.log('stopped:', JSON.stringify(await lastTurn(page)))

  // ---- midnight
  await page.evaluate(() => window.__bc.settings.getState().update(s => { s.uiTheme = 'midnight' }))
  await wait(600)
  await shot('ai-05-midnight')
  await page.evaluate(() => window.__bc.settings.getState().update(s => { s.uiTheme = 'paper' }))

  // ---- invalid real key -> authentication error from the API
  await page.evaluate(() => window.bc.translate.setKey('claude', 'sk-ant-api03-invalid-key-for-testing'))
  await page.click('.ai-quick .chip:has-text("Пересказ")')
  await waitDone(page)
  console.log('invalid key:', JSON.stringify(await lastTurn(page)))
  await shot('ai-06-auth-error')

  // ---- PDF context
  await page.evaluate(() => window.bc.translate.setKey('claude', 'test-mock-key'))
  await page.keyboard.press('a')
  await openBook(page, wait, b => b.format === 'pdf' && b.title.startsWith('Attention'))
  for (let i = 0; i < 2; i++) { await page.keyboard.press('ArrowRight'); await wait(500) }
  await page.keyboard.press('a')
  await wait(500)
  await page.click('.ai-quick .chip:has-text("Пересказ")')
  await waitDone(page)
  console.log('pdf recap:', JSON.stringify(await lastTurn(page)))
  await page.evaluate(async () => { await window.bc.translate.setKey('claude', '') })
}
