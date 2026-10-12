import { Pool, type PoolClient } from 'pg'
import { randomUUID } from 'node:crypto'

export const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

export const pool = new Pool({ connectionString: DATABASE_URL, max: 16 })

export type Aal = 'aal1' | 'aal2'
export type Principal = { id: string; aal: Aal } | null // null => anon

/** Run fn inside a transaction that is always rolled back (setup rows disappear). */
export async function withTx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect()
  try {
    await c.query('begin')
    return await fn(c)
  } finally {
    await c.query('rollback').catch(() => undefined)
    c.release()
  }
}

export async function createUser(c: PoolClient, label = 'u'): Promise<string> {
  const id = randomUUID()
  await c.query(
    `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
       raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
     values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '',
       now(), '{}'::jsonb, '{}'::jsonb, now(), now())`,
    [id, `${label}-${id}@example.test`],
  )
  return id
}

export async function giveRole(c: PoolClient, userId: string, role: string) {
  await c.query(
    `insert into public.role_assignments (user_id, role) values ($1, $2::public.app_role)
     on conflict do nothing`,
    [userId, role],
  )
}

export async function removeCustomerRole(c: PoolClient, userId: string) {
  await c.query(
    `update public.role_assignments set status='revoked', revoked_at=now()
     where user_id=$1 and role='customer'`,
    [userId],
  )
}

/** Execute fn as the given principal (simulating a PostgREST request), then restore superuser. */
export async function as<T>(c: PoolClient, who: Principal, fn: () => Promise<T>): Promise<T> {
  if (who) {
    const claims = JSON.stringify({ sub: who.id, role: 'authenticated', aal: who.aal })
    await c.query(
      `select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`,
      [claims, who.id],
    )
    await c.query('set local role authenticated')
  } else {
    await c.query(
      `select set_config('request.jwt.claims', '{"role":"anon"}', true), set_config('request.jwt.claim.sub', '', true)`,
    )
    await c.query('set local role anon')
  }
  try {
    return await fn()
  } finally {
    await c.query('reset role').catch(() => undefined)
  }
}

/** Run a statement that must fail; return the Postgres error (code + message). */
export async function failure(c: PoolClient, sql: string, params: unknown[] = []) {
  await c.query('savepoint sp')
  try {
    await c.query(sql, params)
  } catch (e) {
    await c.query('rollback to savepoint sp')
    return e as { code?: string; message: string; detail?: string }
  }
  await c.query('release savepoint sp')
  throw new Error(`expected statement to fail but it succeeded: ${sql}`)
}

export const PRIV_DENIED = '42501'

// ---------------------------------------------------------------------------------------------
// Batch 2 fixtures (all run as the superuser-like setup role; tests then act via `as(...)`)
// ---------------------------------------------------------------------------------------------
export type Q = { query: PoolClient['query'] }

export async function mkVendor(
  c: PoolClient,
  o: {
    owner?: string
    status?: 'approved' | 'suspended' | 'pending'
    name?: string
    hours?: boolean
    category?: string
  } = {},
) {
  const slug = `v-${randomUUID().slice(0, 8)}`
  const cat = await c.query(`select id from public.categories where slug = $1`, [
    o.category ?? 'food',
  ])
  const v = await c.query(
    `insert into public.vendors (name, slug, status, category_id, owner_id, pickup_location_text, prep_minutes)
     values ($1, $2, $3, $4, $5, 'Sample pickup point (placeholder)', 15) returning id, slug`,
    [o.name ?? `Vendor ${slug}`, slug, o.status ?? 'approved', cat.rows[0].id, o.owner ?? null],
  )
  const id = v.rows[0].id as string
  if (o.owner) {
    await c.query(
      `insert into public.vendor_staff (vendor_id, user_id, staff_role) values ($1, $2, 'owner')`,
      [id, o.owner],
    )
    await giveRole(c, o.owner, 'vendor_owner')
  }
  if (o.hours !== false) {
    for (let d = 0; d < 7; d++) {
      await c.query(
        `insert into public.store_hours (vendor_id, weekday, opens, closes) values ($1, $2, '00:00', '23:59:59')`,
        [id, d],
      )
    }
  }
  return { id, slug: v.rows[0].slug as string }
}

export async function mkProduct(
  c: PoolClient,
  vendorId: string,
  o: {
    name?: string
    price?: number
    stock?: number | null
    available?: boolean
    status?: 'active' | 'archived'
  } = {},
) {
  const r = await c.query(
    `insert into public.products (vendor_id, name, price_kobo, stock_quantity, is_available, status)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [
      vendorId,
      o.name ?? `Product ${randomUUID().slice(0, 6)}`,
      o.price ?? 100000,
      o.stock === undefined ? null : o.stock,
      o.available ?? true,
      o.status ?? 'active',
    ],
  )
  return r.rows[0].id as string
}

export async function mkOptionGroup(
  c: PoolClient,
  productId: string,
  o: {
    name?: string
    min?: number
    max?: number
    options: { name: string; delta: number; available?: boolean }[]
  },
) {
  const g = await c.query(
    `insert into public.product_option_groups (product_id, name, min_select, max_select) values ($1, $2, $3, $4) returning id`,
    [productId, o.name ?? 'Group', o.min ?? 0, o.max ?? 1],
  )
  const ids: string[] = []
  for (const opt of o.options) {
    const r = await c.query(
      `insert into public.product_options (group_id, name, price_delta_kobo, is_available) values ($1, $2, $3, $4) returning id`,
      [g.rows[0].id, opt.name, opt.delta, opt.available ?? true],
    )
    ids.push(r.rows[0].id)
  }
  return { groupId: g.rows[0].id as string, optionIds: ids }
}

export async function mkDeliveryPoint(
  c: PoolClient,
  o: { active?: boolean; label?: string; lat?: number; lng?: number; radius?: number } = {},
) {
  const r = await c.query(
    `insert into public.approved_delivery_points (label, is_active, lat, lng, geofence_radius_m)
     values ($1, $2, $3, $4, $5) returning id`,
    [
      o.label ?? `Sample point ${randomUUID().slice(0, 4)} (placeholder)`,
      o.active ?? true,
      o.lat ?? null,
      o.lng ?? null,
      o.radius ?? null,
    ],
  )
  return r.rows[0].id as string
}

export async function setSetting(c: Q, key: string, value: unknown) {
  await c.query(
    `insert into public.platform_settings (key, value) values ($1, $2::jsonb)
     on conflict (key) do update set value = excluded.value`,
    [key, JSON.stringify(value)],
  )
}

/** Fixed, known pricing configuration so calculations are deterministic in tests. */
export async function fixPricing(c: Q, o: { delivery?: number; bps?: number } = {}) {
  await setSetting(c, 'delivery_fee_kobo', o.delivery ?? 50000)
  await setSetting(c, 'platform_fee_bps', o.bps ?? 500)
}

export const AAL2 = (id: string): Principal => ({ id, aal: 'aal2' })
export const AAL1 = (id: string): Principal => ({ id, aal: 'aal1' })

export async function addToCart(
  c: PoolClient,
  who: Principal,
  product: string,
  qty = 1,
  options: string[] = [],
  replace = false,
) {
  return as(
    c,
    who,
    async () =>
      (
        await c.query(`select public.cart_add_item($1, $2, $3::uuid[], $4) as r`, [
          product,
          qty,
          options,
          replace,
        ])
      ).rows[0].r,
  )
}

export async function createOrderAs(
  c: PoolClient,
  who: Principal,
  fulfilment: 'pickup' | 'delivery' = 'pickup',
  point: string | null = null,
  key?: string,
) {
  return as(
    c,
    who,
    async () =>
      (
        await c.query(`select public.create_order($1, $2, $3) as id`, [
          fulfilment,
          point,
          key ?? `key-${randomUUID()}`,
        ])
      ).rows[0].id as string,
  )
}

/** Delete committed fixtures (used by concurrency tests only). Bypasses immutability triggers on purpose. */
export async function purge(
  c: PoolClient,
  o: { users?: string[]; vendors?: string[]; points?: string[] },
) {
  await c.query(`set session_replication_role = replica`)
  try {
    if (o.users?.length) {
      const own = `(select id from public.orders where customer_id = any($1::uuid[]))`
      // Batch 6 tables (notifications and their outbox, reviews); replica mode skips cascades, so delete explicitly
      const notes = `(select id from public.notifications where user_id = any($1::uuid[]))`
      await c.query(
        `delete from public.notification_deliveries where outbox_id in (select id from public.notification_outbox where notification_id in ${notes})`,
        [o.users],
      )
      await c.query(`delete from public.notification_outbox where notification_id in ${notes}`, [
        o.users,
      ])
      await c.query(`delete from public.notifications where user_id = any($1::uuid[])`, [o.users])
      await c.query(`delete from public.notification_preferences where user_id = any($1::uuid[])`, [
        o.users,
      ])
      await c.query(
        `delete from public.review_reports where reporter_id = any($1::uuid[]) or review_id in (select id from public.reviews where customer_id = any($1::uuid[]))`,
        [o.users],
      )
      await c.query(`delete from public.reviews where customer_id = any($1::uuid[])`, [o.users])
      // Batch 5 tables (refunds, returns, cases, delivery proof sessions)
      await c.query(
        `delete from public.refund_events where refund_id in (select id from public.refunds where order_id in ${own})`,
        [o.users],
      )
      await c.query(
        `delete from public.refund_items where refund_id in (select id from public.refunds where order_id in ${own})`,
        [o.users],
      )
      await c.query(`delete from public.ledger_entries where order_id in ${own}`, [o.users])
      await c.query(`delete from public.refunds where order_id in ${own}`, [o.users])
      await c.query(
        `delete from public.return_request_items where return_id in (select id from public.return_requests where order_id in ${own})`,
        [o.users],
      )
      await c.query(`delete from public.return_requests where order_id in ${own}`, [o.users])
      for (const t of ['case_events', 'case_statements'])
        await c.query(
          `delete from public.${t} where case_id in (select id from public.support_cases where order_id in ${own})`,
          [o.users],
        )
      await c.query(`delete from public.support_cases where order_id in ${own}`, [o.users])
      await c.query(`delete from public.delivery_proof_sessions where order_id in ${own}`, [
        o.users,
      ])
      await c.query(`delete from public.handover_evidence where order_id in ${own}`, [o.users])
      await c.query(
        `delete from public.assignment_tokens where assignment_id in (select id from public.delivery_assignments where order_id in ${own} or rider_id = any($1::uuid[]))`,
        [o.users],
      )
      for (const t of ['rider_issues'])
        await c.query(
          `delete from public.${t} where order_id in ${own} or rider_id = any($1::uuid[])`,
          [o.users],
        )
      await c.query(
        `delete from public.delivery_assignments where order_id in ${own} or rider_id = any($1::uuid[])`,
        [o.users],
      )
      for (const t of ['rider_location_current', 'rider_location_history', 'rider_shifts'])
        await c.query(`delete from public.${t} where rider_id = any($1::uuid[])`, [o.users])
      for (const t of ['rider_terms_acknowledgements', 'rider_profiles'])
        await c.query(`delete from public.${t} where user_id = any($1::uuid[])`, [o.users])
      for (const t of [
        'handover_evidence',
        'pickup_codes',
        'refunds',
        'ledger_entries',
        'reconciliation_flags',
        'payment_transactions',
      ])
        await c.query(`delete from public.${t} where order_id in ${own}`, [o.users])
      await c.query(
        `delete from public.payment_attempts where order_id in (select id from public.orders where customer_id = any($1::uuid[]))`,
        [o.users],
      )
      await c.query(
        `delete from public.order_status_history where order_id in (select id from public.orders where customer_id = any($1::uuid[]))`,
        [o.users],
      )
      await c.query(
        `delete from public.order_items where order_id in (select id from public.orders where customer_id = any($1::uuid[]))`,
        [o.users],
      )
      await c.query(`delete from public.orders where customer_id = any($1::uuid[])`, [o.users])
      await c.query(`delete from public.carts where user_id = any($1::uuid[])`, [o.users])
    }
    if (o.vendors?.length) {
      await c.query(`delete from public.orders where vendor_id = any($1::uuid[])`, [o.vendors])
      await c.query(`delete from public.vendors where id = any($1::uuid[])`, [o.vendors])
    }
    if (o.points?.length)
      await c.query(`delete from public.approved_delivery_points where id = any($1::uuid[])`, [
        o.points,
      ])
    if (o.users?.length)
      await c.query(`delete from auth.users where id = any($1::uuid[])`, [o.users])
    // committed rider fixtures install an approved TEST terms version (A8); put the shipped placeholder back
    await c.query(
      `update public.platform_settings set value='"dev-placeholder-1"'::jsonb where key='rider_terms_current_version'`,
    )
  } finally {
    await c.query(`set session_replication_role = origin`)
  }
}

/** Run fn as the service role (the webhook/verify path). */
export async function svc<T>(c: PoolClient, fn: () => Promise<T>): Promise<T> {
  await c.query('set local role service_role')
  try {
    return await fn()
  } finally {
    await c.query('reset role')
  }
}

export const PNG = (n = 600) =>
  Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(n, 7)])

/** Prepare a payment as the customer and return {reference, amount_kobo}. */
export async function prepare(c: PoolClient, who: Principal, order: string) {
  return as(
    c,
    who,
    async () =>
      (await c.query(`select public.payment_prepare($1) as r`, [order])).rows[0].r as {
        reference: string
        amount_kobo: number
        currency: string
      },
  )
}

export async function applyEvent(
  c: PoolClient,
  id: string,
  type: string,
  reference: string,
  amount: number,
  currency = 'NGN',
) {
  return svc(
    c,
    async () =>
      (
        await c.query(`select public.payment_apply_event($1,$2,$3,$4,$5,'{}'::jsonb) as r`, [
          id,
          type,
          reference,
          amount,
          currency,
        ])
      ).rows[0].r as string,
  )
}

/** Drive an order to PAID through the real payment path. */
export async function payOrder(c: PoolClient, who: Principal, order: string) {
  const t = await prepare(c, who, order)
  const out = await applyEvent(
    c,
    `evt-${randomUUID()}`,
    'charge.success',
    t.reference,
    t.amount_kobo,
  )
  if (out !== 'paid') throw new Error(`expected paid, got ${out}`)
  return t
}
