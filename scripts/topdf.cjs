// Renders an HTML file to PDF with Chromium (used to produce test PDFs).
// usage: electron scripts/topdf.cjs <in.html> <out.pdf>
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

const [src, out] = process.argv.slice(-2).map(p => path.resolve(p))
setTimeout(() => { console.error('timeout'); app.exit(2) }, 90_000)
app.whenReady().then(async () => {
  console.log('loading', src)
  const w = new BrowserWindow({ show: false, webPreferences: { offscreen: false } })
  await w.loadURL('file:///' + src.replace(/\\/g, '/'))
  console.log('loaded')
  const pdf = await w.webContents.printToPDF({
    pageSize: 'A5',
    margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 },
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate: '<div style="font-size:8px;width:100%;text-align:center"><span class="pageNumber"></span></div>',
  })
  fs.writeFileSync(out, pdf)
  console.log('written', out, pdf.length)
  app.exit(0)
})
