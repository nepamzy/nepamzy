import { afterAll, describe, expect, it } from 'vitest'
import type { PoolClient } from 'pg'
import {
  AAL1,
  AAL2,
  PRIV_DENIED,
  as,
  createUser,
  giveRole,
  mkDeliveryPoint,
  pool,
  svc,
} from './helpers'
import {
  POINT,
  accept,
  callFails,
  callJson,
  deliveryOrder,
  mkRider,
  mkShop,
  orderStatus,
  rider,
  isoTx,
} from './rider-helpers'

afterAll(async () => {
  await pool.end()
})

// SYNTHETIC coordinates only. 0.0001 degree of latitude is about 11 metres.
const INSIDE = { lat: POINT.lat + 0.0003, lng: POINT.lng } // ~33 m from the point (radius 60 m)
const OUTSIDE = { lat: POINT.lat + 0.0008, lng: POINT.lng } // ~89 m
const FAR = { lat: 0.0, lng: 0.0 }

type Fix = { lat: number; lng: number; accuracy?: number; ageSeconds?: number }
const post = async (c: PoolClient, rid: string, f: Fix) =>
  callJson(
    c,
    rider(rid),
    `select public.rider_post_location($1,$2,$3, now() - make_interval(secs => $4)) r`,
    [f.lat, f.lng, f.accuracy ?? 10, f.ageSeconds ?? 0],
  ) as Promise<{ accepted: boolean; reason?: string; arrivals_detected?: number }>
/** The per-rider rate limit would reject back-to-back fixes; age the stored one so tests can post in sequence. */
const age = (c: PoolClient, rid: string) =>
  c.query(
    `update public.rider_location_current set received_at = now() - interval '10 seconds' where rider_id=$1`,
    [rid],
  )

async function scenario(
  c: PoolClient,
  o: {
    state?: 'assigned' | 'picked_up' | 'en_route'
    shop?: Awaited<ReturnType<typeof mkShop>>
  } = {},
) {
  const x = await deliveryOrder(c, { shop: o.shop })
  const r = await mkRider(c)
  const a = await accept(c, r.id, x.order)
  const st = o.state ?? 'en_route'
  if (st !== 'assigned') {
    const t = (await callJson(c, rider(r.id), `select public.rider_issue_handover_token($1) r`, [
      a.assignment_id,
    ])) as { token: string }
    await callJson(c, AAL2(x.owner), `select public.vendor_confirm_rider_pickup($1,$2) r`, [
      x.order,
      t.token,
    ])
  }
  if (st === 'en_route')
    await callJson(c, rider(r.id), `select public.rider_start_route($1) r`, [a.assignment_id])
  return { ...x, r, a }
}
const cnt = async (c: PoolClient, t: string) =>
  Number((await c.query(`select count(*)::int n from public.${t}`)).rows[0].n)

describe('tracking lifecycle: off by default, on only with an active shift AND active work', () => {
  it('refuses location writes without a shift, without active work, and after going inactive', async () => {
    await isoTx(async (c) => {
      const noShift = await mkRider(c, { active: false })
      expect(
        (
          await callFails(
            c,
            rider(noShift.id),
            `select public.rider_post_location(0.01,0.01,10,now())`,
          )
        ).message,
      ).toMatch(/tracking_not_active/)
      const idle = await mkRider(c)
      expect(
        (
          await callFails(
            c,
            rider(idle.id),
            `select public.rider_post_location(0.01,0.01,10,now())`,
          )
        ).message,
      ).toMatch(/tracking_not_active/)
      const s = await scenario(c, { state: 'assigned' })
      expect((await post(c, s.r.id, FAR)).accepted).toBe(true)
      expect(await cnt(c, 'rider_location_current')).toBe(1)
      // releasing the only assignment (shift end) stops collection and deletes the current position
      await callJson(c, rider(s.r.id), `select public.rider_go_inactive() r`)
      expect(await cnt(c, 'rider_location_current')).toBe(0)
      expect(
        (await callFails(c, rider(s.r.id), `select public.rider_post_location(0.01,0.01,10,now())`))
          .message,
      ).toMatch(/tracking_not_active/)
    })
  })

  it('unapproved, suspended, aal1 and anonymous callers cannot post', async () => {
    await isoTx(async (c) => {
      const s = await scenario(c)
      for (const who of [AAL1(s.r.id), null]) {
        expect(
          (await callFails(c, who, `select public.rider_post_location(0.01,0.01,10,now())`)).code,
        ).toBe(PRIV_DENIED)
      }
      const customer = await createUser(c, 'cust')
      expect(
        (
          await callFails(
            c,
            AAL2(customer),
            `select public.rider_post_location(0.01,0.01,10,now())`,
          )
        ).code,
      ).toBe(PRIV_DENIED)
      await c.query(`update public.rider_profiles set status='suspended' where user_id=$1`, [
        s.r.id,
      ])
      expect(
        (await callFails(c, rider(s.r.id), `select public.rider_post_location(0.01,0.01,10,now())`))
          .code,
      ).toBe(PRIV_DENIED)
    })
  })
})

describe('fix validation', () => {
  it('rejects malformed, inaccurate, stale, future-dated and too-frequent fixes and stores nothing for them', async () => {
    await isoTx(async (c) => {
      const s = await scenario(c)
      const rejected = async (f: Partial<Fix> & { lat?: number; lng?: number }, reason: string) => {
        const r = await post(c, s.r.id, { lat: 0.5, lng: 0.5, ...f })
        expect(r).toMatchObject({ accepted: false, reason })
      }
      await rejected({ lat: 91 }, 'malformed')
      await rejected({ lng: 181 }, 'malformed')
      await rejected({ accuracy: -1 }, 'malformed')
      await rejected({ accuracy: 500 }, 'inaccurate')
      await rejected({ ageSeconds: 600 }, 'stale')
      await rejected({ ageSeconds: -300 }, 'implausible_time')
      expect(await cnt(c, 'rider_location_current')).toBe(0)
      expect(await cnt(c, 'rider_location_history')).toBe(0)
      const nan = await callJson(
        c,
        rider(s.r.id),
        `select public.rider_post_location('NaN'::float8, 0.5, 10, now()) r`,
      )
      expect(nan).toMatchObject({ accepted: false, reason: 'malformed' })
      expect((await post(c, s.r.id, { lat: 0.5, lng: 0.5 })).accepted).toBe(true)
      expect(await post(c, s.r.id, { lat: 0.5, lng: 0.5 })).toMatchObject({
        accepted: false,
        reason: 'rate_limited',
      })
      expect(await cnt(c, 'rider_location_history')).toBe(1)
    })
  })

  it('has no parameter through which a client could claim arrival', async () => {
    await isoTx(async (c) => {
      const r = await c.query(
        `select pg_get_function_arguments(p.oid) a from pg_proc p where p.proname='rider_post_location'`,
      )
      expect(r.rows[0].a).not.toMatch(/arriv/i)
      const all = await c.query(
        `select p.proname, pg_get_function_arguments(p.oid) a from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname='public' and (p.proname ilike '%arriv%' or pg_get_function_arguments(p.oid) ilike '%arriv%')`,
      )
      expect(all.rows).toEqual([])
    })
  })
})

describe('server-side arrival (geofence + freshness + accuracy + en-route only)', () => {
  it('a fresh accurate fix inside the geofence while EN_ROUTE detects arrival; it never completes the order', async () => {
    await isoTx(async (c) => {
      const s = await scenario(c)
      expect(await post(c, s.r.id, FAR)).toMatchObject({ accepted: true, arrivals_detected: 0 })
      expect(await orderStatus(c, s.order)).toBe('EN_ROUTE')
      await age(c, s.r.id)
      expect(await post(c, s.r.id, OUTSIDE)).toMatchObject({ accepted: true, arrivals_detected: 0 })
      await age(c, s.r.id)
      expect(await post(c, s.r.id, INSIDE)).toMatchObject({ accepted: true, arrivals_detected: 1 })
      expect(await orderStatus(c, s.order)).toBe('ARRIVAL_DETECTED')
      expect(
        (
          await c.query(`select arrival_detected_at from public.delivery_assignments where id=$1`, [
            s.a.assignment_id,
          ])
        ).rows[0].arrival_detected_at,
      ).not.toBeNull()
      await age(c, s.r.id)
      expect((await post(c, s.r.id, INSIDE)).arrivals_detected).toBe(0) // only once
      expect(await orderStatus(c, s.order)).toBe('ARRIVAL_DETECTED')
    })
  })

  it('stale, inaccurate or out-of-state fixes inside the fence do NOT establish arrival', async () => {
    await isoTx(async (c) => {
      const shop = await mkShop(c)
      const stale = await scenario(c, { shop })
      expect(await post(c, stale.r.id, { ...INSIDE, ageSeconds: 60 })).toMatchObject({
        accepted: true,
        arrivals_detected: 0,
      }) // older than arrival_max_age (30 s)
      expect(await orderStatus(c, stale.order)).toBe('EN_ROUTE')
      const sloppy = await scenario(c, { shop })
      expect(await post(c, sloppy.r.id, { ...INSIDE, accuracy: 80 })).toMatchObject({
        accepted: true,
        arrivals_detected: 0,
      }) // worse than arrival_max_accuracy (50 m)
      expect(await orderStatus(c, sloppy.order)).toBe('EN_ROUTE')
      const early = await scenario(c, { shop, state: 'picked_up' })
      expect(await post(c, early.r.id, INSIDE)).toMatchObject({
        accepted: true,
        arrivals_detected: 0,
      })
      expect(await orderStatus(c, early.order)).toBe('PICKED_UP_BY_RIDER')
      const assigned = await scenario(c, { shop, state: 'assigned' })
      expect((await post(c, assigned.r.id, INSIDE)).arrivals_detected).toBe(0)
    })
  })

  it('a delivery point without coordinates never produces an arrival; geofence radius is respected at the boundary', async () => {
    await isoTx(async (c) => {
      const shop = await mkShop(c)
      const noGeo = await mkDeliveryPoint(c)
      await c.query(`update public.approved_delivery_points set lat=null,lng=null where id=$1`, [
        noGeo,
      ])
      const x = await deliveryOrder(c, { shop: { ...shop, point: noGeo } })
      const r = await mkRider(c)
      const a = await accept(c, r.id, x.order)
      const t = (await callJson(c, rider(r.id), `select public.rider_issue_handover_token($1) r`, [
        a.assignment_id,
      ])) as { token: string }
      await callJson(c, AAL2(x.owner), `select public.vendor_confirm_rider_pickup($1,$2) r`, [
        x.order,
        t.token,
      ])
      await callJson(c, rider(r.id), `select public.rider_start_route($1) r`, [a.assignment_id])
      expect((await post(c, r.id, INSIDE)).arrivals_detected).toBe(0)
      // boundary: distances computed by the same function the database uses
      const d = async (p: { lat: number; lng: number }) =>
        Number(
          (
            await c.query(`select app_private.haversine_m($1,$2,$3,$4) d`, [
              p.lat,
              p.lng,
              POINT.lat,
              POINT.lng,
            ])
          ).rows[0].d,
        )
      expect(await d(INSIDE)).toBeLessThan(POINT.radius)
      expect(await d(OUTSIDE)).toBeGreaterThan(POINT.radius)
    })
  })
})

describe('privacy of live location', () => {
  it('only the ordering customer sees the rider, only in transit; stale is flagged; nobody else can read it', async () => {
    await isoTx(async (c) => {
      const s = await scenario(c)
      const before = await scenario(c, { state: 'assigned' })
      // tracking opens as soon as a rider has accepted: there is no position yet, but the customer is told so
      expect(
        await callJson(c, AAL2(before.cust), `select public.get_order_tracking($1) r`, [
          before.order,
        ]),
      ).toMatchObject({ tracking: false, reason: 'no_location_yet' })
      expect(
        await callJson(c, AAL2(s.cust), `select public.get_order_tracking($1) r`, [s.order]),
      ).toMatchObject({ tracking: false, reason: 'no_location_yet' })
      await post(c, s.r.id, OUTSIDE)
      const t = await callJson(c, AAL2(s.cust), `select public.get_order_tracking($1) r`, [s.order])
      expect(t.tracking).toBe(true)
      expect(t.rider).toMatchObject({ lat: OUTSIDE.lat, lng: OUTSIDE.lng, stale: false })
      expect(t.destination).toMatchObject({ synthetic: true })
      expect(Object.keys(t.rider).sort()).toEqual([
        'accuracy_m',
        'age_seconds',
        'lat',
        'lng',
        'observed_at',
        'stale',
      ])
      await c.query(
        `update public.rider_location_current set observed_at = now() - interval '5 minutes' where rider_id=$1`,
        [s.r.id],
      )
      expect(
        (await callJson(c, AAL2(s.cust), `select public.get_order_tracking($1) r`, [s.order])).rider
          .stale,
      ).toBe(true)

      const other = await createUser(c, 'other')
      const otherRider = await mkRider(c)
      for (const who of [
        AAL2(other),
        rider(otherRider.id),
        AAL2(s.owner),
        rider(s.r.id),
        AAL1(s.cust),
        null,
      ]) {
        expect(
          (await callFails(c, who, `select public.get_order_tracking($1)`, [s.order])).code,
          JSON.stringify(who),
        ).toBe(PRIV_DENIED)
      }
    })
  })

  it('no location after the order leaves transit or the rider stops sharing', async () => {
    await isoTx(async (c) => {
      const s = await scenario(c)
      await post(c, s.r.id, OUTSIDE)
      await c.query(`update public.orders set status='COMPLETED' where id=$1`, [s.order])
      expect(
        await callJson(c, AAL2(s.cust), `select public.get_order_tracking($1) r`, [s.order]),
      ).toMatchObject({ tracking: false, reason: 'not_in_transit' })
      await c.query(`update public.orders set status='EN_ROUTE' where id=$1`, [s.order])
      await c.query(
        `update public.rider_shifts set ended_at=now(), end_reason='ops' where rider_id=$1 and ended_at is null`,
        [s.r.id],
      )
      expect(
        await callJson(c, AAL2(s.cust), `select public.get_order_tracking($1) r`, [s.order]),
      ).toMatchObject({ tracking: false, reason: 'rider_not_sharing' })
    })
  })

  it('staff need an operational purpose, every view is audited, and vendors/finance cannot use the staff path', async () => {
    await isoTx(async (c) => {
      const s = await scenario(c)
      await post(c, s.r.id, OUTSIDE)
      const ops = await createUser(c, 'ops')
      await giveRole(c, ops, 'support_agent')
      const fin = await createUser(c, 'fin')
      await giveRole(c, fin, 'finance_admin')
      expect(
        (
          await callFails(c, AAL2(ops), `select public.staff_get_order_tracking($1,'short')`, [
            s.order,
          ])
        ).message,
      ).toMatch(/purpose_required/)
      const before = await cnt(c, `audit_events where action='tracking.staff_viewed'`)
      const t = await callJson(
        c,
        AAL2(ops),
        `select public.staff_get_order_tracking($1,'customer reports rider is lost') r`,
        [s.order],
      )
      expect(t.tracking).toBe(true)
      expect(await cnt(c, `audit_events where action='tracking.staff_viewed'`)).toBe(before + 1)
      for (const who of [AAL2(fin), AAL2(s.owner), AAL2(s.cust), rider(s.r.id), AAL1(ops)]) {
        expect(
          (
            await callFails(
              c,
              who,
              `select public.staff_get_order_tracking($1,'a long enough purpose')`,
              [s.order],
            )
          ).code,
        ).toBe(PRIV_DENIED)
      }
    })
  })
})

describe('retention and purge', () => {
  it('deletes only history older than the retention window, plus current rows of ended shifts; service role only', async () => {
    await isoTx(async (c) => {
      const s = await scenario(c)
      await post(c, s.r.id, OUTSIDE)
      await c.query(
        `insert into public.rider_location_history (rider_id, shift_id, lat, lng, accuracy_m, observed_at, received_at)
         values ($1,$2,0.5,0.5,10,now()-interval '49 hours',now()-interval '49 hours'),
                ($1,$2,0.5,0.5,10,now()-interval '23 hours',now()-interval '23 hours')`,
        [s.r.id, s.r.shift],
      )
      for (const who of [AAL2(s.cust), rider(s.r.id), null]) {
        expect(
          (
            await as(c, who, async () =>
              c
                .query(`select 1`)
                .then(() => callFails(c, who, `select public.purge_location_data()`)),
            )
          ).code,
        ).toBe(PRIV_DENIED)
      }
      const r = await svc(
        c,
        async () => (await c.query(`select public.purge_location_data() r`)).rows[0].r,
      )
      expect(r.history_deleted).toBe(1)
      expect(await cnt(c, 'rider_location_history')).toBe(2) // the fresh fix + the 23 h one
      expect(await cnt(c, 'rider_location_current')).toBe(1) // shift still active
      await c.query(`update public.rider_shifts set ended_at=now(), end_reason='ops' where id=$1`, [
        s.r.shift,
      ])
      const r2 = await svc(
        c,
        async () => (await c.query(`select public.purge_location_data() r`)).rows[0].r,
      )
      expect(r2.current_deleted).toBe(1)
      // a shorter configured window deletes more
      await c.query(
        `update public.platform_settings set value='1'::jsonb where key='location_history_retention_hours'`,
      )
      const r3 = await svc(
        c,
        async () => (await c.query(`select public.purge_location_data() r`)).rows[0].r,
      )
      expect(r3.history_deleted).toBe(1) // the 23 h row now exceeds 1 h; the fresh one stays
      expect(await cnt(c, 'rider_location_history')).toBe(1)
    })
  })

  it('location settings are validated when an admin changes them', async () => {
    await isoTx(async (c) => {
      const admin = await createUser(c, 'admin')
      await giveRole(c, admin, 'platform_admin')
      for (const [k, v] of [
        ['location_max_accuracy_m', 0],
        ['location_history_retention_hours', 100000],
        ['arrival_max_age_seconds', 'x'],
        ['default_geofence_radius_m', 5],
      ] as const) {
        expect(
          (
            await callFails(
              c,
              AAL2(admin),
              `select public.set_platform_setting($1,$2::jsonb, 'Fixture reason for this test')`,
              [k, JSON.stringify(v)],
            )
          ).code,
          k,
        ).toBe('22023')
      }
      await callJson(
        c,
        AAL2(admin),
        `select public.set_platform_setting('location_history_retention_hours','48'::jsonb, 'Fixture reason for this test') r`,
      )
      expect(
        (
          await callFails(
            c,
            AAL2(admin),
            `select public.set_platform_setting('typed_signature_enabled','"yes"'::jsonb, 'Fixture reason for this test')`,
          )
        ).code,
      ).toBe('22023')
    })
  })
})
