// Keyed providers: encrypted key storage and error mapping with deliberately invalid keys.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export default async ({ page, dataDir }) => {
  await page.waitForSelector('.sidebar', { timeout: 15000 })
  const fake = { deepl: 'not-a-real-key:fx', claude: 'sk-ant-invalid-test-key', openai: 'sk-invalid-test-key', yandex: 'AQVN-invalid-test-key' }
  for (const [provider, key] of Object.entries(fake)) {
    const status = await page.evaluate(([p, k]) => window.bc.translate.setKey(p, k), [provider, key])
    const res = await page.evaluate(p => window.bc.translate.run({ text: 'Hello, world', to: 'ru', from: 'auto', provider: p }), provider)
    console.log(provider.padEnd(7), 'stored:', status[provider].hint, '→', res.ok ? 'OK ' + res.result.text : `${res.code}: ${res.message.slice(0, 90)}`)
  }
  const raw = readFileSync(join(dataDir, 'secrets.json'), 'utf8')
  console.log('secrets.json encrypted:', !raw.includes('sk-ant-invalid'), raw.slice(0, 60) + '…')
  const settings = readFileSync(join(dataDir, 'settings.json'), 'utf8')
  console.log('settings.json contains keys:', /sk-ant|not-a-real-key/.test(settings))
  for (const provider of Object.keys(fake)) await page.evaluate(p => window.bc.translate.setKey(p, ''), provider)
  console.log('after removal:', JSON.stringify(await page.evaluate(() => window.bc.translate.keyStatus())))
}
