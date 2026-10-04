export default async ({ page, shot, wait }) => {
  await page.waitForSelector('.sidebar', { timeout: 15000 })
  await wait(800)
  await shot('smoke-library')
}
