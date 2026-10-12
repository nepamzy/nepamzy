import { afterAll, describe, expect, it } from 'vitest'
import {
  AAL1,
  AAL2,
  PNG,
  PRIV_DENIED,
  as,
  createUser,
  failure,
  giveRole,
  pool,
  svc,
  withTx,
} from './helpers'
import { approve, requestRefund, staff, startFake } from './refund-helpers'
import { completeDelivery, isoTx, journeyToArrival, proofBegin, rider } from './rider-helpers'
import {
  FORBIDDEN_IN_NOTIFICATION,
  act,
  asService,
  callJson,
  countRows,
  notesOf,
  paidPickup,
  titlesOf,
} from './notif-helpers'

afterAll(async () => {
  await pool.end()
})

describe('notifications are written with the event, once, and say very little', () => {
  it('a pickup order produces one short notice per step for the customer (and the shop is told about new orders)', async () => {
    await withTx(async (c) => {
      const o = await paidPickup(c)
      expect(await titlesOf(c, o.cust)).toEqual(['Order received'])
      expect(await titlesOf(c, o.owner)).toEqual(['New order'])
      await act(c, o.owner, o.order, 'accept')
      await act(c, o.owner, o.order, 'start_preparing')
      await act(c, o.owner, o.order, 'mark_ready')
      expect(await titlesOf(c, o.cust)).toEqual([
        'Order received',
        'Order accepted',
        'Ready for pickup',
      ])
      for (const n of await notesOf(c, o.cust)) {
        expect(n.link).toBe(`/orders/${o.order}`)
        expect(`${n.title} ${n.body}`).not.toMatch(FORBIDDEN_IN_NOTIFICATION)
        expect(n.kind).toBe('order')
      }
      // the pickup code is shown only on the order page, never in a notification
      expect((await notesOf(c, o.cust)).some((n) => /[0-9A-F]{8}/.test(n.body + n.title))).toBe(
        false,
      )
    })
  })

  it('a delivery tells the customer when the rider arrives and when it is complete, without names or places', async () => {
    await isoTx(async (c) => {
      const x = await journeyToArrival(c)
      const { token } = await proofBegin(c, AAL2(x.cust), x.order)
      await completeDelivery(c, AAL2(x.cust), x.order, token, PNG())
      const titles = await titlesOf(c, x.cust)
      expect(titles).toEqual(
        expect.arrayContaining([
          'Order received',
          'Order accepted',
          'Rider assigned',
          'On its way',
          'Your rider has arrived',
          'Order complete',
        ]),
      )
      for (const n of await notesOf(c, x.cust))
        expect(`${n.title} ${n.body}`).not.toMatch(FORBIDDEN_IN_NOTIFICATION)
      // the rider has no notifications about the customer's order, and nothing was sent about the proof token
      expect(await titlesOf(c, x.r.id)).toEqual([])
      expect(
        await countRows(
          c,
          `select count(*)::int n from public.notifications where body ilike '%token%' or title ilike '%token%'`,
        ),
      ).toBe(0)
    })
  })

  it('the same event key never creates a second notification or a second outbox row', async () => {
    await withTx(async (c) => {
      const u = await createUser(c, 'u')
      const send = () =>
        c.query(
          `select app_private.notify($1,'order','Order received','Open your order.','/orders/x1','dup-key-1')`,
          [u],
        )
      await send()
      await send()
      expect(
        await countRows(c, `select count(*)::int n from public.notifications where user_id=$1`, [
          u,
        ]),
      ).toBe(1)
      expect(
        await countRows(
          c,
          `select count(*)::int n from public.notification_outbox o join public.notifications n on n.id=o.notification_id where n.user_id=$1`,
          [u],
        ),
      ).toBe(1)
    })
  })

  it('a failed or rolled-back step creates no notification; a notification that cannot be written does not stop the step', async () => {
    await withTx(async (c) => {
      const o = await paidPickup(c)
      const before = await countRows(
        c,
        `select count(*)::int n from public.notifications where user_id=$1`,
        [o.cust],
      )
      // an impossible transition fails, so nothing new is announced
      const e = await as(c, AAL2(o.owner), () =>
        failure(c, `select public.vendor_transition_order($1,'mark_ready',null)`, [o.order]),
      )
      expect(e.message).toMatch(/invalid_transition/)
      expect(
        await countRows(c, `select count(*)::int n from public.notifications where user_id=$1`, [
          o.cust,
        ]),
      ).toBe(before)
      // now make EVERY notification insert fail and prove the order step still succeeds and the failure is recorded
      await c.query(
        `create function pg_temp.boom() returns trigger language plpgsql as $$ begin raise exception 'boom'; end $$`,
      )
      await c.query(
        `create trigger boom before insert on public.notifications for each row execute function pg_temp.boom()`,
      )
      const errs = await countRows(c, `select count(*)::int n from public.notification_errors`)
      expect(await act(c, o.owner, o.order, 'accept')).toBe('ACCEPTED')
      await c.query(`drop trigger boom on public.notifications`)
      expect(
        await countRows(
          c,
          `select status='ACCEPTED' as n from public.orders where id=$1`
            .replace('as n', 'as n')
            .replace("select status='ACCEPTED' as n", "select (status='ACCEPTED')::int as n"),
          [o.order],
        ),
      ).toBe(1)
      expect(
        await countRows(c, `select count(*)::int n from public.notification_errors`),
      ).toBeGreaterThan(errs)
      expect(await titlesOf(c, o.cust)).not.toContain('Order accepted')
    })
  })
})

describe('refund, return and report notices', () => {
  it('refund steps tell the customer something changed (no amounts); finance is told when one is waiting', async () => {
    await withTx(async (c) => {
      const { paidOrder } = await import('./refund-helpers')
      const o = await paidOrder(c)
      const fin = await staff(c, 'finance_admin')
      const fin2 = await staff(c, 'finance_admin')
      const r = await requestRefund(c, o.cust, o.order, null)
      await approve(c, fin, r.id)
      expect(await titlesOf(c, o.cust)).toContain('Refund update')
      expect(await titlesOf(c, fin2)).toContain('Refund waiting')
      await startFake(c, fin2, r.id)
      for (const n of [...(await notesOf(c, o.cust)), ...(await notesOf(c, fin2))])
        expect(`${n.title} ${n.body}`).not.toMatch(FORBIDDEN_IN_NOTIFICATION)
      const links = (await notesOf(c, o.cust)).map((n) => n.link)
      expect(
        links.every((l) => l === `/orders/${o.order}/help` || l === `/orders/${o.order}`),
      ).toBe(true)
    })
  })

  it('a new report alerts support; support actions and PUBLIC messages reach the reporter, internal notes do not', async () => {
    await withTx(async (c) => {
      const { paidOrder } = await import('./refund-helpers')
      const o = await paidOrder(c)
      const sup = await staff(c, 'support_agent')
      const k = (await callJson(
        c,
        AAL2(o.cust),
        `select public.open_support_case($1,'missing_item','The drink was missing from the bag',$2) r`,
        [o.order, 'nk-case-12345'],
      )) as { id: string }
      expect(await titlesOf(c, sup)).toContain('New report')
      await callJson(c, AAL2(sup), `select public.case_start_review($1) r`, [k.id])
      await callJson(
        c,
        AAL2(sup),
        `select public.case_add_statement($1,'Public note for the customer',false) r`,
        [k.id],
      )
      const before = (await notesOf(c, o.cust)).length
      await callJson(
        c,
        AAL2(sup),
        `select public.case_add_statement($1,'Internal note, staff only',true) r`,
        [k.id],
      )
      expect((await notesOf(c, o.cust)).length).toBe(before)
      await callJson(
        c,
        AAL2(sup),
        `select public.case_decide($1,'no_action','No evidence of a problem here') r`,
        [k.id],
      )
      const t = await titlesOf(c, o.cust)
      expect(t.filter((x) => x === 'Report update').length).toBeGreaterThanOrEqual(3)
      for (const n of await notesOf(c, o.cust)) {
        expect(`${n.title} ${n.body}`).not.toMatch(FORBIDDEN_IN_NOTIFICATION)
        expect(`${n.title} ${n.body}`).not.toMatch(/Internal|staff only|drink/i)
      }
    })
  })

  it('return decisions notify the customer, and the shop when a return is approved', async () => {
    await withTx(async (c) => {
      const { paidOrder } = await import('./refund-helpers')
      const o = await paidOrder(c)
      const sup = await staff(c, 'support_agent')
      const ret = (await callJson(
        c,
        AAL2(o.cust),
        `select public.customer_request_return($1,$2::jsonb,'It arrived damaged',$3) r`,
        [o.order, JSON.stringify([{ order_item_id: o.items[0]!.id, quantity: 1 }]), 'nk-ret-12345'],
      )) as { id: string }
      await callJson(
        c,
        AAL2(sup),
        `select public.staff_decide_return($1,'approve','Damage reported and accepted') r`,
        [ret.id],
      )
      expect(await titlesOf(c, o.cust)).toContain('Return update')
      expect(await titlesOf(c, o.owner)).toContain('Return approved')
    })
  })
})

describe('only the owner can read, mark or manage notifications', () => {
  it("customers see only their own; marking another person's notice changes nothing; aal1, anonymous and direct writes are refused", async () => {
    await withTx(async (c) => {
      const a = await paidPickup(c)
      const b = await paidPickup(c)
      const mine = await callJson(c, AAL2(a.cust), `select public.list_my_notifications() r`)
      expect(mine.unread).toBe(1)
      expect(mine.items).toHaveLength(1)
      const theirId = (
        await c.query(`select id from public.notifications where user_id=$1`, [b.cust])
      ).rows[0].id as string
      // read through the table: own rows only
      const seen = await as(c, AAL2(a.cust), async () =>
        (await c.query(`select user_id from public.notifications`)).rows.map((r) => r.user_id),
      )
      expect(seen.every((u) => u === a.cust)).toBe(true)
      // marking someone else's id touches zero rows and leaves it unread
      expect(
        await callJson(c, AAL2(a.cust), `select public.notification_mark_read($1) r`, [theirId]),
      ).toBe(0)
      expect(
        await countRows(
          c,
          `select count(*)::int n from public.notifications where id=$1 and read_at is null`,
          [theirId],
        ),
      ).toBe(1)
      for (const sql of [
        `update public.notifications set read_at=now()`,
        `delete from public.notifications`,
        `insert into public.notifications (user_id,kind,title,body,event_key) values ('${a.cust}','order','Fake','Fake notice','x-fake-1')`,
      ]) {
        expect((await as(c, AAL2(a.cust), () => failure(c, sql))).code).toBe(PRIV_DENIED)
      }
      for (const who of [AAL1(a.cust), null]) {
        const e = await as(c, who, () => failure(c, `select public.list_my_notifications()`))
        expect(['42501', '28000']).toContain(e.code)
      }
      // marking my own works, and the unread count follows
      expect(await callJson(c, AAL2(a.cust), `select public.notification_mark_read() r`)).toBe(1)
      expect(
        (await callJson(c, AAL2(a.cust), `select public.list_my_notifications(20,0,true) r`)).items,
      ).toHaveLength(0)
    })
  })

  it('pages are bounded: page size is clamped, offsets work, unread filter works', async () => {
    await withTx(async (c) => {
      const u = await createUser(c, 'u')
      for (let i = 0; i < 60; i++)
        await c.query(
          `select app_private.notify($1,'order','Order update','Open your order.','/orders/x','bulk-${i}')`,
          [u],
        )
      const page = (limit: number, offset: number) =>
        callJson(c, AAL2(u), `select public.list_my_notifications($1,$2) r`, [limit, offset])
      expect((await page(1000, 0)).items).toHaveLength(50) // clamped
      expect((await page(0, 0)).items).toHaveLength(1) // at least one
      expect((await page(20, 50)).items).toHaveLength(10)
      expect((await page(20, 60)).items).toHaveLength(0)
      expect((await page(20, -5)).items).toHaveLength(20) // negative offset treated as 0
      expect((await page(20, 0)).unread).toBe(60)
    })
  })
})

describe('preferences', () => {
  it('the optional channel is off by default; turning it on queues future notices only; essential in-app notices always arrive', async () => {
    await withTx(async (c) => {
      const u = await createUser(c, 'u')
      const send = (k: string) =>
        c.query(
          `select app_private.notify($1,'order','Order update','Open your order.','/orders/x',$2)`,
          [u, k],
        )
      expect(
        (await callJson(c, AAL2(u), `select public.get_notification_preferences() r`))
          .email_enabled,
      ).toBe(false)
      await send('key-p1')
      await callJson(c, AAL2(u), `select public.set_notification_preference(true) r`)
      await send('key-p2')
      const st = (
        await c.query(
          `select n.event_key, o.status from public.notification_outbox o join public.notifications n on n.id=o.notification_id where n.user_id=$1 order by n.created_at, n.event_key`,
          [u],
        )
      ).rows
      expect(st).toEqual([
        { event_key: 'key-p1', status: 'suppressed' },
        { event_key: 'key-p2', status: 'pending' },
      ])
      expect((await notesOf(c, u)).length).toBe(2)
      expect(
        await countRows(
          c,
          `select count(*)::int n from public.audit_events where action='notification.preference_changed' and entity_id=$1`,
          [u],
        ),
      ).toBe(1)
      const e = await as(c, AAL2(u), () =>
        failure(c, `select public.set_notification_preference(null)`),
      )
      expect(e.message).toMatch(/invalid value/)
      // someone else's preference is untouched
      const other = await createUser(c, 'o')
      expect(
        (await callJson(c, AAL2(other), `select public.get_notification_preferences() r`))
          .email_enabled,
      ).toBe(false)
      expect(
        (await as(c, AAL1(u), () => failure(c, `select public.set_notification_preference(true)`)))
          .code,
      ).toBe(PRIV_DENIED)
    })
  })
})

describe('the outbox worker: bounded, retrying, dead-lettering, idempotent', () => {
  const optedIn = async (
    c: Parameters<typeof withTx>[0] extends (c: infer C) => unknown ? C : never,
  ) => {
    const u = await createUser(c, 'u')
    await c.query(
      `insert into public.notification_preferences (user_id, email_enabled) values ($1, true)`,
      [u],
    )
    return u
  }
  const note = (c: Parameters<typeof optedIn>[0], u: string, k: string) =>
    c.query(
      `select app_private.notify($1,'order','Order update','Open your order.','/orders/x',$2)`,
      [u, k],
    )
  const outboxFor = async (c: Parameters<typeof optedIn>[0], u: string) =>
    (
      await c.query(
        `select o.id, o.status, o.attempts, o.last_error, o.next_attempt_at > now() as later from public.notification_outbox o join public.notifications n on n.id=o.notification_id where n.user_id=$1 order by n.event_key`,
        [u],
      )
    ).rows

  it('claims only due work, marks it processing, and completing it records exactly one delivery; repeating is harmless', async () => {
    await isoTx(async (c) => {
      await c.query(
        `update public.notification_outbox set status='dead', locked_at=null where status in ('pending','processing')`,
      )
      const u = await optedIn(c)
      await note(c, u, 'key-w1')
      await note(c, u, 'key-w2')
      const claimed = await asService<{ id: string; title: string }[]>(
        c,
        `select public.notification_outbox_claim(10) r`,
      )
      expect(claimed).toHaveLength(2)
      expect(claimed[0]).toMatchObject({ title: 'Order update' })
      expect(JSON.stringify(claimed)).not.toMatch(/user_id|email/i)
      // a second claim finds nothing while they are processing
      expect(
        await asService<unknown[]>(c, `select public.notification_outbox_claim(10) r`),
      ).toHaveLength(0)
      expect(
        await asService(c, `select public.notification_outbox_complete($1,true) r`, [
          claimed[0]!.id,
        ]),
      ).toBe('sent')
      expect(
        await asService(c, `select public.notification_outbox_complete($1,true) r`, [
          claimed[0]!.id,
        ]),
      ).toBe('sent') // repeated
      expect(
        await countRows(
          c,
          `select count(*)::int n from public.notification_deliveries where outbox_id=$1`,
          [claimed[0]!.id],
        ),
      ).toBe(1)
    })
  })

  it('failures retry with growing delay, and the fifth failure is dead-lettered; nothing runs forever', async () => {
    await isoTx(async (c) => {
      await c.query(
        `update public.notification_outbox set status='dead', locked_at=null where status in ('pending','processing')`,
      )
      const u = await optedIn(c)
      await note(c, u, 'key-f1')
      const id = (await outboxFor(c, u))[0]!.id as string
      const statuses: string[] = []
      for (let i = 0; i < 5; i++) {
        await c.query(
          `update public.notification_outbox set next_attempt_at = now() - interval '1 second' where id=$1 and status='pending'`,
          [id],
        )
        const got = await asService<unknown[]>(c, `select public.notification_outbox_claim(5) r`)
        expect(got).toHaveLength(1)
        statuses.push(
          await asService<string>(
            c,
            `select public.notification_outbox_complete($1,false,'sink unavailable') r`,
            [id],
          ),
        )
      }
      expect(statuses).toEqual(['pending', 'pending', 'pending', 'pending', 'dead'])
      const row = (await outboxFor(c, u))[0]!
      expect(row).toMatchObject({ status: 'dead', attempts: 5, last_error: 'sink unavailable' })
      expect(
        await asService<unknown[]>(c, `select public.notification_outbox_claim(5) r`),
      ).toHaveLength(0)
      expect(
        await countRows(
          c,
          `select count(*)::int n from public.notification_deliveries where outbox_id=$1`,
          [id],
        ),
      ).toBe(0)
    })
  })

  it('a worker that died is recovered: stale "processing" work is reclaimed, and dead after its attempts are used up', async () => {
    await isoTx(async (c) => {
      await c.query(
        `update public.notification_outbox set status='dead', locked_at=null where status in ('pending','processing')`,
      )
      const u = await optedIn(c)
      await note(c, u, 'key-s1')
      await note(c, u, 'key-s2')
      const rows = await outboxFor(c, u)
      await asService(c, `select public.notification_outbox_claim(10) r`)
      // pretend both workers crashed 10 minutes ago; one has already used all its attempts
      await c.query(
        `update public.notification_outbox set locked_at = now() - interval '10 minutes' where id = any($1::uuid[])`,
        [rows.map((r) => r.id)],
      )
      await c.query(`update public.notification_outbox set attempts = 5 where id=$1`, [rows[1]!.id])
      const again = await asService<{ id: string }[]>(
        c,
        `select public.notification_outbox_claim(10) r`,
      )
      expect(again.map((x) => x.id)).toEqual([rows[0]!.id])
      expect((await outboxFor(c, u)).map((r) => r.status)).toEqual(['processing', 'dead'])
    })
  })

  it('the worker functions are not callable by customers, staff or anonymous callers; claim size is clamped', async () => {
    await withTx(async (c) => {
      const u = await createUser(c, 'u')
      const admin = await staff(c, 'platform_admin')
      for (const who of [AAL2(u), AAL2(admin), null]) {
        for (const sql of [
          `select public.notification_outbox_claim(5)`,
          `select public.notification_outbox_complete(gen_random_uuid(), true)`,
          `select public.record_job_run('process-notifications', true)`,
        ]) {
          const e = await as(c, who, () => failure(c, sql))
          expect(['42501', '28000']).toContain(e.code)
        }
      }
      await c.query(
        `update public.notification_outbox set status='dead', locked_at=null where status in ('pending','processing')`,
      )
      const optin = await optedIn(c)
      for (let i = 0; i < 60; i++) await note(c, optin, `c-${i}`)
      expect(
        await asService<unknown[]>(c, `select public.notification_outbox_claim(100000) r`),
      ).toHaveLength(50)
      expect(
        await asService<unknown[]>(c, `select public.notification_outbox_claim(0) r`),
      ).toHaveLength(1)
    })
  })

  it('health shows pending, retrying, stuck, dead and suppressed work, and the last job runs; platform admin only', async () => {
    await withTx(async (c) => {
      await c.query(
        `update public.notification_outbox set status='dead', locked_at=null where status in ('pending','processing')`,
      )
      const u = await optedIn(c)
      const other = await createUser(c, 'o')
      await note(c, u, 'key-h1')
      await note(c, other, 'key-h2') // suppressed
      await asService(
        c,
        `select public.record_job_run('process-notifications', true, '{"claimed":1}'::jsonb) r`,
      )
      await asService(
        c,
        `select public.record_job_run('purge-location', false, '{"error":"x"}'::jsonb) r`,
      )
      const admin = await staff(c, 'platform_admin')
      const h = await callJson(c, AAL2(admin), `select public.admin_job_health() r`)
      expect(h.notifications.pending).toBe(1)
      expect(h.notifications.suppressed).toBeGreaterThanOrEqual(1)
      const byJob = Object.fromEntries(
        (h.jobs as { job: string; last_run_ok: boolean | null }[]).map((j) => [j.job, j]),
      )
      expect(byJob['process-notifications']).toMatchObject({ last_run_ok: true })
      expect(byJob['purge-location']).toMatchObject({ last_run_ok: false, failures_24h: 1 })
      expect(
        (byJob['expire-orders']! as unknown as { last_run_at: string | null }).last_run_at,
      ).toBeNull()
      expect(h.note).toMatch(/does not schedule/)
      const sup = await staff(c, 'support_agent')
      const fin = await staff(c, 'finance_admin')
      for (const who of [AAL2(sup), AAL2(fin), AAL2(u), AAL1(admin)]) {
        expect((await as(c, who, () => failure(c, `select public.admin_job_health()`))).code).toBe(
          PRIV_DENIED,
        )
      }
    })
  })
})

describe('sanity: the service role can still run the earlier jobs', () => {
  it('expire_unpaid_orders and purge_location_data remain service-only', async () => {
    await withTx(async (c) => {
      const u = await createUser(c, 'u')
      await giveRole(c, u, 'customer')
      for (const sql of [
        `select public.expire_unpaid_orders()`,
        `select public.purge_location_data()`,
      ]) {
        expect((await as(c, AAL2(u), () => failure(c, sql))).code).toBe(PRIV_DENIED)
        const r = await svc(c, async () => (await c.query(sql)).rowCount)
        expect(r).toBe(1)
      }
    })
  })
})
