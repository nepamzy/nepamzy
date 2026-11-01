/**
 * Every date and time the app shows is in Nigerian time (Africa/Lagos), whatever the server or the visitor's device
 * is set to, so the same moment reads the same on every screen, e-mail and receipt.
 */
const ZONE = 'Africa/Lagos'
const asDate = (v: string | number | Date) => (v instanceof Date ? v : new Date(v))

/** 31 Oct 2026, 9:41 am */
export const lagosDateTime = (v: string | number | Date) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: ZONE,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
    .format(asDate(v))
    .replace(/\b(am|pm)\b/i, (m) => m.toLowerCase())

/** 31 Oct 2026 */
export const lagosDate = (v: string | number | Date) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: ZONE,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(asDate(v))

/** 9:41 am */
export const lagosTime = (v: string | number | Date, withSeconds = false) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: ZONE,
    hour: 'numeric',
    minute: '2-digit',
    ...(withSeconds ? { second: '2-digit' } : {}),
    hour12: true,
  })
    .format(asDate(v))
    .replace(/\b(am|pm)\b/i, (m) => m.toLowerCase())
