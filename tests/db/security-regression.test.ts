import { afterAll, describe, expect, it } from 'vitest'
import type { PoolClient } from 'pg'
import {
  AAL1,
  AAL2,
  PRIV_DENIED,
  as,
  createUser,
  failure,
  pool,
  withTx,
  type Principal,
} from './helpers'
import { paidOrder, requestRefund } from './refund-helpers'

afterAll(async () => {
  await pool.end()
})

type Fn = { name: string; args: string; prosrc: string }
/** Every SECURITY DEFINER function in `public` that the `authenticated` role may execute. */
async function callable(c: PoolClient): Promise<Fn[]> {
  return (
    await c.query(
      `select p.proname as name, pg_get_function_identity_arguments(p.oid) as args, p.prosrc
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosecdef and has_function_privilege('authenticated', p.oid, 'execute')
        order by 1, 2`,
    )
  ).rows
}

/** Calls the function with NULL for every argument and reports whether it returned without error. */
async function succeedsWithNulls(c: PoolClient, who: Principal, f: Fn): Promise<boolean> {
  const n = f.args.trim() === '' ? 0 : f.args.split(',').length
  const types =
    f.args.trim() === '' ? [] : f.args.split(',').map((a) => a.trim().replace(/ DEFAULT .*/, ''))
  void types
  const nulls = Array(n).fill('null').join(',')
  return as(c, who, async () => {
    await c.query('savepoint s')
    try {
      await c.query(`select public.${f.name}(${nulls})`)
      await c.query('release savepoint s')
      return true
    } catch {
      await c.query('rollback to savepoint s')
      return false
    }
  })
}

// Functions that are public by design: published catalogue and published reviews. Nothing else may skip an identity check.
const NO_IDENTITY_CHECK = [
  'browse_vendors',
  'get_product',
  'get_vendor_menu',
  'get_vendor_reviews',
  'list_categories',
  'search_products',
  // Batch FIC: public receipt verification. Takes an unguessable 192-bit token; returns only a minimal, non-personal result.
  'verify_delivery_fee_receipt',
]
// Identity read-backs that are deliberately usable before the second factor (the sign-in flow needs them).
// The cart is deliberately usable at aal1 for plain customers (route policy for /cart); checkout and everything after needs aal2.
const AAL1_READS = ['list_delivery_points', 'my_roles', 'my_vendor']

describe('catalogue-wide authorisation regression', () => {
  it('every callable function checks the caller, except the published public reads', async () => {
    await withTx(async (c) => {
      const missing = (await callable(c))
        .filter((f) => !/auth\.uid\(\)|require_/.test(f.prosrc))
        .map((f) => f.name)
        .sort()
      expect(missing).toEqual(NO_IDENTITY_CHECK)
    })
  })

  it('every callable function that reads the caller also demands aal2, except three identity read-backs', async () => {
    await withTx(async (c) => {
      const lax = (await callable(c))
        .filter((f) => /auth\.uid\(\)/.test(f.prosrc) && !/is_aal2|require_/.test(f.prosrc))
        .map((f) => f.name)
        .sort()
      expect(lax).toEqual(AAL1_READS)
    })
  })

  it('anonymous callers can execute only the published reads', async () => {
    await withTx(async (c) => {
      const anon = (
        await c.query(
          `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname in ('public','app_private') and has_function_privilege('anon', p.oid, 'execute')
              and p.prokind = 'f' order by 1`,
        )
      ).rows.map((r) => r.proname as string)
      for (const name of anon) expect(NO_IDENTITY_CHECK).toContain(name)
    })
  })

  it('a signed-in customer who set up a second factor but has not completed it cannot run any function with arguments, except the pinned reads', async () => {
    await withTx(async (c) => {
      const u = await createUser(c, 'aal1')
      const ok: string[] = []
      for (const f of await callable(c)) if (await succeedsWithNulls(c, AAL1(u), f)) ok.push(f.name)
      expect([...new Set(ok)].sort()).toEqual(
        [...new Set([...NO_IDENTITY_CHECK, ...AAL1_READS])].sort(),
      )
    })
  })

  it('a plain customer at aal2 gets nothing privileged from any function called with empty arguments', async () => {
    await withTx(async (c) => {
      const u = await createUser(c, 'aal2')
      const ok: string[] = []
      for (const f of await callable(c)) if (await succeedsWithNulls(c, AAL2(u), f)) ok.push(f.name)
      // Only harmless self-scoped reads / the published reads may return. Pin them so a new function must be added consciously.
      expect([...new Set(ok)].sort()).toMatchInlineSnapshot(`
        [
          "browse_vendors",
          "cart_clear",
          "cart_quote",
          "get_notification_preferences",
          "get_product",
          "get_vendor_menu",
          "get_vendor_reviews",
          "list_categories",
          "list_delivery_points",
          "list_my_cases",
          "list_my_notifications",
          "list_returns",
          "my_data_requests",
          "my_delivery_fee_payments",
          "my_notification_delivery_summary",
          "my_roles",
          "my_vendor",
          "notification_mark_read",
          "search_products",
          "vendor_commission_terms",
          "vendor_pending_rider_pickups",
          "verify_delivery_fee_receipt",
        ]
      `)
    })
  })
})

describe('append-only records', () => {
  it('the set of tables guarded by deny_mutation, and which verbs each blocks, is pinned', async () => {
    await withTx(async (c) => {
      const rows = (
        await c.query(
          `select c.relname,
                  bool_or((t.tgtype & 16) <> 0) as blocks_update, bool_or((t.tgtype & 8) <> 0) as blocks_delete
             from pg_trigger t join pg_class c on c.oid = t.tgrelid
             join pg_proc p on p.oid = t.tgfoid join pg_namespace n on n.oid = c.relnamespace
            where p.proname = 'deny_mutation' and not t.tgisinternal and n.nspname = 'public'
            group by c.relname order by 1`,
        )
      ).rows.map((r) => `${r.relname}:${r.blocks_update ? 'U' : '-'}${r.blocks_delete ? 'D' : '-'}`)
      expect(rows).toMatchInlineSnapshot(`
        [
          "account_erasures:UD",
          "audit_events:UD",
          "case_events:UD",
          "case_statements:UD",
          "delivery_fee_payment_events:UD",
          "handover_evidence:UD",
          "job_runs:UD",
          "ledger_entries:UD",
          "notification_errors:UD",
          "notification_requeues:UD",
          "order_items:--",
          "order_settlement_adjustments:UD",
          "order_settlement_lines:UD",
          "order_status_history:UD",
          "payment_attempts:UD",
          "payment_events:UD",
          "payment_transactions:-D",
          "refund_events:UD",
          "refund_items:UD",
          "return_request_items:UD",
          "reviews:-D",
          "rider_terms_acknowledgements:UD",
        ]
      `)
    })
  })

  it('money and audit tables block both update and delete', async () => {
    await withTx(async (c) => {
      const rows = (
        await c.query(
          `select c.relname, bool_or((t.tgtype & 16) <> 0) u, bool_or((t.tgtype & 8) <> 0) d
             from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_proc p on p.oid = t.tgfoid
            where p.proname = 'deny_mutation' and not t.tgisinternal
              and c.relname in ('ledger_entries','audit_events','refund_events','order_status_history','payment_events','case_events')
            group by c.relname`,
        )
      ).rows
      expect(rows).toHaveLength(6)
      for (const r of rows) expect([r.relname, r.u, r.d]).toEqual([r.relname, true, true])
    })
  })
})

describe('boundedness: list functions that aggregate rows without a LIMIT are pinned', () => {
  // Each is bounded by something other than a LIMIT; a new unbounded list must be added here consciously, with its reason.
  const UNBOUNDED_BY_DESIGN: Record<string, string> = {
    admin_list_categories: 'small admin-managed reference table',
    list_categories: 'small admin-managed reference table',
    list_delivery_points: 'small admin-managed reference table',
    get_vendor_menu: 'one shop catalogue, written by that shop',
    list_my_cases:
      'own cases only; creation is rate limited (20/h) and capped per day by the database',
    my_assignments: 'a rider holds at most five active deliveries',
    vendor_pending_rider_pickups: 'bounded by riders x five active deliveries for one shop',
    my_order_item_balances: 'items of one order',
    my_order_refunds: 'refunds of one order (capped by the refundable balance)',
    get_case: 'one case',
    staff_case_bundle: 'one case',
    vendor_find_pickup_by_code: 'at most the orders matching one code',
  }
  it('every callable function that builds a JSON list has a LIMIT or is pinned with a reason', async () => {
    await withTx(async (c) => {
      const rows = (
        await c.query(
          `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prosecdef and has_function_privilege('authenticated', p.oid, 'execute')
              and p.prosrc ~ 'jsonb_agg|json_agg' and p.prosrc !~* '[^a-z_]limit[^a-z_]' order by 1`,
        )
      ).rows.map((r) => r.proname as string)
      expect(rows).toEqual(Object.keys(UNBOUNDED_BY_DESIGN).sort())
    })
  })
})

describe('forged identities, roles and direct writes', () => {
  it('claims that merely say "admin" grant nothing; roles come from role_assignments only', async () => {
    await withTx(async (c) => {
      const u = await createUser(c, 'forger')
      const claims = JSON.stringify({
        sub: u,
        role: 'authenticated',
        aal: 'aal2',
        app_metadata: { role: 'platform_admin', roles: ['platform_admin'] },
        user_metadata: { role: 'platform_admin' },
      })
      await c.query(
        `select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`,
        [claims, u],
      )
      await c.query('set local role authenticated')
      try {
        for (const sql of [
          'select public.admin_overview()',
          'select public.admin_job_health()',
          'select public.staff_list_refunds()',
          "select public.staff_list_review_reports('open')",
        ]) {
          const e = await failure(c, sql)
          expect(e.code, sql).toBe(PRIV_DENIED)
        }
      } finally {
        await c.query('reset role')
      }
    })
  })

  it('an authenticated user cannot write money, audit, notification, review or job tables directly', async () => {
    await withTx(async (c) => {
      const o = await paidOrder(c)
      const writes = [
        `insert into public.ledger_entries (order_id, entry_type, amount_kobo) values ('${o.order}', 'payment_received', 1)`,
        `update public.orders set status = 'COMPLETED', total_kobo = 1 where id = '${o.order}'`,
        `delete from public.orders where id = '${o.order}'`,
        `insert into public.audit_events (action) values ('forged')`,
        `insert into public.notifications (user_id, kind, title, body, event_key) values ('${o.cust}', 'order', 'x', 'y', 'forged-key')`,
        `update public.notifications set title = 'forged' where user_id = '${o.cust}'`,
        `insert into public.reviews (order_id, vendor_id, customer_id, rating) values ('${o.order}', '${o.vendor}', '${o.cust}', 5)`,
        `insert into public.job_runs (job, ok) values ('expire-orders', true)`,
        `insert into public.role_assignments (user_id, role) values ('${o.cust}', 'platform_admin')`,
        `update public.refunds set status = 'succeeded'`,
      ]
      for (const sql of writes) {
        const e = await as(c, AAL2(o.cust), () => failure(c, sql))
        expect(e.code, sql).toBe(PRIV_DENIED)
      }
    })
  })

  it('other customers and unrelated staff see none of someone elses notifications, reviews-in-progress or refunds', async () => {
    await withTx(async (c) => {
      const o = await paidOrder(c)
      await requestRefund(c, o.cust, o.order, null)
      const other = await createUser(c, 'other')
      for (const t of [
        'notifications',
        'refunds',
        'refund_events',
        'return_requests',
        'support_cases',
        'case_events',
      ]) {
        const n = await as(c, AAL2(other), async () =>
          Number((await c.query(`select count(*) n from public.${t}`)).rows[0].n),
        )
        expect(n, t).toBe(0)
      }
      const mine = await as(c, AAL2(o.cust), async () =>
        Number((await c.query('select count(*) n from public.refunds')).rows[0].n),
      )
      expect(mine).toBe(1)
    })
  })
})
