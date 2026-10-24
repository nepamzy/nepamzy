import { afterAll, describe, expect, it } from 'vitest'
import type { PoolClient } from 'pg'
import { AAL1, AAL2, PRIV_DENIED, as, createUser, failure, pool, svc, withTx } from './helpers'
import { callFails, callJson, staff } from './refund-helpers'
import { asService, countRows } from './notif-helpers'

afterAll(async () => {
  await pool.end()
})

/** A notification for a user who opted in, with its outbox item forced to 'dead' and aged past the minimum wait. */
async function deadItem(
  c: PoolClient,
  opts: { optedIn?: boolean; ageMin?: number; notifAgeDays?: number } = {},
) {
  const user = await createUser(c, 'rq')
  if (opts.optedIn !== false)
    await c.query(
      `insert into public.notification_preferences (user_id, email_enabled) values ($1, true)`,
      [user],
    )
  await c.query(
    `select app_private.notify($1,'order','Order update','Open your order.','/orders/x',$2)`,
    [user, `rq-${Math.random()}`],
  )
  const note = (await c.query(`select id from public.notifications where user_id=$1`, [user]))
    .rows[0].id as string
  if (opts.notifAgeDays)
    await c.query(
      `update public.notifications set created_at = now() - make_interval(days => $2) where id=$1`,
      [note, opts.notifAgeDays],
    )
  if (opts.optedIn === false)
    await c.query(
      `insert into public.notification_outbox (notification_id, status) values ($1,'pending') on conflict do nothing`,
      [note],
    )
  const outbox = (
    await c.query(`select id from public.notification_outbox where notification_id=$1`, [note])
  ).rows[0].id as string
  await c.query(
    `update public.notification_outbox set status='dead', locked_at=null, attempts=5, last_error='boom',
            created_at = now() - make_interval(mins => $2) where id=$1`,
    [outbox, opts.ageMin ?? 60],
  )
  return { user, note, outbox }
}
const requeue = (
  c: PoolClient,
  who: string,
  outbox: string,
  reason = 'Sink was down; verified recipient',
) =>
  callJson(c, AAL2(who), `select public.admin_requeue_notification($1,$2) r`, [
    outbox,
    reason,
  ]) as Promise<{
    requeued: boolean
    blocked_by?: string
  }>
const row = async (c: PoolClient, id: string) =>
  (
    await c.query(
      `select status, attempts, last_error from public.notification_outbox where id=$1`,
      [id],
    )
  ).rows[0]

describe('dead-notification requeue: authorization', () => {
  it('only a platform administrator at aal2 may list or requeue; everyone else is refused', async () => {
    await withTx(async (c) => {
      const admin = await staff(c, 'platform_admin')
      const support = await staff(c, 'support_agent')
      const finance = await staff(c, 'finance_admin')
      const plain = await createUser(c, 'plain')
      const d = await deadItem(c)
      for (const who of [AAL2(support), AAL2(finance), AAL2(plain), AAL1(admin), null]) {
        expect(
          (
            await callFails(c, who, `select public.admin_requeue_notification($1,$2) r`, [
              d.outbox,
              'a good enough reason',
            ])
          ).code,
        ).toBe(PRIV_DENIED)
        expect(
          (await callFails(c, who, `select public.admin_list_dead_notifications() r`)).code,
        ).toBe(PRIV_DENIED)
      }
      expect((await row(c, d.outbox)).status).toBe('dead')
      const list = (await callJson(
        c,
        AAL2(admin),
        `select public.admin_list_dead_notifications() r`,
      )) as {
        id: string
        eligible: boolean
      }[]
      const mine = list.find((x) => x.id === d.outbox)
      expect(mine?.eligible).toBe(true)
      // the listing never carries message text
      expect(JSON.stringify(list)).not.toMatch(/Open your order|Order update/)
    })
  })

  it('anon and ordinary roles cannot write the history or call the internal helper', async () => {
    await withTx(async (c) => {
      const admin = await staff(c, 'platform_admin')
      const d = await deadItem(c)
      const e = await as(c, AAL2(admin), () =>
        failure(
          c,
          `insert into public.notification_requeues (outbox_id, actor_id, reason, previous_status, previous_attempts) values ($1,$2,'xxxxxxxxxx','dead',5)`,
          [d.outbox, admin],
        ),
      )
      expect(e.code).toBe(PRIV_DENIED)
      const e2 = await as(c, AAL2(admin), () =>
        failure(c, `select app_private.requeue_problem($1)`, [d.outbox]),
      )
      expect(e2.code).toBe(PRIV_DENIED)
    })
  })
})

describe('dead-notification requeue: behaviour', () => {
  it('requeues an eligible dead item once, records who/why/prior state, audits, and is refused the second time', async () => {
    await withTx(async (c) => {
      const admin = await staff(c, 'platform_admin')
      const d = await deadItem(c)
      expect(await requeue(c, admin, d.outbox)).toEqual({ requeued: true })
      expect(await row(c, d.outbox)).toMatchObject({
        status: 'pending',
        attempts: 3,
        last_error: null,
      })
      const h = (
        await c.query(
          `select actor_id, reason, previous_status, previous_attempts, previous_error from public.notification_requeues where outbox_id=$1`,
          [d.outbox],
        )
      ).rows
      expect(h).toEqual([
        {
          actor_id: admin,
          reason: 'Sink was down; verified recipient',
          previous_status: 'dead',
          previous_attempts: 5,
          previous_error: 'boom',
        },
      ])
      expect(
        await countRows(
          c,
          `select count(*) n from public.audit_events where action='notification.requeued' and entity_id=$1`,
          [d.outbox],
        ),
      ).toBe(1)
      // a second call finds a pending item: refused, nothing duplicated
      expect(await requeue(c, admin, d.outbox)).toEqual({ requeued: false, blocked_by: 'not_dead' })
      expect(
        await countRows(
          c,
          `select count(*) n from public.notification_requeues where outbox_id=$1`,
          [d.outbox],
        ),
      ).toBe(1)
    })
  })

  it('a requeued item runs through the normal worker and is delivered once', async () => {
    await withTx(async (c) => {
      const admin = await staff(c, 'platform_admin')
      const d = await deadItem(c)
      await requeue(c, admin, d.outbox)
      const claimed = await asService<{ id: string }[]>(
        c,
        `select public.notification_outbox_claim(50) r`,
      )
      expect(claimed.map((x) => x.id)).toContain(d.outbox)
      expect(
        await asService<string>(c, `select public.notification_outbox_complete($1,true) r`, [
          d.outbox,
        ]),
      ).toBe('sent')
      expect(
        await countRows(
          c,
          `select count(*) n from public.notification_deliveries where outbox_id=$1`,
          [d.outbox],
        ),
      ).toBe(1)
      // once delivered it can never be requeued
      expect(await requeue(c, admin, d.outbox)).toEqual({ requeued: false, blocked_by: 'not_dead' })
    })
  })

  it('refuses a short or missing reason and records nothing', async () => {
    await withTx(async (c) => {
      const admin = await staff(c, 'platform_admin')
      const d = await deadItem(c)
      for (const bad of ['', 'short', '   x   ', 'y'.repeat(501)])
        expect(
          (
            await callFails(c, AAL2(admin), `select public.admin_requeue_notification($1,$2) r`, [
              d.outbox,
              bad,
            ])
          ).code,
        ).toBe('22023')
      expect((await row(c, d.outbox)).status).toBe('dead')
      expect(
        await countRows(
          c,
          `select count(*) n from public.notification_requeues where outbox_id=$1`,
          [d.outbox],
        ),
      ).toBe(0)
    })
  })

  it('performs a fresh eligibility check: too recent, opted out, expired and bounded requeues are refused (and the refusal is audited)', async () => {
    await withTx(async (c) => {
      const admin = await staff(c, 'platform_admin')
      const recent = await deadItem(c, { ageMin: 2 })
      const optedOut = await deadItem(c, { optedIn: false })
      const expired = await deadItem(c, { notifAgeDays: 9 })
      expect(await requeue(c, admin, recent.outbox)).toEqual({
        requeued: false,
        blocked_by: 'too_recent',
      })
      expect(await requeue(c, admin, optedOut.outbox)).toEqual({
        requeued: false,
        blocked_by: 'recipient_opted_out',
      })
      expect(await requeue(c, admin, expired.outbox)).toEqual({
        requeued: false,
        blocked_by: 'notification_expired',
      })
      for (const x of [recent, optedOut, expired])
        expect((await row(c, x.outbox)).status).toBe('dead')
      expect(
        await countRows(
          c,
          `select count(*) n from public.audit_events where action='notification.requeue_refused'`,
        ),
      ).toBeGreaterThanOrEqual(3)
      // the recipient withdraws consent after the failure: no longer eligible
      const d = await deadItem(c)
      await c.query(
        `update public.notification_preferences set email_enabled=false where user_id=$1`,
        [d.user],
      )
      expect(await requeue(c, admin, d.outbox)).toEqual({
        requeued: false,
        blocked_by: 'recipient_opted_out',
      })
      // bounded: a third requeue is refused
      const e = await deadItem(c)
      for (let i = 0; i < 2; i++) {
        expect((await requeue(c, admin, e.outbox)).requeued).toBe(true)
        await c.query(
          `update public.notification_outbox set status='dead', locked_at=null, attempts=5 where id=$1`,
          [e.outbox],
        )
      }
      expect(await requeue(c, admin, e.outbox)).toEqual({
        requeued: false,
        blocked_by: 'requeue_limit_reached',
      })
    })
  })

  it('history and dead rows are append-only/preserved: the history cannot be edited or deleted', async () => {
    await withTx(async (c) => {
      const admin = await staff(c, 'platform_admin')
      const d = await deadItem(c)
      await requeue(c, admin, d.outbox)
      for (const sql of [
        `update public.notification_requeues set reason='tampered tampered'`,
        `delete from public.notification_requeues`,
      ]) {
        const e = await svc(c, () => failure(c, sql))
        expect(e.message).toMatch(/append-only|not allowed|denied/i)
      }
    })
  })
})
