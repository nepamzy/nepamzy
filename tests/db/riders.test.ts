import { afterAll, describe, expect, it } from 'vitest'
import {
  AAL1,
  AAL2,
  PRIV_DENIED,
  as,
  createUser,
  failure,
  giveRole,
  mkVendor,
  pool,
  svc,
} from './helpers'
import {
  accept,
  callFails,
  callJson,
  currentTermsVersion,
  deliveryOrder,
  isoTx,
  mkRider,
  mkShop,
  orderStatus,
  rider,
  vendorAct,
} from './rider-helpers'

afterAll(async () => {
  await pool.end()
})

const hist = async (c: Parameters<typeof orderStatus>[0], order: string) =>
  (
    await c.query(
      `select to_status from public.order_status_history where order_id=$1 order by id`,
      [order],
    )
  ).rows.map((r) => r.to_status as string)

describe('rider application and approval', () => {
  it('a customer applies at aal2; an admin approves (profile + role); nobody approves themself', async () => {
    await isoTx(async (c) => {
      const u = await createUser(c, 'applicant')
      const admin = await createUser(c, 'admin')
      await giveRole(c, admin, 'platform_admin')
      const id = await callJson(
        c,
        AAL2(u),
        `select public.submit_rider_application('Ada Rider','08012345678','bicycle',true) r`,
      )
      expect(
        (
          await callFails(
            c,
            AAL2(u),
            `select public.submit_rider_application('Ada Rider','08012345678','bicycle',true)`,
          )
        ).message,
      ).toMatch(/application_pending/)
      expect(
        (
          await callFails(
            c,
            AAL1(u),
            `select public.submit_rider_application('Ada Rider','08012345678',null,true)`,
          )
        ).code,
      ).toBe(PRIV_DENIED)
      expect(
        (
          await callFails(c, AAL2(u), `select public.decide_rider_application($1,'approve',null)`, [
            id,
          ])
        ).code,
      ).toBe(PRIV_DENIED)
      expect(
        (
          await callFails(
            c,
            AAL1(admin),
            `select public.decide_rider_application($1,'approve',null)`,
            [id],
          )
        ).code,
      ).toBe(PRIV_DENIED)
      await callJson(
        c,
        AAL2(admin),
        `select public.decide_rider_application($1,'approve',null) r`,
        [id],
      )
      const prof = (
        await c.query(`select status, full_name from public.rider_profiles where user_id=$1`, [u])
      ).rows[0]
      expect(prof).toEqual({ status: 'approved', full_name: 'Ada Rider' })
      expect(
        (
          await c.query(
            `select 1 from public.role_assignments where user_id=$1 and role='rider' and status='active'`,
            [u],
          )
        ).rowCount,
      ).toBe(1)
      expect(
        (
          await callFails(
            c,
            AAL2(admin),
            `select public.decide_rider_application($1,'reject','no reason')`,
            [id],
          )
        ).message,
      ).toMatch(/already decided/)
    })
  })

  it('an admin cannot approve their own application; rejection needs a reason; applicants see only their own', async () => {
    await isoTx(async (c) => {
      const admin = await createUser(c, 'admin')
      await giveRole(c, admin, 'platform_admin')
      const mine = await callJson(
        c,
        AAL2(admin),
        `select public.submit_rider_application('Admin Self','08012345678',null,true) r`,
      )
      expect(
        (
          await callFails(
            c,
            AAL2(admin),
            `select public.decide_rider_application($1,'approve',null)`,
            [mine],
          )
        ).message,
      ).toMatch(/your own/)
      const other = await createUser(c, 'other')
      const oid = await callJson(
        c,
        AAL2(other),
        `select public.submit_rider_application('Other Person','08012345679',null,true) r`,
      )
      expect(
        (
          await callFails(
            c,
            AAL2(admin),
            `select public.decide_rider_application($1,'reject','')`,
            [oid],
          )
        ).message,
      ).toMatch(/reason/)
      const seen = await as(c, AAL2(other), async () =>
        (await c.query(`select id from public.rider_applications`)).rows.map((r) => r.id),
      )
      expect(seen).toEqual([oid])
    })
  })

  it('suspension removes the role and ends the shift; reinstatement restores the role', async () => {
    await isoTx(async (c) => {
      const admin = await createUser(c, 'admin')
      await giveRole(c, admin, 'platform_admin')
      const r = await mkRider(c)
      await callJson(
        c,
        AAL2(admin),
        `select public.set_rider_status($1,'suspended','conduct complaint 123') r`,
        [r.id],
      )
      expect(
        (
          await c.query(
            `select 1 from public.role_assignments where user_id=$1 and role='rider' and status='active'`,
            [r.id],
          )
        ).rowCount,
      ).toBe(0)
      expect(
        (
          await c.query(
            `select 1 from public.rider_shifts where rider_id=$1 and ended_at is null`,
            [r.id],
          )
        ).rowCount,
      ).toBe(0)
      expect((await callFails(c, rider(r.id), `select public.rider_go_active()`)).code).toBe(
        PRIV_DENIED,
      )
      await callJson(
        c,
        AAL2(admin),
        `select public.set_rider_status($1,'approved','appeal accepted 456') r`,
        [r.id],
      )
      expect(
        (
          await c.query(
            `select 1 from public.role_assignments where user_id=$1 and role='rider' and status='active'`,
            [r.id],
          )
        ).rowCount,
      ).toBe(1)
      expect(
        (
          await callFails(c, AAL2(r.id), `select public.set_rider_status($1,'suspended','x')`, [
            r.id,
          ])
        ).code,
      ).toBe(PRIV_DENIED)
    })
  })
})

describe('A8/K48: placeholder rider terms never authorise rider work', () => {
  const usePlaceholder = (c: Parameters<typeof orderStatus>[0]) =>
    c.query(
      `update public.platform_settings set value='"dev-placeholder-1"'::jsonb where key='rider_terms_current_version'`,
    )

  it('the shipped default terms are a placeholder, and the seeded version is flagged as one', async () => {
    const { rows } = await pool.query(
      `select is_placeholder from public.rider_terms_versions where version='dev-placeholder-1'`,
    )
    expect(rows[0].is_placeholder).toBe(true)
  })

  it('placeholder terms are refused for acknowledgement, Go Active and accepting a delivery', async () => {
    await isoTx(async (c) => {
      const r = await mkRider(c, { active: true })
      const o = await deliveryOrder(c, { ready: true })
      await usePlaceholder(c)
      expect(
        (await callFails(c, rider(r.id), `select public.rider_ack_terms('dev-placeholder-1')`))
          .message,
      ).toMatch(/terms_not_approved/)
      // a rider who acknowledged earlier (approved fixture) and has an active shift still cannot take NEW work
      expect(
        (await callFails(c, rider(r.id), `select public.rider_accept_order($1)`, [o.order]))
          .message,
      ).toMatch(/terms_not_approved/)
      await c.query(`delete from public.rider_shifts where rider_id=$1`, [r.id])
      expect((await callFails(c, rider(r.id), `select public.rider_go_active()`)).message).toMatch(
        /terms_not_approved/,
      )
      // even with an acknowledgement row for the placeholder (inserted directly), the database still refuses
      await c.query(
        `insert into public.rider_terms_acknowledgements (user_id, version) values ($1,'dev-placeholder-1')`,
        [r.id],
      )
      expect((await callFails(c, rider(r.id), `select public.rider_go_active()`)).message).toMatch(
        /terms_not_approved/,
      )
      expect(await orderStatus(c, o.order)).toBe('AWAITING_RIDER')
    })
  })

  it('an unknown or missing current version is refused like a placeholder', async () => {
    await isoTx(async (c) => {
      const r = await mkRider(c, { active: false })
      await c.query(
        `update public.platform_settings set value='"no-such-version"'::jsonb where key='rider_terms_current_version'`,
      )
      expect((await callFails(c, rider(r.id), `select public.rider_go_active()`)).message).toMatch(
        /terms_not_approved/,
      )
      await c.query(`delete from public.platform_settings where key='rider_terms_current_version'`)
      expect((await callFails(c, rider(r.id), `select public.rider_go_active()`)).message).toMatch(
        /terms_not_approved/,
      )
    })
  })

  it('approved (non-placeholder) terms work end to end, and switching back to a placeholder blocks again', async () => {
    await isoTx(async (c) => {
      const r = await mkRider(c, { active: false })
      const o = await deliveryOrder(c, { ready: true })
      await callJson(c, rider(r.id), `select public.rider_go_active() r`)
      const acc = await callJson(c, rider(r.id), `select public.rider_accept_order($1) r`, [
        o.order,
      ])
      expect(acc.already_assigned).toBe(false)
      const me = await callJson(c, rider(r.id), `select public.my_rider() r`)
      expect(me.terms_approved).toBe(true)
      expect(me.terms_is_placeholder).toBe(false)
      await usePlaceholder(c)
      const me2 = await callJson(c, rider(r.id), `select public.my_rider() r`)
      expect(me2.terms_approved).toBe(false)
      expect(me2.terms_is_placeholder).toBe(true)
      const o2 = await deliveryOrder(c, { ready: true })
      expect(
        (await callFails(c, rider(r.id), `select public.rider_accept_order($1)`, [o2.order]))
          .message,
      ).toMatch(/terms_not_approved/)
    })
  })

  it('rider_terms_versions cannot be edited through the API (approved wording needs direct database access)', async () => {
    await isoTx(async (c) => {
      const r = await mkRider(c, { active: false })
      const e = await callFails(
        c,
        rider(r.id),
        `update public.rider_terms_versions set is_placeholder=false where version='dev-placeholder-1'`,
      )
      expect(e.code).toBe(PRIV_DENIED)
      const admin = await createUser(c, 'admin')
      await giveRole(c, admin, 'platform_admin')
      const e2 = await callFails(
        c,
        AAL2(admin),
        `update public.rider_terms_versions set is_placeholder=false where version='dev-placeholder-1'`,
      )
      expect(e2.code).toBe(PRIV_DENIED)
    })
  })
})

describe('terms acknowledgement and shifts', () => {
  it('Go Active is refused until the CURRENT terms version is acknowledged, then recorded and idempotent', async () => {
    await isoTx(async (c) => {
      const r = await mkRider(c, { terms: false, active: false })
      expect((await callFails(c, rider(r.id), `select public.rider_go_active()`)).message).toMatch(
        /terms_not_acknowledged/,
      )
      expect(
        (await callFails(c, rider(r.id), `select public.rider_ack_terms('old-version')`)).message,
      ).toMatch(/terms_version_mismatch/)
      const v = await currentTermsVersion(c)
      await callJson(c, rider(r.id), `select public.rider_ack_terms($1) r`, [v])
      const ack = (
        await c.query(
          `select version, acknowledged_at from public.rider_terms_acknowledgements where user_id=$1`,
          [r.id],
        )
      ).rows
      expect(ack).toHaveLength(1)
      expect(ack[0].version).toBe(v)
      const s1 = await callJson(c, rider(r.id), `select public.rider_go_active() r`)
      const s2 = await callJson(c, rider(r.id), `select public.rider_go_active() r`)
      expect(s1).toBe(s2)
      // a NEW terms version needs a new acknowledgement
      await c.query(
        `insert into public.rider_terms_versions (version,title,body,is_placeholder) values ('v2','t','b',false)`,
      )
      await c.query(
        `update public.platform_settings set value='"v2"'::jsonb where key='rider_terms_current_version'`,
      )
      await callJson(c, rider(r.id), `select public.rider_go_inactive() r`)
      expect((await callFails(c, rider(r.id), `select public.rider_go_active()`)).message).toMatch(
        /terms_not_acknowledged/,
      )
    })
  })

  it('acknowledgements are append-only', async () => {
    await isoTx(async (c) => {
      const r = await mkRider(c)
      expect(
        (
          await failure(
            c,
            `update public.rider_terms_acknowledgements set version='x' where user_id=$1`,
            [r.id],
          )
        ).message,
      ).toMatch(/append-only|immutable|not allowed|denied/i)
    })
  })

  it('unapproved, suspended, role-less and aal1 callers cannot go active', async () => {
    await isoTx(async (c) => {
      const pending = await mkRider(c, { status: 'pending', active: false })
      const suspended = await mkRider(c, { status: 'suspended', active: false })
      const noRole = await mkRider(c, { role: false, active: false })
      const ok = await mkRider(c, { active: false })
      for (const who of [
        AAL2(pending.id),
        AAL2(suspended.id),
        AAL2(noRole.id),
        AAL1(ok.id),
        null,
      ]) {
        expect((await callFails(c, who, `select public.rider_go_active()`)).code).toBe(PRIV_DENIED)
      }
      expect(await callJson(c, AAL2(ok.id), `select public.rider_go_active() r`)).toBeTruthy()
    })
  })
})

describe('delivery offers', () => {
  it('only an active rider sees offers; only delivery orders awaiting a rider appear; no customer details leak', async () => {
    await isoTx(async (c) => {
      const shop = await mkShop(c)
      const ready = await deliveryOrder(c, { shop })
      await deliveryOrder(c, { shop, ready: false }) // PAID, not ready
      const idle = await mkRider(c, { active: false })
      const r = await mkRider(c)
      expect(
        (await callFails(c, rider(idle.id), `select public.list_delivery_offers()`)).message,
      ).toMatch(/not_active/)
      const offers = (await callJson(
        c,
        rider(r.id),
        `select public.list_delivery_offers() r`,
      )) as Record<string, unknown>[]
      expect(offers.map((o) => o.order_id)).toEqual([ready.order])
      expect(Object.keys(offers[0]!).sort()).toEqual([
        'deliver_to',
        'offered_at',
        'order_id',
        'order_number',
        'pickup',
        'vendor_name',
      ])
      expect((await callFails(c, null, `select public.list_delivery_offers()`)).code).toBe(
        PRIV_DENIED,
      )
    })
  })
})

describe('accepting an order', () => {
  it('moves the order AWAITING_RIDER -> RIDER_ASSIGNED once, records history, and is idempotent for the same rider', async () => {
    await isoTx(async (c) => {
      const o = await deliveryOrder(c)
      const r = await mkRider(c)
      const a = await accept(c, r.id, o.order)
      expect(a.slot).toBe(1)
      expect(await orderStatus(c, o.order)).toBe('RIDER_ASSIGNED')
      expect((await hist(c, o.order)).slice(-2)).toEqual(['AWAITING_RIDER', 'RIDER_ASSIGNED'])
      const again = await accept(c, r.id, o.order)
      expect(again.assignment_id).toBe(a.assignment_id)
      expect(again.already_assigned).toBe(true)
      expect(
        (await c.query(`select 1 from public.delivery_assignments where order_id=$1`, [o.order]))
          .rowCount,
      ).toBe(1)
      const other = await mkRider(c)
      expect(
        (await callFails(c, rider(other.id), `select public.rider_accept_order($1)`, [o.order]))
          .message,
      ).toMatch(/order_unavailable/)
    })
  })

  it('refuses inactive, unapproved, suspended, no-terms and aal1 riders; and unready, unpaid or pickup orders', async () => {
    await isoTx(async (c) => {
      const shop = await mkShop(c)
      const ready = await deliveryOrder(c, { shop })
      const notReady = await deliveryOrder(c, { shop, ready: false })
      const idle = await mkRider(c, { active: false })
      const pending = await mkRider(c, { status: 'pending' })
      const susp = await mkRider(c, { status: 'suspended' })
      const noTerms = await mkRider(c, { terms: false })
      const ok = await mkRider(c)
      expect(
        (await callFails(c, rider(idle.id), `select public.rider_accept_order($1)`, [ready.order]))
          .message,
      ).toMatch(/not_active/)
      for (const r of [pending, susp])
        expect(
          (await callFails(c, rider(r.id), `select public.rider_accept_order($1)`, [ready.order]))
            .code,
        ).toBe(PRIV_DENIED)
      expect(
        (
          await callFails(c, rider(noTerms.id), `select public.rider_accept_order($1)`, [
            ready.order,
          ])
        ).message,
      ).toMatch(/terms_not_acknowledged/)
      expect(
        (await callFails(c, AAL1(ok.id), `select public.rider_accept_order($1)`, [ready.order]))
          .code,
      ).toBe(PRIV_DENIED)
      expect(
        (await callFails(c, rider(ok.id), `select public.rider_accept_order($1)`, [notReady.order]))
          .message,
      ).toMatch(/order_unavailable/)
      // an unpaid delivery order
      const { addToCart, createOrderAs } = await import('./helpers')
      const cust = await createUser(c, 'cust2')
      await addToCart(c, AAL2(cust), shop.product, 1)
      const unpaid = await createOrderAs(c, AAL2(cust), 'delivery', shop.point)
      expect(
        (await callFails(c, rider(ok.id), `select public.rider_accept_order($1)`, [unpaid]))
          .message,
      ).toMatch(/order_unavailable/)
      // a pickup order
      await addToCart(c, AAL2(cust), shop.product, 1)
      const pick = await createOrderAs(c, AAL2(cust), 'pickup')
      expect(
        (await callFails(c, rider(ok.id), `select public.rider_accept_order($1)`, [pick])).message,
      ).toMatch(/order_unavailable/)
      expect((await c.query(`select 1 from public.delivery_assignments`)).rowCount).toBe(0)
    })
  })

  it('the sixth active delivery is refused; the slot of a released delivery is reused', async () => {
    await isoTx(async (c) => {
      const shop = await mkShop(c)
      const r = await mkRider(c)
      const orders: string[] = []
      for (let i = 0; i < 6; i++) orders.push((await deliveryOrder(c, { shop })).order)
      const slots: number[] = []
      for (const o of orders.slice(0, 5)) slots.push((await accept(c, r.id, o)).slot)
      expect(slots.sort()).toEqual([1, 2, 3, 4, 5])
      expect(
        (await callFails(c, rider(r.id), `select public.rider_accept_order($1)`, [orders[5]]))
          .message,
      ).toMatch(/capacity_reached/)
      expect(await orderStatus(c, orders[5]!)).toBe('AWAITING_RIDER')
      // free one slot through the real shift-end path of an ops release
      const ops = await createUser(c, 'ops')
      await giveRole(c, ops, 'support_agent')
      const a = (
        await c.query(`select id from public.delivery_assignments where order_id=$1`, [orders[2]])
      ).rows[0].id
      await callJson(
        c,
        AAL2(ops),
        `select public.ops_release_assignment($1,'rider unreachable') r`,
        [a],
      )
      expect(await orderStatus(c, orders[2]!)).toBe('AWAITING_RIDER')
      expect((await accept(c, r.id, orders[5]!)).slot).toBe(3)
    })
  })
})

describe('vendor-to-rider handover token', () => {
  async function assigned(c: Parameters<typeof orderStatus>[0]) {
    const o = await deliveryOrder(c)
    const r = await mkRider(c)
    const a = await accept(c, r.id, o.order)
    return { ...o, r, a }
  }
  const issue = (c: Parameters<typeof orderStatus>[0], rid: string, a: string) =>
    callJson(c, rider(rid), `select public.rider_issue_handover_token($1) r`, [a]) as Promise<{
      token: string
      expires_at: string
    }>
  const confirm = (
    c: Parameters<typeof orderStatus>[0],
    owner: string,
    order: string,
    token: string,
  ) =>
    callJson(c, AAL2(owner), `select public.vendor_confirm_rider_pickup($1,$2) r`, [
      order,
      token,
    ]) as Promise<{ ok: boolean; reason?: string }>

  it('stores only a hash, is bound to the assignment, and a correct token advances the order exactly once', async () => {
    await isoTx(async (c) => {
      const x = await assigned(c)
      const t = await issue(c, x.r.id, x.a.assignment_id)
      expect(t.token).toMatch(/^[0-9A-F]{10}$/)
      const row = (
        await c.query(`select token_hash from public.assignment_tokens where assignment_id=$1`, [
          x.a.assignment_id,
        ])
      ).rows[0]
      expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/)
      expect(row.token_hash).not.toContain(t.token.toLowerCase())
      expect(await confirm(c, x.owner, x.order, t.token.toLowerCase())).toEqual({ ok: true })
      expect(await orderStatus(c, x.order)).toBe('PICKED_UP_BY_RIDER')
      expect((await confirm(c, x.owner, x.order, t.token)).ok).toBe(false) // replay
      expect(await orderStatus(c, x.order)).toBe('PICKED_UP_BY_RIDER')
    })
  })

  it('wrong tokens are counted and lock after five; wrong order, other vendor, other rider and customers fail', async () => {
    await isoTx(async (c) => {
      const x = await assigned(c)
      const y = await assigned(c)
      const tx = await issue(c, x.r.id, x.a.assignment_id)
      const ty = await issue(c, y.r.id, y.a.assignment_id)
      expect((await confirm(c, x.owner, x.order, ty.token)).reason).toBe('wrong_token') // token of another order
      expect(
        (
          await callFails(c, AAL2(y.owner), `select public.vendor_confirm_rider_pickup($1,$2)`, [
            x.order,
            tx.token,
          ])
        ).code,
      ).toBe(PRIV_DENIED) // another vendor's staff
      expect(
        (
          await callFails(c, AAL2(x.cust), `select public.vendor_confirm_rider_pickup($1,$2)`, [
            x.order,
            tx.token,
          ])
        ).code,
      ).toBe(PRIV_DENIED)
      expect(
        (
          await callFails(c, rider(x.r.id), `select public.vendor_confirm_rider_pickup($1,$2)`, [
            x.order,
            tx.token,
          ])
        ).code,
      ).toBe(PRIV_DENIED)
      expect(
        (
          await callFails(c, AAL1(x.owner), `select public.vendor_confirm_rider_pickup($1,$2)`, [
            x.order,
            tx.token,
          ])
        ).code,
      ).toBe(PRIV_DENIED)
      for (let i = 0; i < 4; i++)
        expect((await confirm(c, x.owner, x.order, 'AAAAAAAAAA')).reason).toBe('wrong_token')
      expect((await confirm(c, x.owner, x.order, tx.token)).reason).toBe('token_locked')
      expect(await orderStatus(c, x.order)).toBe('RIDER_ASSIGNED')
      // the rider can issue a fresh token, which resets the lock
      const t2 = await issue(c, x.r.id, x.a.assignment_id)
      expect((await confirm(c, x.owner, x.order, tx.token)).reason).toBe('wrong_token')
      expect((await confirm(c, x.owner, x.order, t2.token)).ok).toBe(true)
    })
  })

  it('expired tokens are refused; re-issuing invalidates the old one; only the assigned rider can issue', async () => {
    await isoTx(async (c) => {
      const x = await assigned(c)
      const stranger = await mkRider(c)
      expect(
        (
          await callFails(c, rider(stranger.id), `select public.rider_issue_handover_token($1)`, [
            x.a.assignment_id,
          ])
        ).code,
      ).toBe(PRIV_DENIED)
      const t1 = await issue(c, x.r.id, x.a.assignment_id)
      const t2 = await issue(c, x.r.id, x.a.assignment_id)
      expect((await confirm(c, x.owner, x.order, t1.token)).reason).toBe('wrong_token')
      await c.query(
        `update public.assignment_tokens set expires_at = now() - interval '1 minute' where assignment_id=$1 and invalidated_at is null`,
        [x.a.assignment_id],
      )
      expect((await confirm(c, x.owner, x.order, t2.token)).reason).toBe('token_expired')
      expect(await orderStatus(c, x.order)).toBe('RIDER_ASSIGNED')
    })
  })

  it('reassignment kills the old rider’s token: a new rider’s order cannot be released to with the old token', async () => {
    await isoTx(async (c) => {
      const x = await assigned(c)
      const t = await issue(c, x.r.id, x.a.assignment_id)
      await callJson(c, rider(x.r.id), `select public.rider_go_inactive() r`) // releases the not-yet-picked-up work
      expect(await orderStatus(c, x.order)).toBe('AWAITING_RIDER')
      expect((await confirm(c, x.owner, x.order, t.token)).ok).toBe(false)
      const r2 = await mkRider(c)
      const a2 = await accept(c, r2.id, x.order)
      expect((await confirm(c, x.owner, x.order, t.token)).reason).toMatch(
        /token_unavailable|wrong_token/,
      )
      const t2 = await issue(c, r2.id, a2.assignment_id)
      expect((await confirm(c, x.owner, x.order, t2.token)).ok).toBe(true)
      expect(
        (
          await c.query(
            `select assignment_no from public.delivery_assignments where order_id=$1 order by assignment_no`,
            [x.order],
          )
        ).rows.map((r) => r.assignment_no),
      ).toEqual([1, 2])
    })
  })

  it('the vendor sees pending pickups for its own shop only', async () => {
    await isoTx(async (c) => {
      const x = await assigned(c)
      const y = await assigned(c)
      const mine = (await callJson(
        c,
        AAL2(x.owner),
        `select public.vendor_pending_rider_pickups() r`,
      )) as { order_id: string }[]
      expect(mine.map((m) => m.order_id)).toEqual([x.order])
      expect(
        await callJson(c, AAL2(x.cust), `select public.vendor_pending_rider_pickups() r`),
      ).toEqual([])
      expect(y.order).not.toBe(x.order)
    })
  })
})

describe('on the road and shift end', () => {
  async function pickedUp(c: Parameters<typeof orderStatus>[0]) {
    const o = await deliveryOrder(c)
    const r = await mkRider(c)
    const a = await accept(c, r.id, o.order)
    const t = (await callJson(c, rider(r.id), `select public.rider_issue_handover_token($1) r`, [
      a.assignment_id,
    ])) as { token: string }
    await callJson(c, AAL2(o.owner), `select public.vendor_confirm_rider_pickup($1,$2) r`, [
      o.order,
      t.token,
    ])
    return { ...o, r, a }
  }

  it('start route is for the assigned rider after pickup only', async () => {
    await isoTx(async (c) => {
      const o = await deliveryOrder(c)
      const r = await mkRider(c)
      const a = await accept(c, r.id, o.order)
      expect(
        (await callFails(c, rider(r.id), `select public.rider_start_route($1)`, [a.assignment_id]))
          .message,
      ).toMatch(/invalid_transition/)
      const x = await pickedUp(c)
      const other = await mkRider(c)
      expect(
        (
          await callFails(c, rider(other.id), `select public.rider_start_route($1)`, [
            x.a.assignment_id,
          ])
        ).code,
      ).toBe(PRIV_DENIED)
      await callJson(c, rider(x.r.id), `select public.rider_start_route($1) r`, [x.a.assignment_id])
      expect(await orderStatus(c, x.order)).toBe('EN_ROUTE')
    })
  })

  it('ending a shift: nothing active ends it; not-yet-picked-up work is released; a parcel in hand REFUSES', async () => {
    await isoTx(async (c) => {
      const idle = await mkRider(c)
      expect(await callJson(c, rider(idle.id), `select public.rider_go_inactive() r`)).toEqual({
        released: 0,
      })
      expect(
        (
          await c.query(
            `select 1 from public.rider_shifts where rider_id=$1 and ended_at is null`,
            [idle.id],
          )
        ).rowCount,
      ).toBe(0)

      const x = await pickedUp(c)
      expect(
        (await callFails(c, rider(x.r.id), `select public.rider_go_inactive()`)).message,
      ).toMatch(/active_deliveries_in_progress/)
      expect(
        (
          await c.query(
            `select 1 from public.rider_shifts where rider_id=$1 and ended_at is null`,
            [x.r.id],
          )
        ).rowCount,
      ).toBe(1)
      expect(await orderStatus(c, x.order)).toBe('PICKED_UP_BY_RIDER')

      const shop = await mkShop(c)
      const a = await deliveryOrder(c, { shop })
      const b = await deliveryOrder(c, { shop })
      const r = await mkRider(c)
      await accept(c, r.id, a.order)
      await accept(c, r.id, b.order)
      expect(await callJson(c, rider(r.id), `select public.rider_go_inactive() r`)).toEqual({
        released: 2,
      })
      expect(await orderStatus(c, a.order)).toBe('AWAITING_RIDER')
      expect(await orderStatus(c, b.order)).toBe('AWAITING_RIDER')
      expect(
        (
          await c.query(
            `select 1 from public.delivery_assignments where rider_id=$1 and status <> 'released'`,
            [r.id],
          )
        ).rowCount,
      ).toBe(0)
    })
  })

  it('suspending a rider releases un-picked work and FLAGS work in progress for staff', async () => {
    await isoTx(async (c) => {
      const admin = await createUser(c, 'admin')
      await giveRole(c, admin, 'platform_admin')
      const x = await pickedUp(c)
      const shop = await mkShop(c)
      const o2 = await deliveryOrder(c, { shop })
      await accept(c, x.r.id, o2.order)
      await callJson(
        c,
        AAL2(admin),
        `select public.set_rider_status($1,'suspended','investigating a report') r`,
        [x.r.id],
      )
      expect(await orderStatus(c, o2.order)).toBe('AWAITING_RIDER')
      expect(await orderStatus(c, x.order)).toBe('PICKED_UP_BY_RIDER')
      const flags = (
        await c.query(`select reason from public.rider_issues where order_id=$1`, [x.order])
      ).rows
      expect(flags).toEqual([{ reason: 'ops_flag' }])
    })
  })
})

describe('issue reporting', () => {
  it('records the four reasons and GPS issues without changing the order, penalising anyone, or claiming arrival', async () => {
    await isoTx(async (c) => {
      const o = await deliveryOrder(c)
      const r = await mkRider(c)
      const a = await accept(c, r.id, o.order)
      for (const reason of [
        'vendor_not_ready',
        'recipient_unavailable',
        'blocked_route',
        'safety_security_restriction',
        'gps_issue',
      ]) {
        await callJson(c, rider(r.id), `select public.rider_report_issue($1,$2,'note') r`, [
          a.assignment_id,
          reason,
        ])
      }
      expect(
        (
          await callFails(c, rider(r.id), `select public.rider_report_issue($1,'ops_flag',null)`, [
            a.assignment_id,
          ])
        ).message,
      ).toMatch(/invalid_reason/)
      expect(
        (
          await callFails(c, rider(r.id), `select public.rider_report_issue($1,'arrived',null)`, [
            a.assignment_id,
          ])
        ).message,
      ).toMatch(/invalid_reason/)
      expect(
        (await c.query(`select 1 from public.rider_issues where order_id=$1`, [o.order])).rowCount,
      ).toBe(5)
      expect(await orderStatus(c, o.order)).toBe('RIDER_ASSIGNED')
      expect(
        (
          await c.query(`select arrival_detected_at from public.delivery_assignments where id=$1`, [
            a.assignment_id,
          ])
        ).rows[0].arrival_detected_at,
      ).toBeNull()
      const other = await mkRider(c)
      expect(
        (
          await callFails(
            c,
            rider(other.id),
            `select public.rider_report_issue($1,'blocked_route',null)`,
            [a.assignment_id],
          )
        ).code,
      ).toBe(PRIV_DENIED)
    })
  })

  it('only support or admins list and resolve issues', async () => {
    await isoTx(async (c) => {
      const o = await deliveryOrder(c)
      const r = await mkRider(c)
      const a = await accept(c, r.id, o.order)
      const id = await callJson(
        c,
        rider(r.id),
        `select public.rider_report_issue($1,'gps_issue',null) r`,
        [a.assignment_id],
      )
      const ops = await createUser(c, 'ops')
      await giveRole(c, ops, 'support_agent')
      for (const who of [rider(r.id), AAL2(o.cust), AAL2(o.owner), AAL1(ops), null]) {
        expect((await callFails(c, who, `select public.list_rider_issues()`)).code).toBe(
          PRIV_DENIED,
        )
      }
      const list = (await callJson(c, AAL2(ops), `select public.list_rider_issues() r`)) as {
        id: string
      }[]
      expect(list.map((i) => i.id)).toContain(id)
      expect(
        (await callFails(c, AAL2(ops), `select public.resolve_rider_issue($1,'')`, [id])).message,
      ).toMatch(/note_required/)
      await callJson(c, AAL2(ops), `select public.resolve_rider_issue($1,'called the rider') r`, [
        id,
      ])
      expect(
        (await callFails(c, AAL2(ops), `select public.resolve_rider_issue($1,'again')`, [id]))
          .message,
      ).toMatch(/issue_not_open/)
    })
  })
})

describe('no rider path completes an order, and table privacy', () => {
  it('no rider/assignment/location function can reach DELIVERED or COMPLETED, and step_order is not callable by users', async () => {
    await isoTx(async (c) => {
      const defs = await c.query(
        `select p.proname, p.prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname in ('public','app_private')
            and (p.proname like 'rider\\_%' or p.proname in ('vendor_confirm_rider_pickup','vendor_pending_rider_pickups','my_assignments',
                 'list_delivery_offers','release_assignment','ops_release_assignment','get_order_tracking','staff_get_order_tracking','set_rider_status'))`,
      )
      expect(defs.rowCount).toBeGreaterThan(10)
      for (const r of defs.rows)
        expect(r.prosrc, r.proname).not.toMatch(/'(DELIVERED|COMPLETED|AWAITING_RECIPIENT_PROOF)'/)
      const u = await createUser(c, 'u')
      const e = await as(c, AAL2(u), () =>
        failure(c, `select app_private.step_order(gen_random_uuid(),'PAID','COMPLETED',null,'x')`),
      )
      expect(e.code).toBe(PRIV_DENIED)
    })
  })

  it('a full rider journey never takes the order beyond EN_ROUTE without a geofence arrival', async () => {
    await isoTx(async (c) => {
      const o = await deliveryOrder(c)
      const r = await mkRider(c)
      const a = await accept(c, r.id, o.order)
      const t = (await callJson(c, rider(r.id), `select public.rider_issue_handover_token($1) r`, [
        a.assignment_id,
      ])) as { token: string }
      await callJson(c, AAL2(o.owner), `select public.vendor_confirm_rider_pickup($1,$2) r`, [
        o.order,
        t.token,
      ])
      await callJson(c, rider(r.id), `select public.rider_start_route($1) r`, [a.assignment_id])
      expect(await hist(c, o.order)).toEqual([
        'PENDING_PAYMENT',
        'PAID',
        'ACCEPTED',
        'PREPARING',
        'READY',
        'AWAITING_RIDER',
        'RIDER_ASSIGNED',
        'PICKED_UP_BY_RIDER',
        'EN_ROUTE',
      ])
    })
  })

  it('assignments, tokens and applications are not readable by the wrong people; tokens and locations not at all', async () => {
    await isoTx(async (c) => {
      const o = await deliveryOrder(c)
      const r = await mkRider(c)
      const other = await mkRider(c)
      const a = await accept(c, r.id, o.order)
      await callJson(c, rider(r.id), `select public.rider_issue_handover_token($1) r`, [
        a.assignment_id,
      ])
      const count = (who: Parameters<typeof as>[1], t: string) =>
        as(c, who, async () => (await c.query(`select 1 from public.${t}`)).rowCount)
      expect(await count(rider(r.id), 'delivery_assignments')).toBe(1)
      for (const who of [rider(other.id), AAL2(o.cust), AAL2(o.owner), AAL1(r.id)])
        expect(await count(who, 'delivery_assignments')).toBe(0)
      for (const t of ['assignment_tokens', 'rider_location_current', 'rider_location_history']) {
        for (const who of [rider(r.id), AAL2(o.cust), AAL2(o.owner)]) {
          expect((await as(c, who, () => failure(c, `select * from public.${t}`))).code).toBe(
            PRIV_DENIED,
          )
        }
      }
      const anon = await as(c, null, () => failure(c, `select * from public.delivery_assignments`))
      expect(anon.code).toBe(PRIV_DENIED)
      const w = await as(c, rider(r.id), () =>
        failure(c, `update public.delivery_assignments set slot = 5`),
      )
      expect(w.code).toBe(PRIV_DENIED)
      expect(
        await svc(
          c,
          async () =>
            (await c.query(`select count(*)::int n from public.assignment_tokens`)).rows[0].n,
        ),
      ).toBe(1)
    })
  })

  it('the unrelated vendor of another shop cannot see rider data of this order', async () => {
    await isoTx(async (c) => {
      const x = await deliveryOrder(c)
      const otherOwner = await createUser(c, 'otherowner')
      await mkVendor(c, { owner: otherOwner })
      const r = await mkRider(c)
      await accept(c, r.id, x.order)
      const seen = await as(
        c,
        AAL2(otherOwner),
        async () => (await c.query(`select 1 from public.delivery_assignments`)).rowCount,
      )
      expect(seen).toBe(0)
      void vendorAct
    })
  })
})
