import { WHATSAPP_NUMBER_DISPLAY, WHATSAPP_URL } from '@/lib/contact'
import { cn } from '@/components/ui/cn'

/** The WhatsApp mark: a green circle with a speech bubble and a phone. */
export function WhatsAppLogo({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <circle cx="32" cy="32" r="30" fill="rgb(37 211 102)" />
      <path
        d="M32 12.5a19.4 19.4 0 0 0-16.6 29.5L12.6 52l10.2-2.7A19.4 19.4 0 1 0 32 12.5Z"
        fill="white"
      />
      <path
        d="M32 15.8a16.1 16.1 0 0 0-13.8 24.4l.4.6-1.6 5.9 6-1.6.6.3A16.1 16.1 0 1 0 32 15.8Z"
        fill="rgb(37 211 102)"
      />
      <path
        d="M25.6 23.6c-.5-1.1-1-1.1-1.5-1.1h-1.2c-.4 0-1.1.2-1.7.8-.6.7-2.2 2.1-2.2 5.1s2.2 5.9 2.5 6.3c.3.4 4.3 6.9 10.6 9.4 5.2 2 6.3 1.6 7.4 1.5 1.1-.1 3.6-1.5 4.1-2.9.5-1.4.5-2.7.4-2.9-.2-.3-.6-.4-1.2-.7s-3.6-1.8-4.1-2c-.6-.2-1-.3-1.4.3-.4.6-1.6 2-2 2.4-.4.4-.7.5-1.3.2-.6-.3-2.6-1-4.9-3-1.8-1.6-3-3.6-3.4-4.2-.4-.6 0-.9.3-1.2.3-.3.6-.7.9-1.1.3-.4.4-.6.6-1 .2-.4.1-.8 0-1.1-.2-.3-1.4-3.4-1.9-4.6Z"
        fill="white"
      />
    </svg>
  )
}

/** A button-shaped link that opens WhatsApp chat with the AFIT Market number. */
export function WhatsAppLink({ className, label }: { className?: string; label?: string }) {
  return (
    <a
      href={WHATSAPP_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'touch-target inline-flex items-center gap-2.5 rounded-full bg-white px-5 py-2.5 font-bold text-navy-900 shadow-[var(--shadow-card)] ring-1 ring-line transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-pop)]',
        className,
      )}
    >
      <WhatsAppLogo size={28} />
      <span>
        {label ?? 'Chat on WhatsApp'}
        <span className="block text-sm font-semibold text-muted">{WHATSAPP_NUMBER_DISPLAY}</span>
      </span>
    </a>
  )
}

/** The round WhatsApp button that stays in the corner of every public page. */
export function WhatsAppFloat() {
  return (
    <a
      href={WHATSAPP_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Chat with AFIT Market on WhatsApp, ${WHATSAPP_NUMBER_DISPLAY}`}
      className="afit-wa-float fixed bottom-4 right-4 z-40 grid size-14 place-items-center rounded-full bg-white shadow-[var(--shadow-pop)] ring-1 ring-line transition hover:scale-105"
    >
      <WhatsAppLogo size={44} />
    </a>
  )
}
