// Autoscroll & focus mode: timed page turns, pause, smooth scrolling, the reading ruler, PDF scroll mode.
const meta = page => page.evaluate(() => document.querySelector('.rb-meta')?.textContent ?? '')
const scrollPos = page => page.evaluate(() => {
  const v = document.querySelector('foliate-view')
  return v?.renderer?.start ?? document.querySelector('.paged-scroll, .pg-scroll, [class*="scroll"]')?.scrollTop ?? -1
})

export default async ({ page, shot, wait }) => {
  await page.waitForSelector('.sidebar', { timeout: 15000 })
  await page.evaluate(() => window.__bc.settings.getState().update(s => {
    s.lang = 'ru'; s.uiTheme = 'paper'; s.schedule.mode = 'off'
    Object.assign(s.reader, { pageTheme: 'auto', flow: 'paginated', columns: 2, fontFamily: 'Literata' })
    s.autoRead = { speed: 120, pageSeconds: 5, ruler: true, rulerLines: 2 }
  }))
  const id = await page.evaluate(() => window.__bc.lib.getState().books.find(b => b.format === 'epub').id)
  await page.evaluate(id => window.__bc.lib.getState().update(id, { location: undefined, progress: 0 }), id)
  await page.evaluate(id => window.__bc.openBookById(id), id)
  await wait(3000)
  await page.keyboard.press('ArrowRight')
  await wait(800)

  // ---- paginated: page timer
  const m0 = await meta(page)
  await page.keyboard.press('s')
  await wait(2600)
  await page.mouse.move(700, 880)
  await wait(300)
  await shot('ar-01-paginated-bar')
  await wait(3200)
  const m1 = await meta(page)
  console.log('paginated turn:', m0, '→', m1, m0 !== m1 ? 'OK' : 'NO TURN')

  // ---- pause with Space
  await page.keyboard.press(' ')
  await wait(6000)
  const m2 = await meta(page)
  console.log('paused keeps page:', m1 === m2 ? 'OK' : `MOVED ${m1} → ${m2}`)
  await page.keyboard.press(' ')
  await wait(300)

  // ---- speed keys
  const before = await page.evaluate(() => window.__bc.settings.getState().settings.autoRead.pageSeconds)
  await page.keyboard.press('Equal')
  await wait(200)
  const afterSec = await page.evaluate(() => window.__bc.settings.getState().settings.autoRead.pageSeconds)
  console.log('faster (s/page):', before, '→', afterSec)

  // ---- focus mode + guided ruler in paginated auto-read
  await page.keyboard.press('Minus')
  await wait(200)
  console.log('slower (s/page):', await page.evaluate(() => window.__bc.settings.getState().settings.autoRead.pageSeconds))
  await page.evaluate(() => window.__bc.settings.getState().update(s => { s.autoRead.pageSeconds = 10 }))
  await page.keyboard.press('f')
  await wait(4500)
  await shot('ar-02-focus-guided')
  await page.keyboard.press('s') // stop autoscroll, stay in focus mode
  await wait(300)
  console.log('auto stopped:', !(await page.$('.auto-bar')))

  // ---- ruler follows the pointer and steps with arrows
  await page.mouse.move(600, 300)
  await wait(400)
  const y1 = await page.evaluate(() => document.querySelector('.fr-band')?.getBoundingClientRect().top)
  for (let i = 0; i < 4; i++) { await page.keyboard.press('ArrowDown'); await wait(120) }
  await wait(300)
  const y2 = await page.evaluate(() => document.querySelector('.fr-band')?.getBoundingClientRect().top)
  console.log('ruler: pointer top', Math.round(y1), '→ after 4×↓', Math.round(y2))
  await shot('ar-03-focus-ruler')
  await page.keyboard.press('Escape')
  await wait(300)
  console.log('focus off after Esc:', !(await page.$('.reader.focus-mode')))

  // ---- scrolled flow: smooth autoscroll
  await page.evaluate(() => window.__bc.settings.getState().update(s => { s.reader.flow = 'scrolled' }))
  await wait(2000)
  const f0 = await page.evaluate(() => window.__bc.lib.getState().books.find(b => b.format === 'epub').progress)
  await page.keyboard.press('s')
  for (let i = 0; i < 3; i++) { await wait(1000); console.log('  scroll pos', Math.round(await scrollPos(page))) }
  await wait(2500)
  const f1 = await page.evaluate(() => window.__bc.lib.getState().books.find(b => b.format === 'epub').progress)
  console.log('scrolled: progress', f0.toFixed(4), '→', f1.toFixed(4), f1 > f0 ? 'OK' : 'NO MOVEMENT')
  await page.mouse.move(700, 500)
  await page.keyboard.press('f')
  await wait(800)
  await page.mouse.move(700, 420)
  await wait(600)
  await shot('ar-04-scrolled-focus')
  await page.keyboard.press('Escape') // stops autoscroll
  await page.keyboard.press('Escape') // leaves focus
  await wait(300)

  // ---- midnight theme bar
  await page.evaluate(() => window.__bc.settings.getState().update(s => { s.uiTheme = 'midnight'; s.reader.flow = 'paginated' }))
  await wait(1500)
  await page.keyboard.press('s')
  await wait(1500)
  await page.mouse.move(700, 880)
  await wait(400)
  await shot('ar-05-midnight-bar')
  await page.keyboard.press('Escape')
  await page.evaluate(() => window.__bc.settings.getState().update(s => { s.uiTheme = 'paper' }))

  // ---- PDF in scroll mode (also checks one arrow press = one page in paged layouts)
  await page.evaluate(() => window.__bc.ui.getState().navigate({ name: 'library', filter: { kind: 'all' } }))
  await wait(500)
  const pdf = await page.evaluate(() => window.__bc.lib.getState().books.find(b => b.format === 'pdf' && b.title.startsWith('Attention')).id)
  await page.evaluate(() => window.__bc.settings.getState().update(s => { s.paged.mode = 'scroll' }))
  await page.evaluate(id => window.__bc.openBookById(id), pdf)
  await wait(3500)
  const p0 = await page.evaluate(() => document.querySelector('.paged-scroll')?.scrollTop ?? -1)
  await page.keyboard.press('s')
  await wait(3000)
  const p1 = await page.evaluate(() => document.querySelector('.paged-scroll')?.scrollTop ?? -1)
  console.log('pdf scroll:', Math.round(p0), '→', Math.round(p1), p1 - p0 > 200 ? 'OK' : 'TOO SLOW')
  await shot('ar-06-pdf-scroll')
  await page.keyboard.press('Escape')

  // ---- one key press = one page in the paged engine (it forwards keydown and the event also bubbles)
  await page.evaluate(() => window.__bc.settings.getState().update(s => { s.paged.mode = 'single'; s.paged.fit = 'page' }))
  await page.evaluate(id => window.__bc.lib.getState().update(id, { location: 0, progress: 0 }), pdf)
  await page.evaluate(() => window.__bc.ui.getState().navigate({ name: 'library', filter: { kind: 'all' } }))
  await wait(400)
  await page.evaluate(id => window.__bc.openBookById(id), pdf)
  await wait(3000)
  const pg0 = await meta(page)
  await page.keyboard.press('ArrowRight')
  await wait(900)
  const pg1 = await meta(page)
  console.log('pdf one arrow:', pg0.match(/\d+ из \d+/)?.[0], '→', pg1.match(/\d+ из \d+/)?.[0])
}
