const QA: [string, string][] = [
  [
    'Who can use AFIT Market?',
    'Anyone aged 18 or over can create an account. Shops and riders are reviewed and approved before they start.',
  ],
  [
    'How do I pay?',
    'You pay online with Paystack when you check out. The price you see is checked again by the server before you pay.',
  ],
  [
    'How does delivery end?',
    'Your rider hands you the order at the door. You sign on the rider’s phone, or scan the QR code on it. You do not have to remember to confirm on your own phone.',
  ],
  [
    'Can I see where my rider is?',
    'Yes. Once a rider takes your order, your order page shows them on a live map, and they can see where to find you.',
  ],
  [
    'What if something is wrong with my order?',
    'Open the order and choose Report a problem. Staff can see it, and refunds and returns follow a set process.',
  ],
]

/** Plain questions and answers. Native disclosure elements: they work with a keyboard and without scripts. */
export function Faq() {
  return (
    <div className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-card shadow-[var(--shadow-card)]">
      {QA.map(([q, a]) => (
        <details key={q} className="group p-4">
          <summary className="touch-target flex cursor-pointer list-none items-center justify-between gap-3 font-bold text-navy-900">
            {q}
            <span
              aria-hidden="true"
              className="text-2xl leading-none text-brand-700 transition group-open:rotate-45"
            >
              +
            </span>
          </summary>
          <p className="mt-2 text-muted">{a}</p>
        </details>
      ))}
    </div>
  )
}
