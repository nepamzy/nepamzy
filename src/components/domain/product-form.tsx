'use client'
import { useState } from 'react'
import { ActionForm } from '@/components/forms/action-form'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox, Input, Textarea } from '@/components/ui/fields'
import { saveProductAction } from '@/server/modules/vendors-and-catalogue/actions'
import type { EditableProduct } from '@/server/modules/vendors-and-catalogue/vendor-queries'

type G = {
  name: string
  min: number
  max: number
  options: { name: string; price: string; available: boolean }[]
}

export function ProductForm({
  vendorId,
  product,
  disabled,
}: {
  vendorId: string
  product?: EditableProduct
  disabled?: boolean
}) {
  const [groups, setGroups] = useState<G[]>(
    product?.groups.map(({ name, min, max, options }) => ({ name, min, max, options })) ?? [],
  )
  const upd = (i: number, patch: Partial<G>) =>
    setGroups((gs) => gs.map((g, j) => (j === i ? { ...g, ...patch } : g)))
  const updOpt = (i: number, k: number, patch: Partial<G['options'][number]>) =>
    upd(i, { options: groups[i]!.options.map((o, j) => (j === k ? { ...o, ...patch } : o)) })
  return (
    <ActionForm
      action={saveProductAction}
      submitLabel={product ? 'Save changes' : 'Add to menu'}
      hideSubmit={disabled}
    >
      <input type="hidden" name="vendorId" value={vendorId} />
      {product && <input type="hidden" name="productId" value={product.id} />}
      <input type="hidden" name="options" value={JSON.stringify(groups)} />
      <fieldset disabled={disabled} className="space-y-4">
        <Input
          label="Name"
          name="name"
          required
          minLength={2}
          maxLength={80}
          defaultValue={product?.name}
        />
        <Textarea
          label="Description"
          name="description"
          maxLength={300}
          defaultValue={product?.description ?? ''}
        />
        <div className="grid gap-4 sm:grid-cols-3">
          <Input
            label="Price (₦)"
            name="price"
            required
            inputMode="decimal"
            defaultValue={product ? String(product.price_kobo / 100) : ''}
            hint="For example 1500 or 1500.50"
          />
          <Input
            label="Menu section"
            name="section"
            maxLength={40}
            defaultValue={product?.section ?? ''}
            hint="For example Mains"
          />
          <Input
            label="Stock"
            name="stock"
            inputMode="numeric"
            defaultValue={product?.stock_quantity ?? ''}
            hint="Leave empty for unlimited"
          />
        </div>
        <Checkbox label="On sale" name="available" defaultChecked={product?.is_available ?? true} />
        <section aria-labelledby="opts" className="space-y-3">
          <h2 id="opts" className="text-lg font-bold">
            Options and add-ons
          </h2>
          <p className="text-sm text-muted">
            For choices such as size or extras. “At least” 1 makes a choice required.
          </p>
          {groups.map((g, i) => (
            <Card key={i} className="space-y-3 p-3 sm:p-3">
              <div className="grid gap-3 sm:grid-cols-[1fr_6rem_6rem]">
                <Input
                  label="Group name"
                  value={g.name}
                  onChange={(e) => upd(i, { name: e.target.value })}
                  maxLength={40}
                />
                <Input
                  label="At least"
                  type="number"
                  min={0}
                  max={10}
                  value={g.min}
                  onChange={(e) => upd(i, { min: Number(e.target.value) })}
                />
                <Input
                  label="At most"
                  type="number"
                  min={1}
                  max={10}
                  value={g.max}
                  onChange={(e) => upd(i, { max: Number(e.target.value) })}
                />
              </div>
              {g.options.map((o, k) => (
                <div key={k} className="grid items-end gap-2 sm:grid-cols-[1fr_8rem_auto_auto]">
                  <Input
                    label={`Choice ${k + 1}`}
                    value={o.name}
                    onChange={(e) => updOpt(i, k, { name: e.target.value })}
                    maxLength={40}
                  />
                  <Input
                    label="Extra (₦)"
                    value={o.price}
                    inputMode="decimal"
                    onChange={(e) => updOpt(i, k, { price: e.target.value })}
                  />
                  <Checkbox
                    label="Available"
                    checked={o.available}
                    onChange={(e) => updOpt(i, k, { available: e.target.checked })}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => upd(i, { options: g.options.filter((_, j) => j !== k) })}
                    aria-label={`Remove choice ${k + 1}`}
                  >
                    Remove
                  </Button>
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() =>
                    upd(i, { options: [...g.options, { name: '', price: '0', available: true }] })
                  }
                >
                  Add a choice
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setGroups((gs) => gs.filter((_, j) => j !== i))}
                >
                  Remove group
                </Button>
              </div>
            </Card>
          ))}
          {groups.length < 10 && (
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                setGroups((gs) => [
                  ...gs,
                  {
                    name: '',
                    min: 0,
                    max: 1,
                    options: [{ name: '', price: '0', available: true }],
                  },
                ])
              }
            >
              Add an option group
            </Button>
          )}
        </section>
      </fieldset>
    </ActionForm>
  )
}
