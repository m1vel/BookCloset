// Vocabulary & flashcards: add a word from the translation popover, list, review session (SM-2), Anki export.
export default async ({ page, shot, wait }) => {
  await page.waitForSelector('.sidebar', { timeout: 15000 })
  await page.evaluate(() => window.__bc.settings.getState().update(s => {
    s.lang = 'ru'; s.uiTheme = 'paper'; s.schedule.mode = 'off'
    Object.assign(s.reader, { pageTheme: 'auto', flow: 'paginated', columns: 2, fontFamily: 'Literata' })
    Object.assign(s.translation, { enabled: true, provider: 'free', targetLang: 'ru', autoWord: true, bilingual: false })
  }))
  // start from an empty vocabulary
  await page.evaluate(async () => {
    const v = window.__bc.vocab.getState()
    await v.load()
    for (const e of [...window.__bc.vocab.getState().entries]) window.__bc.vocab.getState().remove(e.id)
  })
  await page.evaluate(() => window.__bc.ui.getState().navigate({ name: 'vocab' }))
  await wait(800)
  await shot('voc-01-empty')

  // ---- add a word from the reader
  const id = await page.evaluate(() => window.__bc.lib.getState().books.find(b => b.format === 'epub').id)
  await page.evaluate(id => window.__bc.lib.getState().update(id, { location: undefined, progress: 0 }), id)
  await page.evaluate(id => window.__bc.openBookById(id), id)
  await wait(3200)
  for (let i = 0; i < 4; i++) { await page.keyboard.press('ArrowRight'); await wait(350) }
  await wait(600)
  await page.mouse.dblclick(820, 420)
  await page.waitForSelector('.tr-pop', { timeout: 10000 })
  await page.waitForFunction(() => !document.querySelector('.tr-skeleton'), null, { timeout: 30000 }).catch(() => {})
  await wait(500)
  const addBtn = await page.$('.tr-foot button:has-text("В словарь")')
  if (!addBtn) throw new Error('no "add to vocabulary" button')
  await addBtn.click()
  await wait(500)
  console.log('button after add:', await page.textContent('.tr-foot .tr-saved').catch(() => '?'))
  await shot('voc-02-popover-added')
  const added = await page.evaluate(() => window.__bc.vocab.getState().entries[0])
  console.log('added:', added && { term: added.term, translation: added.translation, lang: added.lang, context: added.context?.slice(0, 80), meanings: added.meanings?.slice(0, 60), book: added.bookTitle })
  await page.keyboard.press('Escape')

  // ---- a few more words (one learned long ago, one due tomorrow)
  await page.evaluate(bookId => {
    const v = window.__bc.vocab.getState()
    const day = 86400000
    const mk = (term, translation, context, lang = 'en', target = 'ru') => v.add({ term, translation, context, lang, target, bookId, bookTitle: "Alice's Adventures in Wonderland" })
    mk('rabbit-hole', 'кроличья нора', 'In another moment down went Alice after it, never once considering how in the world she was to get out again; the rabbit-hole went straight on like a tunnel.')
    mk('marmalade', 'мармелад, джем', 'She took down a jar from one of the shelves as she passed; it was labelled “ORANGE MARMALADE”.')
    const learned = mk('curious', 'любопытный, странный', '“Curiouser and curiouser!” cried Alice.')
    v.update(learned.id, { srs: { due: Date.now() + 40 * day, interval: 30, ease: 2.6, reps: 5, lapses: 0 } })
    const later = mk('waistcoat', 'жилет', 'a White Rabbit with pink eyes took a watch out of its waistcoat-pocket')
    v.update(later.id, { srs: { due: Date.now() + day, interval: 1, ease: 2.5, reps: 1, lapses: 0 } })
    mk('сударь', 'sir', '— Ну, сударь, — сказал он, — что ты скажешь?', 'ru', 'en')
  }, id)
  await page.evaluate(() => window.__bc.ui.getState().navigate({ name: 'vocab' }))
  await wait(900)
  console.log('sidebar badge:', await page.textContent('.nav-item:has-text("Словарь") .nav-count').catch(() => '-'))
  await shot('voc-03-list')

  // ---- review session
  await page.click('.vh-main .btn.primary')
  await page.waitForSelector('.flashcard', { timeout: 5000 })
  await wait(600)
  await shot('voc-04-card-front')
  await page.keyboard.press(' ')
  await wait(400)
  await shot('voc-05-card-back')
  const first = await page.textContent('.fc-term')
  await page.keyboard.press('3') // good
  await wait(400)
  const second = await page.textContent('.fc-term')
  await page.keyboard.press(' ')
  await page.keyboard.press('1') // again -> back of the queue
  await wait(300)
  let guard = 0
  while (await page.$('.flashcard') && guard++ < 12) {
    await page.keyboard.press(' ')
    await wait(150)
    await page.keyboard.press('3')
    await wait(250)
  }
  await wait(400)
  await shot('voc-06-done')
  const srs = await page.evaluate(([a, b]) => {
    const all = window.__bc.vocab.getState().entries
    const f = t => all.find(e => t.includes(e.term))
    const day = 86400000
    const x = f(a), y = f(b)
    return { [x.term]: { interval: x.srs.interval, inDays: +((x.srs.due - Date.now()) / day).toFixed(2) }, [y.term]: { interval: y.srs.interval, lapses: y.srs.lapses, reps: y.srs.reps, inDays: +((y.srs.due - Date.now()) / day).toFixed(2) } }
  }, [first, second])
  console.log('after review:', JSON.stringify(srs))

  // ---- midnight
  await page.evaluate(() => window.__bc.settings.getState().update(s => { s.uiTheme = 'midnight' }))
  await page.click('.review-done .btn.primary')
  await wait(700)
  await shot('voc-07-list-midnight')
  await page.evaluate(() => window.__bc.settings.getState().update(s => { s.uiTheme = 'paper' }))

  // ---- Anki export text
  const anki = await page.evaluate(() => window.__bc.vocabExport(window.__bc.vocab.getState().entries.slice(0, 2)))
  console.log('anki export:\n' + anki)
}
