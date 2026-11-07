'use client'
import { useActionState, useState } from 'react'
import { Button } from '@/components/ui/button'
import { artKind, productArtSvg } from '@/lib/art/scenes'
import { sectionsOf, starterPhotoUrl, type StarterItem } from '@/lib/starter-catalogue'
import { addFromListAction } from '@/server/modules/vendors-and-catalogue/actions'
import type { ActionState } from '@/server/modules/shared/action-helpers'

const toDataUrl = async (url: string): Promise<string> => {
  const blob = await (await fetch(url)).blob()
  return await new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}

/**
 * "Add from the list": every ready-made item for the shop's category as a tappable card. Tick the ones you sell, put the price in
 * now or leave it empty and set it later. Items already on the menu are marked and cannot be ticked twice.
 */
export function QuickAdd({
  vendorId,
  items,
  onMenu,
  waiting,
  categoryName,
}: {
  vendorId: string
  items: StarterItem[]
  /** lower-case names of items already on the menu */
  onMenu: string[]
  /** slugs ticked earlier without a price */
  waiting: string[]
  categoryName: string
}) {
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [prices, setPrices] = useState<Record<string, string>>({})
  const [state, action, pending] = useActionState(async (prev: ActionState, fd: FormData) => {
    const r = await addFromListAction(prev, fd)
    if (r.message) {
      setChecked({})
      setPrices({})
    }
    return r
  }, {} as ActionState)
  const [images, setImages] = useState<Record<string, string>>({})
  const have = new Set(onMenu)
  const ticked = items.filter((i) => checked[i.slug])
  const loading = ticked.some((i) => i.photo && !images[i.slug])

  const toggle = (item: StarterItem, on: boolean) => {
    setChecked((c) => ({ ...c, [item.slug]: on }))
    if (on && item.photo && !images[item.slug])
      toDataUrl(starterPhotoUrl(item))
        .then((u) => setImages((m) => ({ ...m, [item.slug]: u })))
        .catch(() => setChecked((c) => ({ ...c, [item.slug]: false })))
  }
  const selectAllLeft = () =>
    items.filter((i) => !have.has(i.name.toLowerCase())).forEach((i) => toggle(i, true))

  return (
    <form action={action} className="space-y-6" data-testid="quick-add">
      <input type="hidden" name="vendorId" value={vendorId} />
      {ticked.map((i) => (
        <span key={i.slug}>
          <input type="hidden" name="pick" value={i.slug} />
          {i.photo && images[i.slug] && (
            <input type="hidden" name={`image:${i.slug}`} value={images[i.slug]} />
          )}
        </span>
      ))}
      {state.error && (
        <p
          role="alert"
          className="rounded-[var(--radius-control)] bg-danger-50 px-3 py-2 font-medium text-danger-700"
        >
          {state.error}
        </p>
      )}
      {state.message && (
        <p
          role="status"
          className="rounded-[var(--radius-control)] bg-success-50 px-3 py-2 font-medium text-success-700"
        >
          {state.message}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          Ready-made items for <strong>{categoryName}</strong>. Tick the ones you sell. Add the
          price now, or leave it empty and set it later.
        </p>
        <button
          type="button"
          onClick={selectAllLeft}
          className="touch-target rounded-[var(--radius-control)] border border-brand-700 bg-white px-4 font-bold text-brand-700"
        >
          Tick everything not on my menu
        </button>
      </div>
      {sectionsOf(items).map((section) => (
        <fieldset key={section} className="space-y-2">
          <legend className="text-sm font-bold uppercase tracking-wide text-muted">
            {section}
          </legend>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {items
              .filter((i) => i.section === section)
              .map((item) => {
                const onTheMenu = have.has(item.name.toLowerCase())
                const on = !!checked[item.slug]
                const saved = waiting.includes(item.slug)
                return (
                  <li key={item.slug}>
                    <div
                      className={`flex h-full flex-col overflow-hidden rounded-[var(--radius-control)] border-2 bg-white ${
                        on ? 'border-brand-700 bg-brand-50' : 'border-line'
                      } ${onTheMenu ? 'opacity-60' : ''}`}
                    >
                      <label className="relative flex flex-1 cursor-pointer flex-col">
                        <input
                          type="checkbox"
                          className="peer absolute inset-0 z-10 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
                          checked={on}
                          disabled={onTheMenu}
                          onChange={(e) => toggle(item, e.target.checked)}
                          aria-label={`${item.name}${onTheMenu ? ' (already on your menu)' : ''}`}
                        />
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
                        <span className="flex flex-1 flex-col gap-1 p-2 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-[-2px]">
                          <span className="text-sm font-bold text-navy-900">{item.name}</span>
                          {onTheMenu && (
                            <span className="text-xs font-semibold text-success-700">
                              On your menu
                            </span>
                          )}
                          {saved && !onTheMenu && (
                            <span className="text-xs font-semibold text-brand-700">
                              Saved, needs a price
                            </span>
                          )}
                          {on && (
                            <span className="text-xs font-semibold text-brand-700">✓ Ticked</span>
                          )}
                        </span>
                      </label>
                      {on && (
                        <div className="border-t border-line p-2">
                          <label className="block text-xs font-semibold text-muted">
                            Price in naira (or set later)
                            <input
                              name={`price:${item.slug}`}
                              inputMode="decimal"
                              value={prices[item.slug] ?? ''}
                              onChange={(e) =>
                                setPrices((p) => ({ ...p, [item.slug]: e.target.value }))
                              }
                              placeholder="e.g. 1500"
                              className="mt-1 w-full rounded-[var(--radius-control)] border border-line-strong bg-white px-2 py-2 text-base text-ink"
                            />
                          </label>
                        </div>
                      )}
                    </div>
                  </li>
                )
              })}
          </ul>
        </fieldset>
      ))}
      <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border border-line bg-card p-3 shadow-[var(--shadow-card)]">
        <Button type="submit" variant="gold" disabled={pending || loading || ticked.length === 0}>
          {pending
            ? 'Adding…'
            : loading
              ? 'Getting photos…'
              : `Add ${ticked.length || ''} selected item${ticked.length === 1 ? '' : 's'}`}
        </Button>
        <span className="text-sm text-muted" aria-live="polite">
          {ticked.length === 0
            ? 'Nothing ticked yet.'
            : `${ticked.filter((i) => (prices[i.slug] ?? '').trim() === '').length} without a price will be saved for later.`}
        </span>
      </div>
    </form>
  )
}
