/**
 * The AI-made hero picture: a campus street in Kaduna with a student ordering food, a rider and a food stall.
 * A slow zoom and a floating "on its way" badge give it life; both stop for people who ask for less motion.
 */
export function HeroPhoto({ className = '' }: { className?: string }) {
  return (
    <figure
      className={`relative overflow-hidden rounded-3xl shadow-[0_20px_50px_-20px_rgb(0_0_0/.6)] ${className}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/art/hero.jpg"
        width={1024}
        height={576}
        alt="A student orders food on her phone at a campus food stall while a delivery rider rides past."
        className="afit-kenburns block h-auto w-full"
        fetchPriority="high"
      />
      <figcaption className="afit-bob absolute bottom-3 left-3 inline-flex items-center gap-2 rounded-full bg-navy-900/90 px-3 py-1.5 text-sm font-bold text-white shadow-lg backdrop-blur">
        <span aria-hidden="true" className="size-2 rounded-full bg-gold-400" />
        Your order is on its way
      </figcaption>
    </figure>
  )
}
