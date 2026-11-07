/**
 * The AI hero picture as a big, slowly drifting watermark behind a panel.
 * The parent must be `relative overflow-hidden`; its content goes in a `relative` wrapper so it stays on top and clear.
 */
export function Watermark() {
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-0 z-0">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/art/hero.jpg"
        alt=""
        width={1024}
        height={576}
        loading="lazy"
        className="afit-drift absolute left-1/2 top-1/2 h-[135%] w-auto max-w-none opacity-30"
      />
      <span className="absolute inset-0 bg-gradient-to-r from-card/80 via-card/55 to-card/70" />
    </span>
  )
}
