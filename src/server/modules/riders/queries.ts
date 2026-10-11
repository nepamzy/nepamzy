import 'server-only'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseServiceClient } from '@/lib/supabase/service'

export type MyRider = {
  full_name: string
  terms_version: string
  terms_title: string
  terms_body: string
  terms_is_placeholder: boolean
  terms_acknowledged: boolean
  active: boolean
  shift_started_at: string | null
  active_deliveries: number
}
export type Offer = {
  order_id: string
  order_number: string
  vendor_name: string
  pickup: string | null
  deliver_to: string | null
  offered_at: string
}
export type Assignment = {
  assignment_id: string
  order_id: string
  order_number: string
  vendor_name: string
  pickup: string | null
  deliver_to: string | null
  status: 'accepted' | 'picked_up' | 'en_route'
  order_status: string
  slot: number
  sequence: number
  arrival_detected_at: string | null
  dest_lat: number | null
  dest_lng: number | null
}
export type RiderIssue = {
  id: string
  order_number: string
  reason: string
  note: string | null
  created_at: string
  assignment_id: string | null
  assignment_status: string | null
}

export async function getMyRider(): Promise<MyRider | null> {
  const sb = await createSupabaseServerClient()
  const { data, error } = await sb.rpc('my_rider')
  return error ? null : (data as MyRider)
}
export async function getOffers(): Promise<Offer[]> {
  const sb = await createSupabaseServerClient()
  const { data, error } = await sb.rpc('list_delivery_offers')
  return error ? [] : ((data as Offer[]) ?? [])
}
export async function getAssignments(): Promise<Assignment[]> {
  const sb = await createSupabaseServerClient()
  const { data, error } = await sb.rpc('my_assignments')
  return error ? [] : ((data as Assignment[]) ?? [])
}

/** Thresholds the browser needs for its own pre-checks and polling cadence (the database stays authoritative). */
export async function locationSettings() {
  const { data } = await createSupabaseServiceClient()
    .from('platform_settings')
    .select('key, value')
    .in('key', [
      'location_max_accuracy_m',
      'location_max_age_seconds',
      'location_min_interval_seconds',
    ])
  const m = new Map((data ?? []).map((r) => [r.key as string, Number(r.value)]))
  return {
    maxAccuracyM: m.get('location_max_accuracy_m') ?? 100,
    maxAgeSeconds: m.get('location_max_age_seconds') ?? 120,
    minIntervalSeconds: m.get('location_min_interval_seconds') ?? 3,
  }
}

export async function listRiderApplications() {
  const sb = await createSupabaseServerClient()
  const { data } = await sb
    .from('rider_applications')
    .select('id, full_name, contact_phone, vehicle_note, status, decision_reason, created_at')
    .order('created_at', { ascending: false })
    .limit(50)
  return data ?? []
}
export async function listRiderProfiles() {
  const sb = await createSupabaseServerClient()
  const { data } = await sb
    .from('rider_profiles')
    .select('user_id, full_name, contact_phone, status, created_at')
    .order('created_at', { ascending: false })
    .limit(100)
  return data ?? []
}
export async function listOpenRiderIssues(): Promise<RiderIssue[]> {
  const sb = await createSupabaseServerClient()
  const { data, error } = await sb.rpc('list_rider_issues')
  return error ? [] : ((data as RiderIssue[]) ?? [])
}
export async function listPendingRiderPickups() {
  const sb = await createSupabaseServerClient()
  const { data, error } = await sb.rpc('vendor_pending_rider_pickups')
  return error
    ? []
    : ((data as {
        order_id: string
        order_number: string
        rider_name: string
        assignment_no: number
      }[]) ?? [])
}
