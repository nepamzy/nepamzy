/**
 * Text for a phone pop-up. A pop-up shows on a locked screen, so it must never carry private data. Notification texts are
 * already written without it; this is the second lock: phone numbers, e-mail addresses, bank/account numbers, codes and
 * street-style addresses are removed, and the length is capped.
 */
const MAX_TITLE = 60
const MAX_BODY = 120

function scrub(input: string): string {
  return input
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '') // e-mail addresses
    .replace(/(\+?\d[\d\s-]{6,}\d)/g, '') // phone / account numbers (7+ digits, even with spaces or dashes)
    .replace(/\b(code|otp|pin|token)\b\s*(is|:|=)?\s*[A-Za-z0-9-]{3,}/gi, '') // "code: 4821", "OTP is AB12"
    .replace(/\b\d{4,6}\b/g, '') // any stray 4–6 digit code
    .replace(
      /\b(at|near|opposite|behind)\s+[^.!?]{0,60}(street|road|hall|block|room|lodge|hostel)\b[^.!?]*/gi,
      '',
    )
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function cut(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`
}

export function safePushText(title: string, body: string): { title: string; body: string } {
  const t = cut(scrub(title), MAX_TITLE) || 'AFIT Market'
  const b = cut(scrub(body), MAX_BODY) || 'You have a new update. Tap to open.'
  return { title: t, body: b }
}
