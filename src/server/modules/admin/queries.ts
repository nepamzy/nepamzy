import 'server-only'
import { createSupabaseServerClient } from '@/lib/supabase/server'

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T | null> {
  const sb = await createSupabaseServerClient()
  const { data, error } = await sb.rpc(fn, args)
  return error ? null : (data as T)
}

export const ADMIN_PAGE_SIZE = 25

export type Dashboard = {
  orders_total: number
  orders_7d: number
  orders_active: number
  payments_received_kobo: number | null
  payments_received_7d_kobo: number | null
  vendors_approved: number
  vendors_pending: number
  riders_approved: number
  users_total: number
  new_users_7d: number
  orders_by_day: { day: string; orders: number }[]
  recent_orders: {
    id: string
    order_number: string
    vendor_name: string
    status: string
    total_kobo: number
    created_at: string
  }[]
}
export const adminDashboard = () => rpc<Dashboard>('admin_dashboard')

export type Report = {
  days: number
  orders: number
  orders_completed: number
  orders_cancelled: number
  payments_received_kobo: number
  refunds_paid_kobo: number
  new_users: number
  by_status: { status: string; n: number }[]
  by_day: { day: string; orders: number; received_kobo: number }[]
  top_vendors: { vendor_name: string; orders: number; completed_items_kobo: number }[]
}
export const adminReport = (days: number) => rpc<Report>('admin_report', { p_days: days })

export type AdminUser = {
  id: string
  email: string
  display_name: string | null
  created_at: string
  last_sign_in_at: string | null
  suspended: boolean
  roles: string[]
}
export const listUsers = (q: string, role: string | null, page: number) =>
  rpc<{ total: number; rows: AdminUser[] }>('admin_list_users', {
    p_q: q || null,
    p_role: role,
    p_limit: ADMIN_PAGE_SIZE,
    p_offset: (page - 1) * ADMIN_PAGE_SIZE,
  })

export type UserDetail = {
  id: string
  email: string
  display_name: string | null
  created_at: string
  last_sign_in_at: string | null
  email_confirmed: boolean
  suspended: boolean
  has_authenticator: boolean
  roles: string[]
  orders_as_customer: number
  vendor: { name: string; status: string } | null
  rider_status: string | null
}
export const userDetail = (id: string) => rpc<UserDetail>('admin_user_detail', { p_user: id })

export type AdminProduct = {
  id: string
  name: string
  price_kobo: number
  status: 'active' | 'archived' | 'hidden'
  is_available: boolean
  stock_quantity: number | null
  created_at: string
  vendor_name: string
  vendor_slug: string
}
export const listProducts = (q: string, status: string | null, page: number) =>
  rpc<{ total: number; rows: AdminProduct[] }>('admin_list_products', {
    p_q: q || null,
    p_status: status,
    p_limit: ADMIN_PAGE_SIZE,
    p_offset: (page - 1) * ADMIN_PAGE_SIZE,
  })

export type ContactMessage = {
  id: string
  name: string
  email: string
  subject: string
  message: string
  status: 'new' | 'read' | 'closed'
  created_at: string
  handled_at: string | null
}
export const listContactMessages = (status: string | null, page: number) =>
  rpc<{ total: number; rows: ContactMessage[] }>('staff_list_contact_messages', {
    p_status: status,
    p_limit: ADMIN_PAGE_SIZE,
    p_offset: (page - 1) * ADMIN_PAGE_SIZE,
  })
