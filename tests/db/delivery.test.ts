import { afterAll, describe, expect, it } from 'vitest'
import type { PoolClient } from 'pg'
import {
  AAL1,
  AAL2,
  PNG,
  PRIV_DENIED,
  as,
  createUser,
  failure,
  giveRole,
  mkVendor,
  pool,
} from './helpers'
import {
  accept,
  callFails,
  callJson,
  completeDelivery,
  deliveryOrder,
  isoTx,
  journeyToArrival,
  mkRider,
  mkShop,
  orderStatus,
  pickupAtHandover,
  postFix,
  proofBegin,
  rider,
} from './rider-helpers'

afterAll(async () => {
  await pool.end()
})

const hist = async (c: PoolClient, order: string) =>
  (
    await c.query(
      `select to_status from public.order_status_history where order_id=$1 order by id`,
      [order],
    )
  ).rows.map((r) => r.to_status as string)
const evidenceCount = async (c: PoolClient, order: string) =>
  Number(
    (
      await c.query(`select count(*)::int n from public.handover_evidence where order_id=$1`, [
        order,
      ])
    ).rows[0].n,
  )
const audit = async (c: PoolClient, action: string, order: string) =>
  Number(
    (
      await c.query(
        `select count(*)::int n from public.audit_events where action=$1 and entity_id=$2`,
        [action, order],
      )
    ).rows[0].n,
  )

/** Arrival detected, recipient has started confirmation: returns the token. */
async function awaitingProof(c: PoolClient) {
  const x = await journeyToArrival(c)
  const { token } = await proofBegin(c, AAL2(x.cust), x.order)
  return { ...x, token }
}

describe('Phase 9: delivery completion is server-authoritative', () => {
  it('arrival alone never completes: it waits for the recipient, who starts, signs and completes in one transaction', async () => {
    await isoTx(async (c) => {
      const x = await journeyToArrival(c)
      expect(await orderStatus(c, x.order)).toBe('ARRIVAL_DETECTED')
      expect(await evidenceCount(c, x.order)).toBe(0)

      const { token } = await proofBegin(c, AAL2(x.cust), x.order)
      expect(token).toMatch(/^[0-9A-F]{12}$/)
      expect(await orderStatus(c, x.order)).toBe('AWAITING_RECIPIENT_PROOF')
      // only a hash of the token is stored
      const s = (
        await c.query(`select token_hash from public.delivery_proof_sessions where order_id=$1`, [
          x.order,
        ])
      ).rows
      expect(s).toHaveLength(1)
      expect(s[0].token_hash).not.toContain(token)
      expect(s[0].token_hash).toMatch(/^[0-9a-f]{64}$/)

      const r = await completeDelivery(c, AAL2(x.cust), x.order, token)
      expect(r).toEqual({ ok: true })
      expect(await orderStatus(c, x.order)).toBe('COMPLETED')
      expect((await hist(c, x.order)).slice(-5)).toEqual([
        'EN_ROUTE',
        'ARRIVAL_DETECTED',
        'AWAITING_RECIPIENT_PROOF',
        'DELIVERED',
        'COMPLETED',
      ])

      const ev = (
        await c.query(
          `select evidence_kind, capture_method, assignment_id, proof_session_id, arrival_detected_at, completed_by,
                  octet_length(signature_png) n from public.handover_evidence where order_id=$1`,
          [x.order],
        )
      ).rows[0]
      expect(ev.evidence_kind).toBe('delivery')
      expect(ev.capture_method).toBe('drawn')
      expect(ev.assignment_id).toBe(x.a.assignment_id)
      expect(ev.completed_by).toBe(x.cust)
      expect(ev.arrival_detected_at).not.toBeNull()
      expect(ev.n).toBeGreaterThan(300)

      const a = (
        await c.query(`select status, completed_at from public.delivery_assignments where id=$1`, [
          x.a.assignment_id,
        ])
      ).rows[0]
      expect(a.status).toBe('completed')
      expect(a.completed_at).not.toBeNull()
      expect(await audit(c, 'delivery.completed', x.order)).toBe(1)
      expect(await audit(c, 'delivery_proof.started', x.order)).toBe(1)
      // the token is consumed
      const used = (
        await c.query(`select used_at from public.delivery_proof_sessions where order_id=$1`, [
          x.order,
        ])
      ).rows[0]
      expect(used.used_at).not.toBeNull()
    })
  })

  it('completion frees the rider slot, stops location storage, and the rider can take new work', async () => {
    await isoTx(async (c) => {
      const x = await journeyToArrival(c)
      const loc = async () =>
        Number(
          (
            await c.query(
              `select count(*)::int n from public.rider_location_current where rider_id=$1`,
              [x.r.id],
            )
          ).rows[0].n,
        )
      expect(await loc()).toBe(1)
      const { token } = await proofBegin(c, AAL2(x.cust), x.order)
      await completeDelivery(c, AAL2(x.cust), x.order, token)
      expect(await loc()).toBe(0) // no work left -> no stored position
      // posting is refused now: there is no active work
      expect(
        (await callFails(c, rider(x.r.id), `select public.rider_post_location(0.01,0.01,10,now())`))
          .message,
      ).toMatch(/tracking_not_active/)
      // the slot is free: five more deliveries fit, the sixth does not
      const shop = await mkShop(c)
      const orders: string[] = []
      for (let i = 0; i < 6; i++) orders.push((await deliveryOrder(c, { shop })).order)
      for (let i = 0; i < 5; i++) await accept(c, x.r.id, orders[i]!)
      expect(
        (await callFails(c, rider(x.r.id), `select public.rider_accept_order($1)`, [orders[5]]))
          .message,
      ).toMatch(/capacity_reached/)
      // tracking for the finished order is closed
      const tr = await callJson(c, AAL2(x.cust), `select public.get_order_tracking($1) r`, [
        x.order,
      ])
      expect(tr.tracking).toBe(false)
      expect(tr.reason).toBe('not_in_transit')
    })
  })

  it('the proof screen can be reopened: a new session replaces the old one, and the old token stops working', async () => {
    await isoTx(async (c) => {
      const x = await journeyToArrival(c)
      const first = await proofBegin(c, AAL2(x.cust), x.order)
      const second = await proofBegin(c, AAL2(x.cust), x.order)
      expect(second.token).not.toBe(first.token)
      const live = (
        await c.query(
          `select count(*)::int n from public.delivery_proof_sessions where order_id=$1 and used_at is null and invalidated_at is null`,
          [x.order],
        )
      ).rows[0].n
      expect(live).toBe(1)
      const bad = await completeDelivery(c, AAL2(x.cust), x.order, first.token)
      expect(bad).toMatchObject({ ok: false, reason: 'wrong_proof' })
      expect(await orderStatus(c, x.order)).toBe('AWAITING_RECIPIENT_PROOF')
      expect(await completeDelivery(c, AAL2(x.cust), x.order, second.token)).toEqual({ ok: true })
    })
  })

  it('a repeated completion is idempotent: it reports already_completed and writes nothing more', async () => {
    await isoTx(async (c) => {
      const x = await awaitingProof(c)
      await completeDelivery(c, AAL2(x.cust), x.order, x.token)
      const again = await completeDelivery(c, AAL2(x.cust), x.order, x.token)
      expect(again).toEqual({ ok: false, reason: 'already_completed' })
      expect(await evidenceCount(c, x.order)).toBe(1)
      expect(await audit(c, 'delivery.completed', x.order)).toBe(1)
      expect((await hist(c, x.order)).filter((s) => s === 'COMPLETED')).toHaveLength(1)
    })
  })
})

describe('Phase 9: what is refused (and the order stays put)', () => {
  const expectUnchanged = async (c: PoolClient, order: string) => {
    expect(await orderStatus(c, order)).toBe('AWAITING_RECIPIENT_PROOF')
    expect(await evidenceCount(c, order)).toBe(0)
  }

  it('missing, tiny and non-PNG signatures are refused', async () => {
    await isoTx(async (c) => {
      const x = await awaitingProof(c)
      const cust = AAL2(x.cust)
      for (const sig of [
        null,
        Buffer.alloc(10, 1),
        Buffer.alloc(600, 1),
        Buffer.alloc(401_000, 1),
      ]) {
        const e = await callFails(
          c,
          cust,
          `select public.complete_delivery($1,$2,'Ada Student',$3)`,
          [x.order, x.token, sig],
        )
        expect(e.message).toMatch(/signature_required/)
      }
      await expectUnchanged(c, x.order)
      // the token was not burned by the bad payloads
      expect(await completeDelivery(c, cust, x.order, x.token)).toEqual({ ok: true })
    })
  })

  it('a typed acknowledgement is refused for deliveries even if the owner flag is switched on; unknown methods too', async () => {
    await isoTx(async (c) => {
      const x = await awaitingProof(c)
      const cust = AAL2(x.cust)
      const typed = () =>
        callFails(
          c,
          cust,
          `select public.complete_delivery($1,$2,'Ada Student',null,'typed_acknowledgement')`,
          [x.order, x.token],
        )
      expect((await typed()).message).toMatch(/typed_signature_disabled/)
      await c.query(
        `insert into public.platform_settings (key,value) values ('typed_signature_enabled','true'::jsonb)
         on conflict (key) do update set value='true'::jsonb`,
      )
      expect((await typed()).message).toMatch(/typed_signature_disabled/)
      const e = await callFails(
        c,
        cust,
        `select public.complete_delivery($1,$2,'Ada Student',$3,'scribble')`,
        [x.order, x.token, PNG()],
      )
      expect(e.message).toMatch(/signature_required/)
      await expectUnchanged(c, x.order)
    })
  })

  it('invalid recipient names are refused', async () => {
    await isoTx(async (c) => {
      const x = await awaitingProof(c)
      for (const name of ['', 'A', ' '.repeat(5), 'x'.repeat(81)]) {
        const e = await callFails(c, AAL2(x.cust), `select public.complete_delivery($1,$2,$3,$4)`, [
          x.order,
          x.token,
          name,
          PNG(),
        ])
        expect(e.message).toMatch(/recipient_required/)
      }
      await expectUnchanged(c, x.order)
    })
  })

  it('wrong tokens are counted, five lock the session (even for the right token), nothing completes', async () => {
    await isoTx(async (c) => {
      const x = await awaitingProof(c)
      const cust = AAL2(x.cust)
      let left = -1
      for (let i = 0; i < 5; i++) {
        const r = await completeDelivery(c, cust, x.order, 'WRONG0000000')
        expect(r.reason).toBe('wrong_proof')
        left = r.attempts_left ?? -1
      }
      expect(left).toBe(0)
      expect(await completeDelivery(c, cust, x.order, x.token)).toMatchObject({
        ok: false,
        reason: 'proof_locked',
      })
      await expectUnchanged(c, x.order)
      expect(await audit(c, 'delivery_proof.wrong_token', x.order)).toBe(5)
    })
  })

  it('an expired session is refused, and its token never works again', async () => {
    await isoTx(async (c) => {
      const x = await awaitingProof(c)
      await c.query(
        `update public.delivery_proof_sessions set expires_at = now() - interval '1 second' where order_id=$1`,
        [x.order],
      )
      expect(await completeDelivery(c, AAL2(x.cust), x.order, x.token)).toMatchObject({
        ok: false,
        reason: 'proof_expired',
      })
      await expectUnchanged(c, x.order)
      // a fresh session is the only way forward
      const fresh = await proofBegin(c, AAL2(x.cust), x.order)
      expect(await completeDelivery(c, AAL2(x.cust), x.order, x.token)).toMatchObject({
        reason: 'wrong_proof',
      })
      expect(await completeDelivery(c, AAL2(x.cust), x.order, fresh.token)).toEqual({ ok: true })
    })
  })

  it('a token for another order, a pickup code and a rider handover token cannot be substituted', async () => {
    await isoTx(async (c) => {
      const shop = await mkShop(c)
      const a = await (async () => {
        const x = await journeyToArrival(c, { shop })
        return { ...x, ...(await proofBegin(c, AAL2(x.cust), x.order)) }
      })()
      const b = await (async () => {
        const x = await journeyToArrival(c, { shop })
        return { ...x, ...(await proofBegin(c, AAL2(x.cust), x.order)) }
      })()
      expect(await completeDelivery(c, AAL2(b.cust), b.order, a.token)).toMatchObject({
        reason: 'wrong_proof',
      })
      // a rider handover token (a different secret for a different purpose) does not work as proof either
      const t = (
        await c.query(`select token_hash from public.assignment_tokens where assignment_id=$1`, [
          b.a.assignment_id,
        ])
      ).rows[0].token_hash
      expect(t).not.toBeNull()
      expect(await completeDelivery(c, AAL2(b.cust), b.order, 'PICKUPCODE00')).toMatchObject({
        reason: 'wrong_proof',
      })
      expect(await orderStatus(c, b.order)).toBe('AWAITING_RECIPIENT_PROOF')
      expect(await completeDelivery(c, AAL2(b.cust), b.order, b.token)).toEqual({ ok: true })
      expect(await orderStatus(c, a.order)).toBe('AWAITING_RECIPIENT_PROOF')
    })
  })

  it('a token from an earlier assignment cannot complete after reassignment', async () => {
    await isoTx(async (c) => {
      const x = await awaitingProof(c)
      // simulate a reassignment: the first assignment ends and a second rider is en route with an arrival
      await c.query(
        `update public.delivery_assignments set status='released', released_at=now(), release_reason='test' where id=$1`,
        [x.a.assignment_id],
      )
      const r2 = await mkRider(c)
      await c.query(
        `insert into public.delivery_assignments (order_id, rider_id, shift_id, slot, assignment_no, status, arrival_detected_at)
         values ($1,$2,$3,1,2,'en_route',now())`,
        [x.order, r2.id, r2.shift],
      )
      expect(await completeDelivery(c, AAL2(x.cust), x.order, x.token)).toMatchObject({
        ok: false,
        reason: 'proof_unavailable',
      })
      expect(await evidenceCount(c, x.order)).toBe(0)
      // and a brand new session for the NEW assignment is what is needed
      const fresh = await proofBegin(c, AAL2(x.cust), x.order)
      expect(await completeDelivery(c, AAL2(x.cust), x.order, fresh.token)).toEqual({ ok: true })
      const ev = (
        await c.query(`select assignment_id from public.handover_evidence where order_id=$1`, [
          x.order,
        ])
      ).rows[0]
      expect(ev.assignment_id).not.toBe(x.a.assignment_id)
    })
  })

  it('completion before the recipient starts, or while the parcel is still travelling, is refused', async () => {
    await isoTx(async (c) => {
      const x = await journeyToArrival(c)
      const cust = AAL2(x.cust)
      // arrival detected but confirmation not started
      expect(
        (
          await callFails(
            c,
            cust,
            `select public.complete_delivery($1,'ABCDEF123456','Ada Student',$2)`,
            [x.order, PNG()],
          )
        ).message,
      ).toMatch(/invalid_transition/)
      // a parcel that is merely EN_ROUTE (arrival never detected)
      const y = await deliveryOrder(c)
      const r = await mkRider(c)
      const a = await accept(c, r.id, y.order)
      const t = (await callJson(c, rider(r.id), `select public.rider_issue_handover_token($1) r`, [
        a.assignment_id,
      ])) as {
        token: string
      }
      await callJson(c, AAL2(y.owner), `select public.vendor_confirm_rider_pickup($1,$2) r`, [
        y.order,
        t.token,
      ])
      await callJson(c, rider(r.id), `select public.rider_start_route($1) r`, [a.assignment_id])
      expect(
        (await callFails(c, AAL2(y.cust), `select public.delivery_proof_begin($1)`, [y.order]))
          .message,
      ).toMatch(/invalid_transition/)
      // far-away fixes never detect arrival, so the recipient still cannot start
      await postFix(c, r.id, { lat: 0, lng: 0 })
      expect(
        (await callFails(c, AAL2(y.cust), `select public.delivery_proof_begin($1)`, [y.order]))
          .message,
      ).toMatch(/invalid_transition/)
    })
  })

  it('a failure part-way leaves no partial state (evidence, states, assignment, token all roll back)', async () => {
    await isoTx(async (c) => {
      const x = await awaitingProof(c)
      await c.query(
        `create function pg_temp.boom() returns trigger language plpgsql as $$ begin raise exception 'boom'; end $$`,
      )
      await c.query(
        `create trigger boom before update on public.delivery_assignments for each row
           when (new.status = 'completed') execute function pg_temp.boom()`,
      )
      const e = await callFails(
        c,
        AAL2(x.cust),
        `select public.complete_delivery($1,$2,'Ada Student',$3)`,
        [x.order, x.token, PNG()],
      )
      expect(e.message).toMatch(/boom/)
      await c.query(`drop trigger boom on public.delivery_assignments`)
      await expectUnchanged(c, x.order)
      const s = (
        await c.query(
          `select used_at, failed_attempts from public.delivery_proof_sessions where order_id=$1`,
          [x.order],
        )
      ).rows[0]
      expect(s.used_at).toBeNull()
      expect(s.failed_attempts).toBe(0)
      expect(
        (
          await c.query(`select status from public.delivery_assignments where id=$1`, [
            x.a.assignment_id,
          ])
        ).rows[0].status,
      ).toBe('en_route')
      // after the fault is gone the same request succeeds
      expect(await completeDelivery(c, AAL2(x.cust), x.order, x.token)).toEqual({ ok: true })
    })
  })
})

describe('Phase 9: who may and may not complete a delivery', () => {
  it('the rider, the shop, another customer, support, admin, aal1 and anonymous callers cannot start or complete it', async () => {
    await isoTx(async (c) => {
      const x = await awaitingProof(c)
      const stranger = await createUser(c, 'stranger')
      const staff = await createUser(c, 'staff')
      await giveRole(c, staff, 'support_agent')
      const admin = await createUser(c, 'admin')
      await giveRole(c, admin, 'platform_admin')
      const callers: [string, ReturnType<typeof AAL2> | null][] = [
        ['rider', rider(x.r.id)],
        ['shop owner', AAL2(x.owner)],
        ['stranger', AAL2(stranger)],
        ['support', AAL2(staff)],
        ['admin', AAL2(admin)],
        ['customer at aal1', AAL1(x.cust)],
        ['anonymous', null],
      ]
      for (const [label, who] of callers) {
        const e1 = await as(c, who, () =>
          failure(c, `select public.complete_delivery($1,$2,'Ada Student',$3)`, [
            x.order,
            x.token,
            PNG(),
          ]),
        )
        expect(['42501', '28000'], `complete as ${label}`).toContain(e1.code)
        const e2 = await as(c, who, () =>
          failure(c, `select public.delivery_proof_begin($1)`, [x.order]),
        )
        expect(['42501', '28000'], `begin as ${label}`).toContain(e2.code)
      }
      expect(await orderStatus(c, x.order)).toBe('AWAITING_RECIPIENT_PROOF')
      expect(await evidenceCount(c, x.order)).toBe(0)
    })
  })

  it('a rider who is also the customer of the order cannot confirm their own delivery', async () => {
    await isoTx(async (c) => {
      const r = await mkRider(c)
      const x2 = await journeyToArrival(c, { rider: r })
      // the rider is also the customer who placed this order
      await c.query(`update public.orders set customer_id=$1 where id=$2`, [r.id, x2.order])
      const e = await callFails(c, AAL2(r.id), `select public.delivery_proof_begin($1)`, [x2.order])
      expect(e.code).toBe(PRIV_DENIED)
      expect(await orderStatus(c, x2.order)).toBe('ARRIVAL_DETECTED')
    })
  })

  it('no API role can write orders, evidence, assignments or sessions directly; evidence is append-only', async () => {
    await isoTx(async (c) => {
      const x = await awaitingProof(c)
      await completeDelivery(c, AAL2(x.cust), x.order, x.token)
      for (const [label, who] of [
        ['rider', rider(x.r.id)],
        ['customer', AAL2(x.cust)],
        ['shop', AAL2(x.owner)],
      ] as const) {
        for (const sql of [
          `update public.orders set status='REFUNDED' where id='${x.order}'`,
          `update public.delivery_assignments set status='completed' where id='${x.a.assignment_id}'`,
          `delete from public.handover_evidence where order_id='${x.order}'`,
          `update public.handover_evidence set recipient_name='Eve' where order_id='${x.order}'`,
          `insert into public.handover_evidence (order_id, recipient_name, signature_png, signature_sha256, completed_by) select '${x.order}','Eve','\\x00','x','${x.cust}'`,
          `select * from public.delivery_proof_sessions`,
        ]) {
          const e = await as(c, who, () => failure(c, sql))
          expect(e.code, `${label}: ${sql}`).toBe(PRIV_DENIED)
        }
      }
      // even the owner of the database role cannot edit it (append-only trigger)
      expect(
        (await failure(c, `update public.handover_evidence set recipient_name='Eve'`)).message,
      ).toMatch(/append-only/)
      expect((await failure(c, `delete from public.handover_evidence`)).message).toMatch(
        /append-only/,
      )
    })
  })

  it('delivery evidence is visible to the customer only; the shop and the rider cannot read it; staff use the audited function', async () => {
    await isoTx(async (c) => {
      const x = await awaitingProof(c)
      await completeDelivery(c, AAL2(x.cust), x.order, x.token)
      const count = (who: ReturnType<typeof AAL2>) =>
        as(c, who, async () => (await c.query(`select 1 from public.handover_evidence`)).rowCount)
      expect(await count(AAL2(x.cust))).toBe(1)
      expect(await count(AAL2(x.owner))).toBe(0)
      expect(await count(rider(x.r.id))).toBe(0)
      const staff = await createUser(c, 'staff')
      await giveRole(c, staff, 'support_agent')
      const fin = await createUser(c, 'fin')
      await giveRole(c, fin, 'finance_admin')
      expect(await count(AAL2(staff))).toBe(0) // no broad table read for staff either
      // audited access
      expect(
        (
          await callFails(c, AAL2(staff), `select public.staff_get_delivery_proof($1,'short')`, [
            x.order,
          ])
        ).message,
      ).toMatch(/purpose_required/)
      const meta = await callJson(
        c,
        AAL2(staff),
        `select public.staff_get_delivery_proof($1,'dispute DS-1 review of delivery') r`,
        [x.order],
      )
      expect(meta).toMatchObject({ found: true, kind: 'delivery', method: 'drawn' })
      expect(meta.signature_png_base64).toBeNull()
      const full = await callJson(
        c,
        AAL2(staff),
        `select public.staff_get_delivery_proof($1,'dispute DS-1 review of delivery',true) r`,
        [x.order],
      )
      expect(typeof full.signature_png_base64).toBe('string')
      expect(await audit(c, 'delivery_proof.viewed_by_staff', x.order)).toBe(2)
      // finance, the rider and the shop have no such function
      for (const who of [AAL2(fin), rider(x.r.id), AAL2(x.owner), AAL1(staff)]) {
        const e = await callFails(
          c,
          who,
          `select public.staff_get_delivery_proof($1,'a long enough purpose')`,
          [x.order],
        )
        expect(e.code).toBe(PRIV_DENIED)
      }
    })
  })

  it('only the reviewed functions can reach the proof or completed states, and none is rider-named', async () => {
    const defs = await pool.query(
      `select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname = 'public' and p.prosrc ~ '''(DELIVERED|COMPLETED|AWAITING_RECIPIENT_PROOF)'''
        order by 1`,
    )
    // any new function reaching these states must be added here deliberately, after review
    expect(defs.rows.map((r) => r.proname as string)).toEqual([
      'complete_delivery',
      'complete_pickup',
      'delivery_proof_begin',
    ])
  })
})

describe('Phase 9: vendor counter handover by code', () => {
  it('a shop member resolves exactly one pending pickup from its code; strangers, customers and other shops cannot; nothing is completed', async () => {
    await isoTx(async (c) => {
      const o = await pickupAtHandover(c)
      const code = o.code
      const find = (who: ReturnType<typeof AAL2>, v: string) =>
        callJson(c, who, `select public.vendor_find_pickup_by_code($1) r`, [v])
      const ok = await find(AAL2(o.owner), code.toLowerCase())
      expect(ok).toMatchObject({ found: true, order_id: o.order })
      expect(ok.items.length).toBeGreaterThan(0)
      expect(await orderStatus(c, o.order)).toBe('PICKUP_AWAITING_HANDOVER') // looking up never completes
      // another shop sees nothing, and a customer who is not shop staff cannot call it
      const other = await createUser(c, 'other')
      await mkVendor(c, { owner: other })
      expect(await find(AAL2(other), code)).toMatchObject({ found: false })
      expect(
        (await callFails(c, AAL2(o.cust), `select public.vendor_find_pickup_by_code($1)`, [code]))
          .code,
      ).toBe(PRIV_DENIED)
      expect(
        (await callFails(c, AAL1(o.owner), `select public.vendor_find_pickup_by_code($1)`, [code]))
          .code,
      ).toBe(PRIV_DENIED)
      // failed look-ups are rate limited per shop member (the order's own failure counter is untouched)
      for (let i = 0; i < 10; i++)
        expect(await find(AAL2(o.owner), `BAD${i}`.padEnd(8, '0'))).toMatchObject({ found: false })
      expect(await find(AAL2(o.owner), code)).toMatchObject({
        found: false,
        reason: 'too_many_attempts',
      })
      const left = (
        await c.query(`select failed_attempts from public.pickup_codes where order_id=$1`, [
          o.order,
        ])
      ).rows[0].failed_attempts
      expect(left).toBe(0)
    })
  })
})
