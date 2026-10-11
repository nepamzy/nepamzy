export type VendorCard = {
  id: string
  slug: string
  name: string
  description: string | null
  category_slug: string | null
  category_name: string | null
  prep_minutes: number
  temporarily_closed: boolean
  open_now: boolean
}
export type MenuOption = { id: string; name: string; price_delta_kobo: number; available: boolean }
export type MenuGroup = {
  id: string
  name: string
  min: number
  max: number
  options: MenuOption[]
}
export type MenuProduct = {
  id: string
  name: string
  description: string | null
  section: string | null
  price_kobo: number
  available: boolean
  options: MenuGroup[]
}
export type Menu = {
  vendor: {
    id: string
    slug: string
    name: string
    description: string | null
    category: string | null
    open_now: boolean
    temporarily_closed: boolean
    prep_minutes: number
    pickup_location_text: string | null
  }
  hours: { weekday: number; opens: string; closes: string }[]
  products: MenuProduct[]
}
export type ProductHit = {
  id: string
  name: string
  price_kobo: number
  available: boolean
  vendor_slug: string
  vendor_name: string
  open_now: boolean
}
export type Category = { id: string; slug: string; name: string }
export type MyVendor = {
  id: string
  slug: string
  name: string
  status: 'pending' | 'approved' | 'suspended'
  staff_role: 'owner' | 'staff'
}
