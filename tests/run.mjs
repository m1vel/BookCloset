// Playwright harness: launches the built app with an isolated data dir and runs a scenario.
// usage: node tests/run.mjs <scenario> [--keep] [--fresh] [--size=1440x900]
import { _electron as electron } from 'playwright'
import { mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const scenario = process.argv[2] ?? 'smoke'
const flags = process.argv.slice(3)
const sizeArg = flags.find(f => f.startsWith('--size='))?.slice(7) ?? '1440x900'
const [W, H] = sizeArg.split('x').map(Number)
const dataDir = join(root, 'tests', '.data', flags.find(f => f.startsWith('--data='))?.slice(7) ?? 'default')
if (flags.includes('--fresh')) rmSync(dataDir, { recursive: true, force: true })
mkdirSync(dataDir, { recursive: true })
const shotsDir = join(root, 'tests', 'shots')
mkdirSync(shotsDir, { recursive: true })

const env = { ...process.env, BC_USER_DATA: dataDir, BC_TEST: '1' }
delete env.ELECTRON_RUN_AS_NODE // set by VS Code terminals; would start Electron as plain Node
const exe = flags.includes('--exe') ? join(root, 'dist/win-unpacked/BookCloset.exe') : null
const app = await electron.launch(exe
  ? { executablePath: exe, args: [], cwd: root, env }
  : { args: [join(root, 'out/main/index.js')], cwd: root, env })
const page = await app.firstWindow()
const logs = []
page.on('console', m => { if ((m.type() === 'error' || m.type() === 'warning') && !m.text().includes('can escape its sandboxing')) logs.push(`[${m.type()}] ${m.text()}`) })
page.on("pageerror", e => logs.push(`[pageerror] ${e.stack ?? e.message}`))
await page.waitForLoadState('domcontentloaded')
await app.evaluate(({ BrowserWindow }, [w, h]) => {
  const win = BrowserWindow.getAllWindows()[0]
  win.unmaximize()
  win.setContentSize(w, h)
  win.setPosition(-12000, 0) // off-screen: tests must not cover or focus over the user's apps
}, [W, H])
await page.waitForTimeout(600)

const shot = async (name, opts = {}) => {
  const p = join(shotsDir, `${name}.png`)
  await page.screenshot({ path: p, ...opts })
  console.log('shot →', p)
}
const ctx = { app, page, shot, root, dataDir, wait: ms => page.waitForTimeout(ms) }
try {
  const mod = await import(`./scenarios/${scenario}.mjs`)
  await mod.default(ctx)
} catch (e) {
  console.error('SCENARIO FAILED:', e)
  await shot(`${scenario}-failure`).catch(() => {})
  process.exitCode = 1
} finally {
  if (logs.length) console.log('--- console ---\n' + logs.slice(-40).join('\n'))
  if (!flags.includes('--keep')) await app.close()
}
