/**
 * Branded e-mails for people (customers, shops, riders). Pure functions: no network, no environment.
 * Every piece of dynamic text is HTML-escaped; links are built only from the site address and a validated in-app path.
 * The notification texts come from the database triggers and are deliberately generic (no amounts, codes or locations).
 */

const BRAND = {
  blue: '#174a9c',
  blueDark: '#10346f',
  gold: '#f4b400',
  goldDark: '#c98f00',
  ink: '#16202e',
  muted: '#5b6676',
  page: '#eef3fb',
  card: '#f7f9fd',
  line: '#dde5f3',
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
  /** A single emoji shown large above the heading. */
  emoji?: string
  heading: string
  paragraphs: string[]
  /** Label/value rows shown in a tinted box (for example time and device). */
  details?: Array<[string, string]>
  /** Highlighted line such as a one-time code. */
  highlight?: string
  button?: { label: string; url: string } | null
  /** Small grey line under the button. */
  note?: string
  siteUrl: string
}

const FONT = "'Segoe UI',Roboto,Helvetica,Arial,sans-serif"

export function renderEmail(l: Layout): RenderedEmail {
  const site = l.siteUrl.replace(/\/+$/, '')
  const p = l.paragraphs
    .map(
      (t) =>
        `<p style="margin:0 0 14px;font-size:16px;line-height:1.6;color:${BRAND.ink}">${escapeHtml(t)}</p>`,
    )
    .join('')
  const highlight = l.highlight
    ? `<p style="margin:6px 0 18px;text-align:center"><span style="display:inline-block;background:${BRAND.card};border:2px dashed ${BRAND.gold};border-radius:12px;padding:14px 26px;font-size:34px;font-weight:800;letter-spacing:8px;color:${BRAND.blueDark}">${escapeHtml(l.highlight)}</span></p>`
    : ''
  const details = l.details?.length
    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:6px 0 18px;background:${BRAND.card};border:1px solid ${BRAND.line};border-radius:10px">${l.details
        .map(
          ([k, v]) =>
            `<tr><td style="padding:10px 14px;font-size:14px;color:${BRAND.muted};width:38%">${escapeHtml(k)}</td><td style="padding:10px 14px;font-size:14px;font-weight:600;color:${BRAND.ink}">${escapeHtml(v)}</td></tr>`,
        )
        .join('')}</table>`
    : ''
  const button = l.button
    ? `<p style="margin:24px 0 8px;text-align:center"><a href="${escapeHtml(l.button.url)}" style="display:inline-block;background:${BRAND.blue};color:#ffffff;text-decoration:none;font-weight:700;font-size:16px;padding:14px 30px;border-radius:10px;border-bottom:3px solid ${BRAND.blueDark}">${escapeHtml(l.button.label)}</a></p>`
    : ''
  const note = l.note
    ? `<p style="margin:10px 0 0;text-align:center;font-size:13px;line-height:1.5;color:${BRAND.muted}">${escapeHtml(l.note)}</p>`
    : ''
  const emoji = l.emoji
    ? `<p style="margin:0 0 6px;text-align:center;font-size:44px;line-height:1.1">${escapeHtml(l.emoji)}</p>`
    : ''
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(l.subject)}</title></head>
<body style="margin:0;padding:0;background:${BRAND.page};font-family:${FONT}">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(l.preheader)}</span>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${BRAND.page}"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:580px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 14px rgba(16,52,111,.10)">
<tr><td style="background:${BRAND.blueDark};padding:22px 30px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="font-size:24px;font-weight:800;color:#ffffff">&#128717;&#65039; AFIT <span style="color:${BRAND.gold}">Market</span></td><td align="right" style="font-size:12px;color:#c9d6f0">Your campus marketplace</td></tr></table></td></tr>
<tr><td style="height:5px;background:${BRAND.gold};font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td style="padding:30px 30px 26px">
${emoji}<h1 style="margin:0 0 18px;text-align:center;font-size:24px;line-height:1.3;color:${BRAND.blueDark}">${escapeHtml(l.heading)}</h1>
${p}${highlight}${details}${button}${note}
</td></tr>
<tr><td style="padding:20px 30px;background:${BRAND.card};border-top:1px solid ${BRAND.line};font-size:12.5px;line-height:1.6;color:${BRAND.muted}">
&#128274; We will never ask for your password, your card details or a code by phone or message. This e-mail is about your activity on AFIT Market and does not contain payment details.
<br><br>&#127979; AFIT Market &middot; <a href="${escapeHtml(site)}" style="color:${BRAND.blue};text-decoration:none">${escapeHtml(site.replace(/^https?:\/\//, ''))}</a> &middot; Kaduna, Nigeria
</td></tr></table></td></tr></table></body></html>`
  const text = [
    `${l.emoji ? `${l.emoji} ` : ''}${l.heading}`,
    '',
    ...l.paragraphs,
    ...(l.highlight ? ['', l.highlight] : []),
    ...(l.details?.length ? ['', ...l.details.map(([k, v]) => `${k}: ${v}`)] : []),
    ...(l.button ? ['', `${l.button.label}: ${l.button.url}`] : []),
    ...(l.note ? ['', l.note] : []),
    '',
    '--',
    'AFIT Market, your campus marketplace. We will never ask for your password, card details or a code by phone or message.',
  ].join('\n')
  return { subject: l.subject, html, text }
}

const root = (siteUrl: string) => siteUrl.replace(/\/+$/, '')

/** Sent at sign-up: the one-time link that confirms the address. */
export function confirmEmail(confirmUrl: string, siteUrl: string): RenderedEmail {
  return renderEmail({
    subject: '\u2709\uFE0F Confirm your AFIT Market account',
    preheader: 'One tap to confirm your e-mail and finish creating your account.',
    emoji: '\u2709\uFE0F',
    heading: 'Confirm your e-mail',
    paragraphs: [
      'Welcome! Tap the button below to confirm this e-mail address and finish creating your AFIT Market account.',
      'After that you can sign in and start using the marketplace.',
    ],
    button: { label: '\u2705 Confirm my e-mail', url: confirmUrl },
    note: 'This link works once and expires after a while. If you did not create an account, you can ignore this message and nothing will happen.',
    siteUrl,
  })
}

export function welcomeEmail(siteUrl: string): RenderedEmail {
  return renderEmail({
    subject: '\uD83C\uDF89 Welcome to AFIT Market',
    preheader: 'Your account is ready. Here is what you can do next.',
    emoji: '\uD83C\uDF89',
    heading: 'Welcome to AFIT Market!',
    paragraphs: [
      'Thank you for joining. Your account is ready.',
      '\uD83C\uDF54 Browse food, printing and services from campus shops.',
      '\uD83D\uDE9A Order for pickup or delivery to an approved delivery point.',
      '\uD83D\uDCF1 Follow every step of your order from your phone.',
      'If you would like an extra lock on your account, you can switch on two-step sign-in with an authenticator app from Account, then Security. It is optional.',
    ],
    button: { label: '\uD83D\uDECD\uFE0F Start browsing', url: `${root(siteUrl)}/vendors` },
    siteUrl,
  })
}

export function resetCodeEmail(code: string, siteUrl: string): RenderedEmail {
  return renderEmail({
    subject: `\uD83D\uDD11 Your AFIT Market reset code: ${code}`,
    preheader: `Your password reset code is ${code}`,
    emoji: '\uD83D\uDD11',
    heading: 'Reset your password',
    paragraphs: [
      'Enter this 6-digit code on the reset page to choose a new password. It works once and expires in 15 minutes.',
    ],
    highlight: code,
    button: { label: '\uD83D\uDD12 Open the reset page', url: `${root(siteUrl)}/reset-password` },
    note: 'If you did not ask for this, ignore this message. Your password has not changed and nobody can use this code without your e-mail.',
    siteUrl,
  })
}

/** Sent after a successful password sign-in, so the owner of the account would notice someone else. */
export function signInAlertEmail(
  info: { when: string; device: string },
  siteUrl: string,
): RenderedEmail {
  return renderEmail({
    subject: '\uD83D\uDD10 New sign-in to your AFIT Market account',
    preheader: 'Was this you? Here are the details of the sign-in.',
    emoji: '\uD83D\uDD10',
    heading: 'New sign-in',
    paragraphs: [
      'Someone signed in to your AFIT Market account. If this was you, there is nothing to do.',
    ],
    details: [
      ['When', info.when],
      ['Device', info.device],
    ],
    button: {
      label: '\uD83D\uDEE1\uFE0F Secure my account',
      url: `${root(siteUrl)}/forgot-password`,
    },
    note: 'Not you? Choose "Secure my account" to set a new password right away.',
    siteUrl,
  })
}

/** Sent after a password was changed through the reset flow. */
export function passwordChangedEmail(siteUrl: string): RenderedEmail {
  return renderEmail({
    subject: '\u2705 Your AFIT Market password was changed',
    preheader: 'Your password was changed just now.',
    emoji: '\u2705',
    heading: 'Password changed',
    paragraphs: [
      'The password on your AFIT Market account was changed just now, and you were signed out everywhere else.',
      'If this was not you, reset your password again straight away.',
    ],
    button: { label: '\uD83D\uDD11 Reset my password', url: `${root(siteUrl)}/forgot-password` },
    siteUrl,
  })
}

type NotificationLike = { kind: string; title: string; body: string; link: string | null }

function buttonLabel(link: string | null): string {
  if (!link) return 'Open AFIT Market'
  if (link.startsWith('/orders')) return '\uD83D\uDCE6 View your order'
  if (link.startsWith('/vendor')) return '\uD83C\uDFEA Open your shop orders'
  if (link.startsWith('/rider')) return '\uD83D\uDEB4 Open rider area'
  if (link.startsWith('/cases')) return '\uD83D\uDEDF View your report'
  if (link.startsWith('/admin')) return '\uD83D\uDEE0\uFE0F Open admin area'
  return 'Open AFIT Market'
}

const KIND_EMOJI: Record<string, string> = {
  order: '\uD83D\uDCE6',
  refund: '\uD83D\uDCB8',
  return: '\u21A9\uFE0F',
  case: '\uD83D\uDEDF',
  review: '\u2B50',
  admin: '\uD83D\uDEE0\uFE0F',
}

/** A fitting emoji for one notification: by what the title says, then by its kind. */
export function emojiFor(n: Pick<NotificationLike, 'kind' | 'title'>): string {
  const t = n.title.toLowerCase()
  if (/pay|paid|receipt|order received/.test(t)) return '\uD83D\uDCB3'
  if (/deliver(ed|y complete)|complete|thank/.test(t)) return '\uD83C\uDF89'
  if (/on the way|on its way|en route|arrived|rider|assigned|collect/.test(t)) return '\uD83D\uDE9A'
  if (/ready|accepted|preparing/.test(t)) return '\uD83D\uDC68\u200D\uD83C\uDF73'
  if (/approved|welcome|confirmed/.test(t)) return '\u2705'
  if (/reject|declin|cancel|fail|problem|dispute/.test(t)) return '\u26A0\uFE0F'
  if (/refund/.test(t)) return '\uD83D\uDCB8'
  if (/application|received|placed/.test(t)) return '\uD83D\uDCDD'
  return KIND_EMOJI[n.kind] ?? '\uD83D\uDD14'
}

/** One e-mail for one in-app notification. */
export function notificationEmail(n: NotificationLike, siteUrl: string): RenderedEmail {
  const url = appLink(siteUrl, n.link)
  const emoji = emojiFor(n)
  return renderEmail({
    subject: `${emoji} ${n.title}`,
    preheader: n.body,
    emoji,
    heading: n.title,
    paragraphs: [n.body],
    button: url ? { label: buttonLabel(n.link), url } : null,
    siteUrl,
  })
}

const WHAT = { vendor: 'shop', rider: 'rider' } as const

/** Sent to someone who just applied to sell or to deliver. */
export function applicationReceivedEmail(kind: 'vendor' | 'rider', siteUrl: string): RenderedEmail {
  const what = WHAT[kind]
  return renderEmail({
    subject: `\uD83D\uDCDD We received your ${what} application`,
    preheader: 'An administrator will review it soon.',
    emoji: '\uD83D\uDCDD',
    heading: 'Application received',
    paragraphs: [
      `Thank you for applying to be a ${what === 'shop' ? 'seller' : 'rider'} on AFIT Market. An administrator will review your application soon.`,
      'We will e-mail you as soon as there is a decision. You do not need to do anything else for now.',
    ],
    button: {
      label: '\uD83D\uDD0E See my application',
      url: `${root(siteUrl)}${kind === 'vendor' ? '/apply' : '/rider-apply'}`,
    },
    siteUrl,
  })
}

/** Sent when an administrator approves or declines an application. */
export function applicationDecisionEmail(
  d: { kind: 'vendor' | 'rider'; approved: boolean; reason?: string | null },
  siteUrl: string,
): RenderedEmail {
  const vendor = d.kind === 'vendor'
  if (d.approved)
    return renderEmail({
      subject: "\uD83C\uDF89 You're approved on AFIT Market!",
      preheader: vendor ? 'Your shop is approved. Add your items.' : 'You are approved as a rider.',
      emoji: '\uD83C\uDF89',
      heading: "You're approved!",
      paragraphs: vendor
        ? [
            'Great news: your shop application was approved. You can now add your menu and start taking orders.',
            '\uD83C\uDF7D\uFE0F Add items with a name, a price and a short description.',
            '\uD83D\uDCE6 Accept, prepare and hand over each order from your shop dashboard.',
          ]
        : [
            'Great news: your rider application was approved. Read and accept the rider terms, add your bank details, then go active to see delivery offers.',
            '\uD83D\uDE9A AFIT Market is currently free for riders: no commission is deducted from your delivery earnings.',
          ],
      button: {
        label: vendor ? '\uD83C\uDFEA Open my shop' : '\uD83D\uDEB4 Open the rider area',
        url: `${root(siteUrl)}${vendor ? '/vendor' : '/rider'}`,
      },
      siteUrl,
    })
  return renderEmail({
    subject: `\u26A0\uFE0F About your AFIT Market ${vendor ? 'shop' : 'rider'} application`,
    preheader: 'Your application was not approved this time.',
    emoji: '\u26A0\uFE0F',
    heading: 'Application not approved',
    paragraphs: [
      `Thank you for applying. Your ${vendor ? 'shop' : 'rider'} application was not approved this time.`,
      ...(d.reason ? [`Reason given: ${d.reason}`] : []),
      'You are welcome to apply again once you have addressed this.',
    ],
    button: {
      label: '\uD83D\uDD04 Apply again',
      url: `${root(siteUrl)}${vendor ? '/apply' : '/rider-apply'}`,
    },
    siteUrl,
  })
}
