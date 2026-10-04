// Read aloud (silent in BC_TEST): voices, sentence/word highlight, skipping, pause, voice & sleep menus,
// Russian FB2, PDF text layer, "read from here" on a selection.
const said = page => page.evaluate(() => (window.__bcSpoken ?? '').slice(0, 90))
const spoken = page => page.evaluate(() => {
  const v = document.querySelector('foliate-view')
  const docs = [document]
  const d = v?.renderer?.getContents?.()[0]?.doc
  if (d) docs.unshift(d)
  for (const doc of docs) {
    const h = doc.defaultView?.CSS?.highlights?.get('bc-tts')
    if (h && h.size) return [...h][0].toString().replace(/\s+/g, ' ').slice(0, 90)
  }
  return null
})
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
    s.paged.mode = 'single'; s.paged.fit = 'width'
    s.tts = { rate: 2, voices: {} }
  }))
  const voices = await page.evaluate(() => new Promise(res => {
    const get = () => speechSynthesis.getVoices().map(v => `${v.name} [${v.lang}]${v.localService ? '' : ' (net)'}`)
    if (speechSynthesis.getVoices().length) return res(get())
    speechSynthesis.addEventListener('voiceschanged', () => res(get()), { once: true })
    setTimeout(() => res(get()), 3000)
  }))
  console.log('voices:', voices)

  // ---- English EPUB
  await openBook(page, wait, b => b.format === 'epub')
  for (let i = 0; i < 4; i++) { await page.keyboard.press('ArrowRight'); await wait(350) }
  await wait(600)
  await page.keyboard.press('r')
  await page.waitForSelector('.tts-bar', { timeout: 5000 })
  await wait(1200)
  const s1 = await spoken(page)
  console.log('sentence 1:', s1)
  await page.mouse.move(700, 880)
  await wait(300)
  await shot('tts-01-epub-reading')
  await wait(3000)
  const s2 = await spoken(page)
  console.log('advanced on its own:', s1 !== s2, '|', s2)
  await page.click('.tts-bar button[aria-label="Следующее предложение"]')
  await wait(700)
  const s3 = await spoken(page)
  console.log('next sentence:', s2 !== s3, '|', s3)
  await page.keyboard.press(' ')
  await wait(400)
  const p1 = await spoken(page)
  await wait(2500)
  console.log('paused (no advance):', p1 === await spoken(page), '| bar shows play:', !!(await page.$('.tts-bar .auto-play[aria-label="Продолжить"]')))
  await page.keyboard.press(' ')
  await wait(500)
  await page.click('.tts-chip')
  await wait(400)
  await shot('tts-02-voices')
  await page.keyboard.press('Escape')
  await wait(200)
  await page.click('.tts-bar button[aria-label="Таймер сна"]')
  await wait(300)
  await page.click('.menu-item:has-text("Через 15 мин")')
  await wait(300)
  await page.mouse.move(700, 880)
  await wait(300)
  await shot('tts-03-sleep')
  await page.click('.tts-bar button[aria-label="Остановить чтение"]')
  await wait(400)
  console.log('stopped, highlight cleared:', !(await page.$('.tts-bar')), (await spoken(page)) === null)

  // ---- read from a selection
  await page.mouse.move(160, 420)
  await page.mouse.down()
  await page.mouse.move(420, 450, { steps: 12 })
  await page.mouse.up()
  await wait(500)
  const selected = await page.evaluate(() => document.querySelector('foliate-view').renderer.getContents()[0].doc.getSelection().toString().slice(0, 60))
  const btn = await page.$('.sel-menu button[aria-label="Читать вслух отсюда"]')
  if (btn) {
    await btn.click()
    await wait(1000)
    console.log('read from selection:', JSON.stringify(selected), '→', await spoken(page))
    await page.keyboard.press('Escape')
  } else console.log('no read-from button (no selection?)')

  // ---- Russian FB2 in the midnight theme
  await page.evaluate(() => window.__bc.settings.getState().update(s => { s.uiTheme = 'midnight' }))
  await openBook(page, wait, b => b.format === 'fb2' && b.hasCover)
  for (let i = 0; i < 3; i++) { await page.keyboard.press('ArrowRight'); await wait(350) }
  await page.keyboard.press('r')
  await page.waitForSelector('.tts-bar', { timeout: 5000 })
  await wait(1500)
  console.log('ru sentence:', await spoken(page), '| voice chip:', await page.textContent('.tts-chip'))
  await page.mouse.move(700, 880)
  await wait(300)
  await shot('tts-04-fb2-midnight')
  await page.keyboard.press('Escape')
  await page.evaluate(() => window.__bc.settings.getState().update(s => { s.uiTheme = 'paper' }))

  // ---- PDF text layer
  await openBook(page, wait, b => b.format === 'pdf' && b.title.startsWith('Attention'))
  await page.keyboard.press('r')
  await page.waitForSelector('.tts-bar', { timeout: 5000 })
  await wait(2500)
  console.log('pdf sentence (highlight):', await spoken(page))
  console.log('pdf sentence (spoken):', await said(page))
  await shot('tts-05-pdf')
  await page.keyboard.press('Escape')

  // ---- comics: nothing to read
  await openBook(page, wait, b => b.format === 'cbz')
  await page.keyboard.press('r')
  await wait(1500)
  console.log('comic toast:', await page.evaluate(() => [...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | ')))
}
