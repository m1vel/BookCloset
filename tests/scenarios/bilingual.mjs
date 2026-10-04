// Bilingual mode: paragraph translations under the original, CFIs unaffected, cache, toggle (B), themes.
const docEval = (page, fn, arg) => page.evaluate(([src, a]) => {
  const v = document.querySelector('foliate-view')
  const c = v.renderer.getContents()[0]
  return new Function('v', 'c', 'doc', 'a', `return (${src})(v, c, doc, a)`)(v, c, c.doc, a)
}, [fn.toString(), arg])

export default async ({ page, shot, wait }) => {
  await page.waitForSelector('.sidebar', { timeout: 15000 })
  await page.evaluate(() => window.__bc.settings.getState().update(s => {
    s.lang = 'ru'; s.uiTheme = 'paper'; s.schedule.mode = 'off'
    Object.assign(s.reader, { pageTheme: 'auto', flow: 'paginated', columns: 2, fontFamily: 'Literata' })
    Object.assign(s.translation, { enabled: true, provider: 'free', bilingual: false, bilingualLang: 'ru' })
  }))
  const id = await page.evaluate(() => window.__bc.lib.getState().books.find(b => b.format === 'epub').id)
  await page.evaluate(id => window.__bc.lib.getState().update(id, { location: undefined, progress: 0 }), id)
  await page.evaluate(id => window.__bc.openBookById(id), id)
  await wait(3200)
  for (let i = 0; i < 4; i++) { await page.keyboard.press('ArrowRight'); await wait(350) }
  await wait(600)

  // CFI of a few positions without translations
  const probe = (v, c, doc) => {
    const ps = [...doc.querySelectorAll('p')].filter(p => p.textContent.trim().length > 80).slice(0, 3)
    return ps.map(p => {
      const t = [...p.childNodes].find(n => n.nodeType === 3 && n.data.trim())
      const r = doc.createRange(); r.setStart(t, 5); r.collapse(true)
      return v.getCFI(c.index, r)
    })
  }
  const before = await docEval(page, probe)
  const loc0 = await page.evaluate(id => window.__bc.lib.getState().books.find(b => b.id === id).location, id)

  // ---- turn on with B
  const t0 = Date.now()
  await page.keyboard.press('b')
  await wait(600)
  await shot('bi-01-translating')
  await page.waitForFunction(() => {
    const d = document.querySelector('foliate-view').renderer.getContents()[0].doc
    return d.querySelectorAll('[data-bc-tr]').length > 10 && !document.querySelector('.bi-status')
  }, null, { timeout: 90000 })
  const ms1 = Date.now() - t0
  await wait(1200)
  const count = await docEval(page, (v, c, doc) => doc.querySelectorAll('[data-bc-tr]').length)
  const sample = await docEval(page, (v, c, doc) => [...doc.querySelectorAll('[data-bc-tr]')].slice(3, 5).map(e => e.parentElement.textContent.slice(0, 40).replace(/\s+/g, ' ') + ' => ' + e.textContent.slice(0, 60)))
  console.log(`translated paragraphs: ${count} in ${ms1} ms`)
  console.log(sample.join('\n'))
  await page.mouse.move(700, 450)
  await shot('bi-02-paginated')

  // CFIs with translations present are the same; a point inside a translation maps to its paragraph
  const after = await docEval(page, probe)
  console.log('CFIs unchanged:', JSON.stringify(before) === JSON.stringify(after))
  const inside = await docEval(page, (v, c, doc) => {
    const tr = doc.querySelector('[data-bc-tr]')
    const r = doc.createRange(); r.setStart(tr.firstChild, 3); r.collapse(true)
    const back = v.resolveCFI(v.getCFI(c.index, r)).anchor(doc)
    return { cfi: v.getCFI(c.index, r), resolvesInto: back.startContainer.parentElement === tr.parentElement || back.startContainer === tr.parentElement }
  })
  console.log('point inside translation ->', JSON.stringify(inside))
  await wait(1500)
  const loc1 = await page.evaluate(id => window.__bc.lib.getState().books.find(b => b.id === id).location, id)
  console.log('saved location before/after:', loc0, '|', loc1)

  // ---- off and on again: second time comes from the cache
  await page.keyboard.press('b')
  await wait(800)
  console.log('removed on toggle off:', await docEval(page, (v, c, doc) => doc.querySelectorAll('[data-bc-tr]').length) === 0)
  const t1 = Date.now()
  await page.keyboard.press('b')
  await page.waitForFunction(n => {
    const d = document.querySelector('foliate-view').renderer.getContents()[0].doc
    return d.querySelectorAll('[data-bc-tr]').length >= n
  }, count, { timeout: 30000 })
  console.log(`cached re-apply: ${Date.now() - t1} ms`)

  // ---- next chapter gets translated on load
  await page.evaluate(() => document.querySelector('foliate-view').renderer.nextSection())
  await page.waitForFunction(() => {
    const d = document.querySelector('foliate-view').renderer.getContents()[0].doc
    return d.querySelectorAll('[data-bc-tr]').length > 5
  }, null, { timeout: 60000 }).catch(() => {})
  await wait(800)
  const chapter = await page.evaluate(() => document.querySelector('.rt-chapter')?.textContent)
  console.log('chapter:', chapter, '| translations:', await docEval(page, (v, c, doc) => doc.querySelectorAll('[data-bc-tr]').length))

  // ---- scrolled flow in midnight + the appearance popover section
  await page.evaluate(() => window.__bc.settings.getState().update(s => { s.uiTheme = 'midnight'; s.reader.flow = 'scrolled' }))
  await wait(2500)
  await page.mouse.move(700, 450)
  await shot('bi-03-scrolled-midnight')
  await page.evaluate(() => window.__bc.settings.getState().update(s => { s.uiTheme = 'paper'; s.reader.flow = 'paginated' }))
  await wait(1500)
  await page.mouse.move(700, 20)
  await wait(300)
  await page.click('.reader-top button[aria-label="Оформление"]')
  await wait(500)
  await page.evaluate(() => document.querySelector('.appearance-pop')?.scrollTo(0, 99999))
  await wait(300)
  await shot('bi-04-popover')
  await page.keyboard.press('Escape')
  await page.evaluate(() => window.__bc.settings.getState().update(s => { s.translation.bilingual = false }))
  await wait(800) // let the setting reach settings.json so later scenarios start without translations
}
