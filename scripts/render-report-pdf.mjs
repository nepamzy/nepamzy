// Renders an HTML file to PDF with the Chromium that Playwright already uses (no extra dependency).
// usage: node scripts/render-report-pdf.mjs <input.html> <output.pdf>
import { existsSync } from 'node:fs'
import { chromium } from '@playwright/test'
const [input, output] = process.argv.slice(2)
const exe = [
  process.env.PLAYWRIGHT_CHROMIUM_PATH,
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
].find((p) => p && existsSync(p))
const b = await chromium.launch(exe ? { executablePath: exe } : {})
const p = await b.newPage()
await p.goto(`file://${input}`, { waitUntil: 'load' })
await p.pdf({
  path: output,
  format: 'A4',
  landscape: true,
  printBackground: true,
  margin: { top: '12mm', bottom: '14mm', left: '12mm', right: '12mm' },
  displayHeaderFooter: true,
  headerTemplate: '<div></div>',
  footerTemplate:
    '<div style="font-size:8px;width:100%;text-align:center">AFIT Market visual audit - synthetic data - page <span class="pageNumber"></span>/<span class="totalPages"></span></div>',
})
await b.close()
