/**
 * Branded e-mails for people (customers, shops, riders). Pure functions: no network, no environment.
 * Every piece of dynamic text is HTML-escaped; links are built only from the site address and a validated in-app path.
 * The notification texts come from the database triggers and are deliberately generic (no amounts, codes or locations).
 */

const BRAND = {
  blue: '#174a9c',
  blueDark: '#10346f',
  gold: '#f4b400',
  ink: '#16202e',
  muted: '#5b6676',
  page: '#eef3fb',
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const SAFE_PATH = /^\/[A-Za-z0-9_/-]{0,120}$/

/** Absolute link to an in-app path, or null when the path is not a plain app path. */
export function appLink(siteUrl: string, path: string | null | undefined): string | null {
  if (!path || !SAFE_PATH.test(path)) return null
  return `${siteUrl.replace(/\/+$/, '')}${path}`
}

export type RenderedEmail = { subject: string; html: string; text: string }

type Layout = {
  subject: string
  preheader: string
  heading: string
  paragraphs: string[]
  button?: { label: string; url: string } | null
  siteUrl: string
}

export function renderEmail(l: Layout): RenderedEmail {
  const p = l.paragraphs
    .map(
      (t) =>
        `<p style="margin:0 0 14px;font-size:16px;line-height:1.55;color:${BRAND.ink}">${escapeHtml(t)}</p>`,
    )
    .join('')
  const button = l.button
    ? `<p style="margin:22px 0 6px"><a href="${escapeHtml(l.button.url)}" style="display:inline-block;background:${BRAND.blue};color:#ffffff;text-decoration:none;font-weight:700;font-size:16px;padding:13px 24px;border-radius:8px">${escapeHtml(l.button.label)}</a></p>`
    : ''
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(l.subject)}</title></head>
<body style="margin:0;padding:0;background:${BRAND.page};font-family:Arial,Helvetica,sans-serif">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(l.preheader)}</span>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${BRAND.page}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td style="background:${BRAND.blueDark};padding:20px 28px"><span style="font-size:22px;font-weight:800;color:#ffffff">AFIT Market</span></td></tr>
<tr><td style="height:4px;background:${BRAND.gold};font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:${BRAND.blueDark}">${escapeHtml(l.heading)}</h1>
${p}${button}
</td></tr>
<tr><td style="padding:18px 28px;background:#f7f9fd;font-size:13px;line-height:1.5;color:${BRAND.muted}">
You are receiving this because you have an AFIT Market account. This message is about your activity on the marketplace and does not contain payment details.
<br>AFIT Market &middot; <a href="${escapeHtml(l.siteUrl)}" style="color:${BRAND.blue}">${escapeHtml(l.siteUrl.replace(/^https?:\/\//, ''))}</a>
</td></tr></table></td></tr></table></body></html>`
  const text = [
    l.heading,
    '',
    ...l.paragraphs,
    ...(l.button ? ['', `${l.button.label}: ${l.button.url}`] : []),
    '',
    '--',
    'AFIT Market. You are receiving this because you have an AFIT Market account.',
  ].join('\n')
  return { subject: l.subject, html, text }
}

export function welcomeEmail(siteUrl: string): RenderedEmail {
  return renderEmail({
    subject: 'Welcome to AFIT Market',
    preheader: 'Your account is ready.',
    heading: 'Welcome to AFIT Market',
    paragraphs: [
      'Thank you for joining. Your account is ready.',
      'Browse food, printing and services from campus shops, order for pickup or delivery, and follow every step from your phone.',
      'For your security, orders and payments are protected by a second step: an authenticator app on your phone. You will be asked to set it up the first time you need it.',
    ],
    button: { label: 'Start browsing', url: `${siteUrl.replace(/\/+$/, '')}/vendors` },
    siteUrl,
  })
}

type NotificationLike = { kind: string; title: string; body: string; link: string | null }

function buttonLabel(link: string | null): string {
  if (!link) return 'Open AFIT Market'
  if (link.startsWith('/orders')) return 'View your order'
  if (link.startsWith('/vendor')) return 'Open your shop orders'
  if (link.startsWith('/rider')) return 'Open rider area'
  if (link.startsWith('/cases')) return 'View your report'
  if (link.startsWith('/admin')) return 'Open admin area'
  return 'Open AFIT Market'
}

/** One e-mail for one in-app notification. */
export function notificationEmail(n: NotificationLike, siteUrl: string): RenderedEmail {
  const url = appLink(siteUrl, n.link)
  return renderEmail({
    subject: `AFIT Market: ${n.title}`,
    preheader: n.body,
    heading: n.title,
    paragraphs: [n.body],
    button: url ? { label: buttonLabel(n.link), url } : null,
    siteUrl,
  })
}
