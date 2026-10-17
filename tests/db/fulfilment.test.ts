import { afterAll, describe, expect, it } from 'vitest'
import {
  derivePickupCode,
  hashPickupCode,
} from '../../src/server/modules/orders-and-state-machine/pickup-code'
import type { PoolClient } from 'pg'
import {
  AAL1,
  AAL2,
  PNG,
  PRIV_DENIED,
  addToCart,
  as,
  createOrderAs,
  createUser,
  failure,
  fixPricing,
  mkDeliveryPoint,
  mkProduct,
  mkVendor,
  payOrder,
  pool,
  svc,
  purge,
  withTx,
} from './helpers'

afterAll(async () => {
  await pool.end()
})

type Fulfilment = 'pickup' | 'delivery'
async function paidOrder(c: PoolClient, fulfilment: Fulfilment = 'pickup') {
  await fixPricing(c, { delivery: 50000 })
  const owner = await createUser(c, 'owner')
  const cust = await createUser(c, 'cust')
  const v = await mkVendor(c, { owner })
  const p = await mkProduct(c, v.id, { price: 250000, stock: 10 })
  const point = await mkDeliveryPoint(c)
  await addToCart(c, AAL2(cust), p, 2)
  const order = await createOrderAs(
    c,
    AAL2(cust),
    fulfilment,
    fulfilment === 'delivery' ? point : null,
  )
  await payOrder(c, AAL2(cust), order)
  return { owner, cust, v, p, order, point }
}
const act = (
  c: PoolClient,
  who: ReturnType<typeof AAL2> | null,
  order: string,
  action: string,
  reason: string | null = null,
) =>
  as(
    c,
    who,
    async () =>
      (await c.query(`select public.vendor_transition_order($1,$2,$3) s`, [order, action, reason]))
        .rows[0].s as string,
  )
const actFails = (
  c: PoolClient,
  who: ReturnType<typeof AAL2> | null,
  order: string,
  action: string,
  reason: string | null = null,
) =>
  as(c, who, () =>
    failure(c, `select public.vendor_transition_order($1,$2,$3)`, [order, action, reason]),
  )
const status = async (c: PoolClient, o: string) =>
  (await c.query(`select status from public.orders where id=$1`, [o])).rows[0].status as string
const TEST_SECRET = 'test-only-pickup-secret-0123456789abcdef'
/** What the application server does: ask the DB (as the customer) for the nonce, derive the code, register the hash. */
const getCode = async (c: PoolClient, who: ReturnType<typeof AAL2>, order: string) => {
  const r = await as(
    c,
    who,
    async () =>
      (await c.query(`select public.get_pickup_code($1) r`, [order])).rows[0].r as {
        available: boolean
        nonce?: string
        registered?: boolean
      },
  )
  if (!r.available) return { available: false } as { available: boolean; code?: string }
  const code = derivePickupCode(TEST_SECRET, order, r.nonce!)
  if (!r.registered)
    await svc(c, () =>
      c.query(`select public.pickup_code_register($1, $2)`, [order, hashPickupCode(code)]),
    )
  return { available: true, code }
}
const complete = (
  c: PoolClient,
  who: ReturnType<typeof AAL2>,
  order: string,
  code: string,
  name = 'Ada Student',
  sig: Buffer = PNG(),
) =>
  as(
    c,
    who,
    async () =>
      (await c.query(`select public.complete_pickup($1,$2,$3,$4) r`, [order, code, name, sig]))
        .rows[0].r as { ok: boolean; reason?: string },
  )

async function toHandover(c: PoolClient, o: Awaited<ReturnType<typeof paidOrder>>) {
  await act(c, AAL2(o.owner), o.order, 'accept')
  await act(c, AAL2(o.owner), o.order, 'start_preparing')
  return act(c, AAL2(o.owner), o.order, 'mark_ready')
}

describe('vendor order state machine', () => {
  it('walks PAID -> ACCEPTED -> PREPARING -> PICKUP_AWAITING_HANDOVER with history for every step', async () => {
    await withTx(async (c) => {
      const o = await paidOrder(c)
      expect(await act(c, AAL2(o.owner), o.order, 'accept')).toBe('ACCEPTED')
      expect(await act(c, AAL2(o.owner), o.order, 'start_preparing')).toBe('PREPARING')
      expect(await act(c, AAL2(o.owner), o.order, 'mark_ready')).toBe('PICKUP_AWAITING_HANDOVER')
      const h = await c.query(
        `select to_status from public.order_status_history where order_id=$1 order by id`,
        [o.order],
      )
      expect(h.rows.map((r) => r.to_status)).toEqual([
        'PENDING_PAYMENT',
        'PAID',
        'ACCEPTED',
        'PREPARING',
        'READY',
        'PICKUP_AWAITING_HANDOVER',
      ])
    })
  })

  it('delivery orders go to AWAITING_RIDER and get no pickup code', async () => {
    await withTx(async (c) => {
      const o = await paidOrder(c, 'delivery')
      expect(await toHandover(c, o)).toBe('AWAITING_RIDER')
      expect(
        (await c.query(`select 1 from public.pickup_codes where order_id=$1`, [o.order])).rowCount,
      ).toBe(0)
    })
  })

  it('rejects illegal or repeated transitions and unknown actions', async () => {
    await withTx(async (c) => {
      const o = await paidOrder(c)
      for (const a of ['start_preparing', 'mark_ready'])
        expect((await actFails(c, AAL2(o.owner), o.order, a)).message).toMatch(/invalid_transition/)
      await act(c, AAL2(o.owner), o.order, 'accept')
      expect((await actFails(c, AAL2(o.owner), o.order, 'accept')).message).toMatch(
        /invalid_transition/,
      )
      expect((await actFails(c, AAL2(o.owner), o.order, 'reject', 'too late')).message).toMatch(
        /invalid_transition/,
      )
      expect((await actFails(c, AAL2(o.owner), o.order, 'teleport')).message).toMatch(
        /invalid_action/,
      )
    })
  })

  it('an unpaid order cannot be accepted', async () => {
    await withTx(async (c) => {
      await fixPricing(c)
      const owner = await createUser(c, 'owner')
      const cust = await createUser(c, 'cust')
      const v = await mkVendor(c, { owner })
      const p = await mkProduct(c, v.id, { price: 100000, stock: 5 })
      await addToCart(c, AAL2(cust), p, 1)
      const order = await createOrderAs(c, AAL2(cust), 'pickup')
      expect((await actFails(c, AAL2(owner), order, 'accept')).message).toMatch(
        /invalid_transition/,
      )
    })
  })

  it('only staff of the ordering shop, at aal2, with an active shop, may act', async () => {
    await withTx(async (c) => {
      const o = await paidOrder(c)
      const other = await createUser(c, 'otherowner')
      await mkVendor(c, { owner: other })
      for (const who of [AAL2(other), AAL2(o.cust), AAL1(o.owner), null]) {
        const e = await actFails(c, who, o.order, 'accept')
        expect(e.code).toBe(PRIV_DENIED)
      }
      await c.query(`update public.vendors set status='suspended' where id=$1`, [o.v.id])
      expect((await actFails(c, AAL2(o.owner), o.order, 'accept')).code).toBe(PRIV_DENIED)
      expect(await status(c, o.order)).toBe('PAID')
    })
  })

  it('rejecting a paid order needs a reason, releases stock and raises a refund flag', async () => {
    await withTx(async (c) => {
      const o = await paidOrder(c)
      expect((await actFails(c, AAL2(o.owner), o.order, 'reject', '')).message).toMatch(
        /reason_required/,
      )
      expect(await act(c, AAL2(o.owner), o.order, 'reject', 'Out of ingredients')).toBe('CANCELLED')
      expect(
        (await c.query(`select stock_quantity s from public.products where id=$1`, [o.p])).rows[0]
          .s,
      ).toBe(10)
      expect(
        (
          await c.query(
            `select 1 from public.reconciliation_flags where order_id=$1 and reason='vendor_rejected_paid_order'`,
            [o.order],
          )
        ).rowCount,
      ).toBe(1)
    })
  })
})

describe('pickup code and handover', () => {
  it('the code is shown only to the ordering customer, only while awaiting handover; the DB stores a hash only', async () => {
    await withTx(async (c) => {
      const o = await paidOrder(c)
      expect((await getCode(c, AAL2(o.cust), o.order)).available).toBe(false)
      await toHandover(c, o)
      const r = await getCode(c, AAL2(o.cust), o.order)
      expect(r.available).toBe(true)
      expect(r.code).toMatch(/^[0-9A-F]{8}$/)
      expect((await getCode(c, AAL2(o.cust), o.order)).code).toBe(r.code) // stable
      const stranger = await createUser(c, 'stranger')
      for (const who of [AAL2(stranger), AAL2(o.owner), AAL1(o.cust)]) {
        const e = await as(c, who, () => failure(c, `select public.get_pickup_code($1)`, [o.order]))
        expect(e.code).toBe(PRIV_DENIED)
      }
      const row = (
        await c.query(`select code_hash from public.pickup_codes where order_id=$1`, [o.order])
      ).rows[0]
      expect(row.code_hash).not.toContain(r.code!)
      // nobody can read the table directly
      for (const who of [AAL2(o.cust), AAL2(o.owner)]) {
        const e = await as(c, who, () => failure(c, `select * from public.pickup_codes`))
        expect(e.code).toBe(PRIV_DENIED)
      }
    })
  })

  it('completes with the right code, a name and a signature; evidence stored; cannot be replayed', async () => {
    await withTx(async (c) => {
      const o = await paidOrder(c)
      await toHandover(c, o)
      const { code } = await getCode(c, AAL2(o.cust), o.order)
      expect(await complete(c, AAL2(o.owner), o.order, code!.toLowerCase() + ' ')).toEqual({
        ok: true,
      })
      expect(await status(c, o.order)).toBe('COMPLETED')
      const ev = (
        await c.query(
          `select recipient_name, signature_sha256, octet_length(signature_png) n from public.handover_evidence where order_id=$1`,
          [o.order],
        )
      ).rows[0]
      expect(ev.recipient_name).toBe('Ada Student')
      expect(ev.n).toBeGreaterThan(300)
      const again = await as(c, AAL2(o.owner), () =>
        failure(c, `select public.complete_pickup($1,$2,'Ada Student',$3)`, [o.order, code, PNG()]),
      )
      expect(again.message).toMatch(/invalid_transition/)
      expect((await getCode(c, AAL2(o.cust), o.order)).available).toBe(false)
    })
  })

  it('refuses without a valid signature or recipient, and wrong codes are counted and lock after five', async () => {
    await withTx(async (c) => {
      const o = await paidOrder(c)
      await toHandover(c, o)
      const { code } = await getCode(c, AAL2(o.cust), o.order)
      const bad = (sig: Buffer | null, name = 'Ada Student') =>
        as(c, AAL2(o.owner), () =>
          failure(c, `select public.complete_pickup($1,$2,$3,$4)`, [o.order, code, name, sig]),
        )
      expect((await bad(null)).message).toMatch(/signature_required/)
      expect((await bad(Buffer.alloc(600, 1))).message).toMatch(/signature_required/) // not a PNG
      expect((await bad(PNG(50))).message).toMatch(/signature_required/) // blank / too small
      expect((await bad(PNG(), ' ')).message).toMatch(/recipient_required/)
      expect(await status(c, o.order)).toBe('PICKUP_AWAITING_HANDOVER')
      for (let i = 0; i < 5; i++)
        expect((await complete(c, AAL2(o.owner), o.order, 'WRONG123')).reason).toBe('wrong_code')
      expect((await complete(c, AAL2(o.owner), o.order, code!)).reason).toBe('code_locked')
      expect(await status(c, o.order)).toBe('PICKUP_AWAITING_HANDOVER')
    })
  })

  it('a code from another order never works; strangers and customers cannot complete a pickup', async () => {
    await withTx(async (c) => {
      const a = await paidOrder(c)
      const b = await paidOrder(c)
      await toHandover(c, a)
      await toHandover(c, b)
      const codeA = (await getCode(c, AAL2(a.cust), a.order)).code!
      await getCode(c, AAL2(b.cust), b.order) // registers b's own hash
      expect((await complete(c, AAL2(b.owner), b.order, codeA)).reason).toBe('wrong_code')
      expect(await status(c, b.order)).toBe('PICKUP_AWAITING_HANDOVER')
      for (const who of [AAL2(b.owner), AAL2(a.cust), AAL1(a.owner)]) {
        const e = await as(c, who, () =>
          failure(c, `select public.complete_pickup($1,$2,'Ada Student',$3)`, [
            a.order,
            codeA,
            PNG(),
          ]),
        )
        expect(e.code).toBe(PRIV_DENIED)
      }
    })
  })

  it('handover evidence is visible to the customer and shop, not to strangers, and cannot change', async () => {
    await withTx(async (c) => {
      const o = await paidOrder(c)
      await toHandover(c, o)
      const { code } = await getCode(c, AAL2(o.cust), o.order)
      await complete(c, AAL2(o.owner), o.order, code!)
      const seen = (who: ReturnType<typeof AAL2>) =>
        as(c, who, async () => (await c.query(`select 1 from public.handover_evidence`)).rowCount)
      expect(await seen(AAL2(o.cust))).toBe(1)
      expect(await seen(AAL2(o.owner))).toBe(1)
      expect(await seen(AAL2(await createUser(c, 'stranger')))).toBe(0)
      expect(
        (await failure(c, `update public.handover_evidence set recipient_name='x'`)).message,
      ).toMatch(/append-only|immutable|not allowed|denied/i)
    })
  })
})

describe('pickup-code secret handling (Batch 4 correction)', () => {
  it('the database holds no pepper: no secrets table, no code-derivation function', async () => {
    await withTx(async (c) => {
      expect((await c.query(`select to_regclass('app_private.secrets') r`)).rows[0].r).toBeNull()
      const f = await c.query(
        `select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname='pickup_code_for'`,
      )
      expect(f.rowCount).toBe(0)
    })
  })

  it('until the server registers a hash, no code can complete a pickup; registration happens once and is service-only', async () => {
    await withTx(async (c) => {
      const o = await paidOrder(c)
      await toHandover(c, o)
      const nonce = (
        await c.query(`select nonce, code_hash from public.pickup_codes where order_id=$1`, [
          o.order,
        ])
      ).rows[0]
      expect(nonce.code_hash).toBeNull()
      expect((await complete(c, AAL2(o.owner), o.order, 'ABCDEF12')).reason).toBe(
        'code_unavailable',
      )
      for (const who of [AAL2(o.cust), AAL2(o.owner), null]) {
        const e = await as(c, who, () =>
          failure(c, `select public.pickup_code_register($1, $2)`, [o.order, 'a'.repeat(64)]),
        )
        expect(e.code).toBe(PRIV_DENIED)
      }
      const h1 = hashPickupCode('AAAAAAAA')
      const first = await svc(
        c,
        async () =>
          (await c.query(`select public.pickup_code_register($1,$2) r`, [o.order, h1])).rows[0].r,
      )
      const second = await svc(
        c,
        async () =>
          (
            await c.query(`select public.pickup_code_register($1,$2) r`, [
              o.order,
              hashPickupCode('BBBBBBBB'),
            ])
          ).rows[0].r,
      )
      expect([first, second]).toEqual([true, false])
      const bad = await svc(
        c,
        async () =>
          (await c.query(`select public.pickup_code_register($1,'nothex') r`, [o.order])).rows[0].r,
      )
      expect(bad).toBe(false)
      // the customer-facing function never returns the code itself
      const r = await as(
        c,
        AAL2(o.cust),
        async () => (await c.query(`select public.get_pickup_code($1) r`, [o.order])).rows[0].r,
      )
      expect(Object.keys(r).sort()).toEqual(['available', 'expires_at', 'nonce', 'registered'])
    })
  })

  it('a code derived with a different secret is refused', async () => {
    await withTx(async (c) => {
      const o = await paidOrder(c)
      await toHandover(c, o)
      const good = await getCode(c, AAL2(o.cust), o.order)
      const nonce = (
        await c.query(`select nonce from public.pickup_codes where order_id=$1`, [o.order])
      ).rows[0].nonce
      const forged = derivePickupCode('another-secret-0123456789abcdefghij', o.order, nonce)
      expect(forged).not.toBe(good.code)
      expect((await complete(c, AAL2(o.owner), o.order, forged)).reason).toBe('wrong_code')
    })
  })
})

describe('signature capture method (Batch 4 correction)', () => {
  const typed = (
    c: PoolClient,
    who: ReturnType<typeof AAL2>,
    order: string,
    code: string,
    text: string | null,
    sig: Buffer | null = null,
  ) =>
    as(c, who, () =>
      failure(
        c,
        `select public.complete_pickup($1,$2,'Ada Student',$3,'typed_acknowledgement',$4)`,
        [order, code, sig, text],
      ),
    )

  it('a typed acknowledgement is refused unless the owner has enabled it (default off)', async () => {
    await withTx(async (c) => {
      const o = await paidOrder(c)
      await toHandover(c, o)
      const { code } = await getCode(c, AAL2(o.cust), o.order)
      expect((await typed(c, AAL2(o.owner), o.order, code!, 'Ada Student')).message).toMatch(
        /typed_signature_disabled/,
      )
      expect(await status(c, o.order)).toBe('PICKUP_AWAITING_HANDOVER')
    })
  })

  it('when enabled it is recorded as typed (never as a drawn signature) and still needs the code', async () => {
    await withTx(async (c) => {
      const o = await paidOrder(c)
      await toHandover(c, o)
      await c.query(
        `update public.platform_settings set value='true'::jsonb where key='typed_signature_enabled'`,
      )
      const { code } = await getCode(c, AAL2(o.cust), o.order)
      expect((await typed(c, AAL2(o.owner), o.order, code!, null)).message).toMatch(
        /signature_required/,
      )
      expect((await typed(c, AAL2(o.owner), o.order, code!, 'Ada Student', PNG())).message).toMatch(
        /signature_required/,
      )
      const wrong = await as(
        c,
        AAL2(o.owner),
        async () =>
          (
            await c.query(
              `select public.complete_pickup($1,'WRONG123','Ada',null,'typed_acknowledgement','Ada Student') r`,
              [o.order],
            )
          ).rows[0].r,
      )
      expect(wrong.reason).toBe('wrong_code')
      const ok = await as(
        c,
        AAL2(o.owner),
        async () =>
          (
            await c.query(
              `select public.complete_pickup($1,$2,'Ada',null,'typed_acknowledgement','Ada Student') r`,
              [o.order, code],
            )
          ).rows[0].r,
      )
      expect(ok.ok).toBe(true)
      const ev = (
        await c.query(
          `select capture_method, typed_text, signature_png from public.handover_evidence where order_id=$1`,
          [o.order],
        )
      ).rows[0]
      expect(ev).toEqual({
        capture_method: 'typed_acknowledgement',
        typed_text: 'Ada Student',
        signature_png: null,
      })
    })
  })

  it('the evidence shape constraint stops a typed record carrying an image or a drawn record lacking one', async () => {
    await withTx(async (c) => {
      const o = await paidOrder(c)
      const bad1 = await failure(
        c,
        `insert into public.handover_evidence (order_id, recipient_name, signature_png, signature_sha256, completed_by, capture_method, typed_text) values ($1,'Ada',$2,'x',$3,'typed_acknowledgement','Ada')`,
        [o.order, PNG(), o.owner],
      )
      expect(bad1.message).toMatch(/handover_evidence_method_shape/)
      const bad2 = await failure(
        c,
        `insert into public.handover_evidence (order_id, recipient_name, signature_png, signature_sha256, completed_by, capture_method) values ($1,'Ada',null,'x',$2,'drawn')`,
        [o.order, o.owner],
      )
      expect(bad2.message).toMatch(/handover_evidence_method_shape|null value/)
    })
  })
})

describe('concurrency', () => {
  it('two simultaneous correct completions: exactly one succeeds; two simultaneous accepts: exactly one', async () => {
    const setup = await pool.connect()
    let ids: { users: string[]; vendors: string[]; points: string[] } = {
      users: [],
      vendors: [],
      points: [],
    }
    try {
      await setup.query('begin')
      const o = await paidOrder(setup)
      await setup.query('commit')
      ids = { users: [o.owner, o.cust], vendors: [o.v.id], points: [o.point] }
      const run = async (fn: (c: PoolClient) => Promise<unknown>) => {
        const c = await pool.connect()
        try {
          await c.query('begin')
          const r = await fn(c)
          await c.query('commit')
          return r
        } catch (e) {
          await c.query('rollback').catch(() => undefined)
          return e instanceof Error ? e.message : 'error'
        } finally {
          c.release()
        }
      }
      const accepts = await Promise.all(
        [1, 2, 3].map(() => run((c) => act(c, AAL2(o.owner), o.order, 'accept'))),
      )
      expect(accepts.filter((r) => r === 'ACCEPTED')).toHaveLength(1)
      await run((c) => act(c, AAL2(o.owner), o.order, 'start_preparing'))
      await run((c) => act(c, AAL2(o.owner), o.order, 'mark_ready'))
      const code = (await run((c) => getCode(c, AAL2(o.cust), o.order))) as { code: string }
      const done = (await Promise.all(
        [1, 2, 3].map(() => run((c) => complete(c, AAL2(o.owner), o.order, code.code))),
      )) as Array<{ ok?: boolean } | string>
      expect(done.filter((r) => typeof r === 'object' && r.ok)).toHaveLength(1)
      const n = await pool.query(
        `select count(*)::int n from public.handover_evidence where order_id=$1`,
        [o.order],
      )
      expect(n.rows[0].n).toBe(1)
    } finally {
      setup.release()
      const c = await pool.connect()
      try {
        await purge(c, ids)
      } finally {
        c.release()
      }
    }
  })
})
