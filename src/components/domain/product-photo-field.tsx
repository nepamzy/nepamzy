'use client'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { NoImageTile } from '@/components/ui/no-image-tile'

const MAX_SIDE = 1000

/** Shrinks the chosen picture on the device to a JPEG that is small enough to send quickly on mobile data. */
async function shrink(file: File): Promise<string> {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(bmp.width * scale))
  c.height = Math.max(1, Math.round(bmp.height * scale))
  const g = c.getContext('2d')
  if (!g) throw new Error('no canvas')
  g.fillStyle = 'white'
  g.fillRect(0, 0, c.width, c.height)
  g.drawImage(bmp, 0, 0, c.width, c.height)
  for (const q of [0.82, 0.7, 0.55]) {
    const url = c.toDataURL('image/jpeg', q)
    if (url.length < 330_000) return url
  }
  return c.toDataURL('image/jpeg', 0.4)
}

/** The photo of one product: pick or take a picture, see it, replace it or remove it. Saved with the rest of the form. */
export function ProductPhotoField({
  productId,
  hasPhoto = false,
}: {
  productId?: string
  hasPhoto?: boolean
}) {
  const [preview, setPreview] = useState<string | null>(null)
  const [data, setData] = useState('')
  const [remove, setRemove] = useState(false)
  const [hasOld, setHasOld] = useState(hasPhoto)
  const [note, setNote] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  const choose = async (file: File | undefined) => {
    setNote(null)
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setNote('Please choose a picture (JPG, PNG or WebP).')
      return
    }
    try {
      const url = await shrink(file)
      setPreview(url)
      setData(url)
      setRemove(false)
    } catch {
      setNote('We could not read that picture. Try another one.')
    }
  }
  const showing =
    preview ?? (hasOld && !remove && productId ? `/api/products/${productId}/image` : null)
  return (
    <div className="space-y-2">
      <p className="font-semibold">Photo of the item</p>
      <div className="max-w-xs overflow-hidden rounded-[var(--radius-card)] border border-line">
        {showing ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={showing}
            alt="Photo of this item"
            className="aspect-[4/3] w-full object-cover"
            onError={() => setHasOld(false)}
          />
        ) : (
          <NoImageTile label="No photo yet" className="rounded-none" />
        )}
      </div>
      <input type="hidden" name="image" value={data} />
      <input type="hidden" name="removeImage" value={remove ? '1' : ''} />
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="sr-only"
        id="product-photo-input"
        aria-label="Choose a photo of the item"
        onChange={(e) => void choose(e.target.files?.[0])}
      />
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={() => input.current?.click()}>
          {showing ? 'Change photo' : 'Add a photo'}
        </Button>
        {showing && (
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setPreview(null)
              setData('')
              setRemove(true)
            }}
          >
            Remove photo
          </Button>
        )}
      </div>
      <p className="text-sm text-muted">
        A clear picture of the actual item sells best. It is shrunk on your phone before it is sent.
        Remember to press the save button below.
      </p>
      {note && (
        <p role="alert" className="font-medium text-danger-700">
          {note}
        </p>
      )}
    </div>
  )
}
