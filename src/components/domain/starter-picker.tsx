'use client'
import { useState } from 'react'
import { artKind, productArtSvg } from '@/lib/art/scenes'
import { sectionsOf, startersFor, starterPhotoUrl, type StarterItem } from '@/lib/starter-catalogue'

/** "Start from a popular Nigerian dish or drink": picking one fills in the name, description, menu section and photo. All of it can be changed, and the price is always the owner's. */
export function StarterPicker({
  categorySlugs,
  onPick,
}: {
  categorySlugs?: string | string[] | null
  onPick: (item: StarterItem) => void
}) {
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<string | null>(null)
  const all = startersFor(categorySlugs)
  if (all.length === 0) return null
  return (
    <section
      aria-labelledby="starter-title"
      className="space-y-3 rounded-[var(--radius-card)] border border-line bg-accent-50/60 p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="starter-title" className="text-lg font-extrabold text-navy-900">
            Start from a popular item
          </h2>
          <p className="text-sm text-muted">
            Pick an item to fill in the name, description and photo. You can change everything and
            you set the price.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="touch-target rounded-[var(--radius-control)] border border-brand-700 bg-white px-4 font-bold text-brand-700"
        >
          {open ? 'Hide the list' : 'Choose from the list'}
        </button>
      </div>
      {open &&
        sectionsOf(all).map((section) => {
          const items = all.filter((i) => i.section === section)
          if (!items.length) return null
          return (
            <div key={section} className="space-y-2">
              <h3 className="text-sm font-bold uppercase tracking-wide text-muted">{section}</h3>
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {items.map((item) => (
                  <li key={item.slug}>
                    <button
                      type="button"
                      onClick={() => {
                        setPicked(item.slug)
                        onPick(item)
                      }}
                      aria-pressed={picked === item.slug}
                      className="flex h-full w-full flex-col overflow-hidden rounded-[var(--radius-control)] border-2 border-line bg-white text-left transition hover:border-brand-600 aria-pressed:border-brand-700 aria-pressed:bg-brand-50"
                    >
                      {item.photo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={starterPhotoUrl(item)}
                          alt=""
                          loading="lazy"
                          className="aspect-[4/3] w-full object-cover"
                        />
                      ) : (
                        <span
                          aria-hidden="true"
                          className="block aspect-[4/3] w-full overflow-hidden [&>svg]:size-full"
                          dangerouslySetInnerHTML={{
                            __html: productArtSvg(artKind(`${item.name} ${item.section}`), ''),
                          }}
                        />
                      )}
                      <span className="p-2 text-sm font-bold text-navy-900">{item.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
    </section>
  )
}
