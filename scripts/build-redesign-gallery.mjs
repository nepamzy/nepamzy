// Builds gallery.html, page-inventory.md and capture-failures.md for the frontend redesign from the capture inventories
// (what was really rendered, never a hand-written list).
//   UI_AUDIT_BEFORE=redesign-before UI_AUDIT_AFTER=redesign-ch1-after node scripts/build-redesign-gallery.mjs
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = 'artifacts/afit-market-ui-audit'
const BEFORE = process.env.UI_AUDIT_BEFORE ?? 'redesign-before'
const AFTER = process.env.UI_AUDIT_AFTER ?? 'redesign-ch1-after'
const TITLE = process.env.UI_AUDIT_TITLE ?? 'Frontend redesign'
const load = (phase, vp) => {
  const p = join(ROOT, phase, vp, 'inventory.json')
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : []
}
const rel = (f) => (f ? f.replace(`${ROOT}/`, '') : null)
const maskId = (s) =>
  s
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '[id]')
    .replace(/\/receipts\/[0-9a-f]{48}/, '/receipts/[token]')
    .replace(/\/vendors\/shop-[a-z0-9]{6}/, '/vendors/[shop]')
const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  )
const norm = (f) =>
  f
    .replace(/receipts-[0-9a-f]{48}/, 'receipts-TOKEN')
    .replace(/vendors-shop-[a-z0-9]{6}/, 'vendors-SHOP')
const key = (r) => `${r.role}/${norm((r.file ?? '').split('/').pop())}`

const data = {}
for (const [name, phase] of [
  ['before', BEFORE],
  ['after', AFTER],
])
  for (const vp of ['desktop', 'mobile'])
    data[`${name}/${vp}`] = new Map(load(phase, vp).map((r) => [key(r), r]))
const keys = [...new Set(Object.values(data).flatMap((m) => [...m.keys()]))].filter(
  (k) => !k.endsWith('/'),
)
const order = { public: 0, customer: 1, vendor: 2, rider: 3, admin: 4 }
keys.sort(
  (a, b) => (order[a.split('/')[0]] ?? 9) - (order[b.split('/')[0]] ?? 9) || a.localeCompare(b),
)
const row = (k) =>
  data['after/desktop'].get(k) ??
  data['after/mobile'].get(k) ??
  data['before/desktop'].get(k) ??
  data['before/mobile'].get(k)
const img = (name, vp, k) => {
  const r = data[`${name}/${vp}`].get(k)
  return r?.file
    ? `<a href="${esc(rel(r.file))}"><img loading="lazy" src="${esc(rel(r.file))}" alt="${name} ${vp}: ${esc(k)}"></a>`
    : `<div class="none">not captured</div>`
}
const css = `body{font:15px/1.4 system-ui,sans-serif;margin:0;background:#f6f8fc;color:#131c2b}header{padding:16px 20px;background:#0c2a63;color:#fff}
header p{margin:4px 0 0;color:#d6e1f6}main{padding:16px 20px;max-width:1500px;margin:auto}h2{margin:28px 0 8px;border-bottom:3px solid #f4b400;padding-bottom:4px}
article{background:#fff;border:1px solid #cdd6e4;border-radius:10px;padding:12px;margin:14px 0}article h3{margin:0 0 2px;font-size:16px}
.route{font:13px ui-monospace,monospace;color:#44536a;margin-bottom:8px}.grid{display:grid;grid-template-columns:2fr 1fr;gap:12px}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:8px}figure{margin:0}figcaption{font-size:12px;font-weight:600;margin-bottom:4px;color:#44536a}
img{width:100%;height:auto;border:1px solid #cdd6e4;border-radius:6px;display:block}.none{border:1px dashed #70819c;padding:30px 8px;text-align:center;color:#44536a;font-size:13px}
.note{font-size:12px;color:#7a5400}nav a{margin-right:12px}@media(max-width:900px){.grid{grid-template-columns:1fr}}`
let html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AFIT Market ${esc(TITLE)} gallery</title><style>${css}</style>
<header><h1>AFIT Market: ${esc(TITLE)} gallery</h1><p>Synthetic local data only. Before = ${esc(BEFORE)}; After = ${esc(AFTER)}. Desktop 1440x900, mobile 390x844. ${keys.length} pages/states. Provisional palette, not official AFIT branding.</p></header><main><nav>${Object.keys(
  order,
)
  .map((r) => `<a href="#${r}">${r}</a>`)
  .join('')}</nav>`
let cur = ''
for (const k of keys) {
  const role = k.split('/')[0]
  if (role !== cur) {
    cur = role
    html += `<h2 id="${role}">${role[0].toUpperCase() + role.slice(1)}</h2>`
  }
  const r = row(k)
  html += `<article><h3>${esc(r.state)}</h3><div class="route">${esc(maskId(r.route))}${r.note ? `<br><span class="note">${esc(maskId(r.note))}</span>` : ''}</div>
<div class="grid"><div><figure><figcaption>Desktop: before | after</figcaption><div class="cols">${img('before', 'desktop', k)}${img('after', 'desktop', k)}</div></figure></div>
<div><figure><figcaption>Mobile: before | after</figcaption><div class="cols">${img('before', 'mobile', k)}${img('after', 'mobile', k)}</div></figure></div></div></article>`
}
writeFileSync(join(ROOT, 'gallery.html'), html + `</main></html>`)

const yn = (n, vp, k) => (data[`${n}/${vp}`].get(k)?.file ? 'yes' : 'NO')
let md = `# Page inventory (${TITLE})\n\nBuilt from \`${ROOT}/{${BEFORE},${AFTER}}/{desktop,mobile}/inventory.json\`: what was actually rendered. Routes with ids are shown with \`[id]\`. "yes" means a screenshot file exists.\n\n| Role | Route | State | HTTP | Desk before | Desk after | Mob before | Mob after | Note |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n`
for (const k of keys) {
  const r = row(k)
  md += `| ${r.role} | \`${maskId(r.route)}\` | ${r.state} | ${r.http ?? ''} | ${yn('before', 'desktop', k)} | ${yn('after', 'desktop', k)} | ${yn('before', 'mobile', k)} | ${yn('after', 'mobile', k)} | ${maskId(r.note ?? '').replace(/\|/g, '/')} |\n`
}
const missing = keys.filter((k) =>
  ['before', 'after'].some((p) =>
    ['desktop', 'mobile'].some((v) => !data[`${p}/${v}`].get(k)?.file),
  ),
)
md += `\nTotal pages/states: ${keys.length}. Missing in at least one of the four captures: ${missing.length}${missing.length ? ` (${missing.join(', ')})` : ''}.\n`
const counts = (name) =>
  ['desktop', 'mobile']
    .map((v) => `${v}: ${[...data[`${name}/${v}`].values()].filter((r) => r.file).length}`)
    .join(', ')
md += `\nScreenshot counts, before (${BEFORE}): ${counts('before')}. After (${AFTER}): ${counts('after')}.\n`
const byRole = {}
for (const name of ['before', 'after'])
  for (const vp of ['desktop', 'mobile'])
    for (const r of data[`${name}/${vp}`].values())
      if (r.file) byRole[`${name}/${r.role}`] = (byRole[`${name}/${r.role}`] ?? 0) + 1
md += `\nBy role (both viewports): ${Object.entries(byRole)
  .map(([k, v]) => `${k}=${v}`)
  .join(', ')}.\n`
writeFileSync(join(ROOT, 'page-inventory.md'), md)

const failures = []
for (const name of ['before', 'after'])
  for (const vp of ['desktop', 'mobile'])
    for (const r of data[`${name}/${vp}`].values())
      if (!r.file || /FAILED/.test(r.note ?? ''))
        failures.push(
          `- ${name}/${vp}: ${r.role} ${maskId(r.route)} (${r.state}): ${maskId(r.note ?? 'no file')}`,
        )
writeFileSync(
  join(ROOT, 'capture-failures.md'),
  `# Capture failures (${TITLE})\n\n${failures.length ? failures.join('\n') : 'None: every attempted page/state produced a screenshot in both viewports.'}\n\nPages that redirect (for example an anonymous visitor to /login) are real rendered states and are noted in the inventory, not counted as failures. Screens that need fixtures the audit does not create (real payment provider pages, real map tiles, a hosted file store) are not captured and are listed in docs/known-issues.md.\n`,
)
console.log(
  `pages/states: ${keys.length}; missing in some capture: ${missing.length}; failures: ${failures.length}`,
)
