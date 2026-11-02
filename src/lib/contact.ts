/** How people reach AFIT Market. One place, so the landing page, contact page, footer and WhatsApp button always agree. */
export const WHATSAPP_NUMBER_DISPLAY = '0911 5930 445'
/** International format without "+" or spaces, as wa.me wants it (Nigeria is 234, and the leading 0 is dropped). */
export const WHATSAPP_NUMBER_INTL = '2349115930445'
export const WHATSAPP_URL = `https://wa.me/${WHATSAPP_NUMBER_INTL}?text=${encodeURIComponent('Hello AFIT Market, I need help with…')}`

/** The public support e-mail address, from the SUPPORT_EMAIL setting. Nothing is shown until one is set. */
export function supportEmail(): string | null {
  const v = (process.env.SUPPORT_EMAIL ?? '').trim()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null
}
