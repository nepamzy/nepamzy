import { afterAll, describe, expect, it } from 'vitest'
import { AAL1, AAL2, PRIV_DENIED, as, createUser, failure, pool, withTx } from './helpers'
import { callFails, callJson, paidOrder, requestRefund, staff } from './refund-helpers'
import { asService, countRows } from './notif-helpers'

afterAll(async () => {
  await pool.end()
})

type Overview = Record<string, number>

describe('admin_overview is scoped by role', () => {
  it('each staff role sees only its own counters; others are refused', async () => {
    await withTx(async (c) => {
      const support = await staff(c, 'support_agent')
      const finance = await staff(c, 'finance_admin')
      const admin = await staff(c, 'platform_admin')
      const plain = await createUser(c, 'plain')

      const s = (await callJson(c, AAL2(support), `select public.admin_overview() r`)) as Overview
      expect(s).toHaveProperty('cases_open')
      expect(s).not.toHaveProperty('refunds_requested')
      expect(s).not.toHaveProperty('notifications_dead')

      const f = (await callJson(c, AAL2(finance), `select public.admin_overview() r`)) as Overview
      expect(f).toHaveProperty('refunds_requested')
      expect(f).not.toHaveProperty('cases_open')
      expect(f).not.toHaveProperty('notifications_dead')

      const a = (await callJson(c, AAL2(admin), `select public.admin_overview() r`)) as Overview
      for (const k of [
        'cases_open',
        'refunds_requested',
        'vendor_applications_pending',
        'notifications_dead',
      ])
        expect(a).toHaveProperty(k)
      for (const v of Object.values(a)) expect(typeof v).toBe('number')

      expect((await callFails(c, AAL2(plain), `select public.admin_overview() r`)).code).toBe(
        PRIV_DENIED,
      )
      expect((await callFails(c, AAL1(admin), `select public.admin_overview() r`)).code).toBe(
        PRIV_DENIED,
      )
      expect((await callFails(c, null, `select public.admin_overview() r`)).code).toBe(PRIV_DENIED)
    })
  })

  it('counters reflect real rows', async () => {
    await withTx(async (c) => {
      const admin = await staff(c, 'platform_admin')
      const before = (await callJson(
        c,
        AAL2(admin),
        `select public.admin_overview() r`,
      )) as Overview
      const o = await paidOrder(c)
      await requestRefund(c, o.cust, o.order, null)
      const after = (await callJson(c, AAL2(admin), `select public.admin_overview() r`)) as Overview
      expect(after.refunds_requested).toBe((before.refunds_requested ?? 0) + 1)
    })
  })
})

describe('bounded staff lists', () => {
  it('staff_list_refunds clamps limit/offset, filters by status and order number, rejects bad status', async () => {
    await withTx(async (c) => {
      const admin = await staff(c, 'platform_admin')
      const o = await paidOrder(c)
      await requestRefund(c, o.cust, o.order, null)
      const num = (await c.query(`select order_number from public.orders where id=$1`, [o.order]))
        .rows[0].order_number as string

      const list = (limit: number, offset: number, status: string | null, q: string | null) =>
        callJson(c, AAL2(admin), `select public.staff_list_refunds($1,$2,$3,$4) r`, [
          status,
          limit,
          offset,
          q,
        ]) as Promise<{ order_number: string; status: string }[]>

      expect((await list(5000, 0, null, null)).length).toBeLessThanOrEqual(100)
      expect((await list(-5, -5, null, null)).length).toBeLessThanOrEqual(1)
      expect((await list(10, 0, 'requested', num)).map((r) => r.order_number)).toEqual([num])
      expect(await list(10, 0, 'succeeded', num)).toEqual([])
      expect(await list(10, 0, null, 'no-such-order-zzz')).toEqual([])
      // LIKE metacharacters are matched literally, not as wildcards.
      expect(await list(10, 0, null, '%')).toEqual([])
      expect(await list(10, 0, null, '_')).toEqual([])
      expect(await list(10, 100000, null, null)).toEqual([])
      const bad = await callFails(c, AAL2(admin), `select public.staff_list_refunds($1) r`, [
        'bogus; drop table x',
      ])
      expect(bad.code).toBe('22023')
    })
  })

  it('staff_list_cases is bounded, searchable and refuses bad status and non-support roles', async () => {
    await withTx(async (c) => {
      const support = await staff(c, 'support_agent')
      const finance = await staff(c, 'finance_admin')
      const o = await paidOrder(c)
      await callJson(
        c,
        AAL2(o.cust),
        `select public.open_support_case($1,'wrong_item','The item was not what I ordered at all',null) r`,
        [o.order],
      )
      const num = (await c.query(`select order_number from public.orders where id=$1`, [o.order]))
        .rows[0].order_number as string
      const rows = (await callJson(
        c,
        AAL2(support),
        `select public.staff_list_cases('open',1000,0,$1) r`,
        [num],
      )) as { order_number: string }[]
      expect(rows.map((r) => r.order_number)).toEqual([num])
      expect(
        (
          (await callJson(
            c,
            AAL2(support),
            `select public.staff_list_cases(null,1000,0,'%') r`,
          )) as unknown[]
        ).length,
      ).toBe(0)
      expect(
        (await callFails(c, AAL2(support), `select public.staff_list_cases('weird') r`)).code,
      ).toBe('22023')
      expect((await callFails(c, AAL2(finance), `select public.staff_list_cases() r`)).code).toBe(
        PRIV_DENIED,
      )
    })
  })

  it('list_returns is bounded and scoped to the customer, vendor or support', async () => {
    await withTx(async (c) => {
      const o = await paidOrder(c)
      const other = await createUser(c, 'other')
      const mine = (await callJson(
        c,
        AAL2(o.cust),
        `select public.list_returns(null,5000,-3) r`,
      )) as unknown[]
      expect(Array.isArray(mine)).toBe(true)
      expect(mine.length).toBeLessThanOrEqual(100)
      expect(
        (await callJson(c, AAL2(other), `select public.list_returns($1,10,0) r`, [
          o.order,
        ])) as unknown[],
      ).toEqual([])
      expect((await callFails(c, null, `select public.list_returns() r`)).code).toBe(PRIV_DENIED)
      expect((await callFails(c, AAL1(o.cust), `select public.list_returns() r`)).code).toBe(
        PRIV_DENIED,
      )
    })
  })
})

describe('job log and health', () => {
  it('admin_job_health is platform_admin only', async () => {
    await withTx(async (c) => {
      const admin = await staff(c, 'platform_admin')
      const support = await staff(c, 'support_agent')
      const finance = await staff(c, 'finance_admin')
      const h = (await callJson(c, AAL2(admin), `select public.admin_job_health() r`)) as {
        jobs: { job: string }[]
        notifications: Record<string, number>
        note: string
      }
      expect(h.jobs.map((j) => j.job)).toEqual([
        'expire-orders',
        'process-notifications',
        'purge-location',
      ])
      expect(h.note).toMatch(/does not schedule/i)
      for (const who of [support, finance])
        expect((await callFails(c, AAL2(who), `select public.admin_job_health() r`)).code).toBe(
          PRIV_DENIED,
        )
      expect((await callFails(c, AAL1(admin), `select public.admin_job_health() r`)).code).toBe(
        PRIV_DENIED,
      )
    })
  })

  it('record_job_run is service-role only and feeds the health view', async () => {
    await withTx(async (c) => {
      const admin = await staff(c, 'platform_admin')
      for (const who of [AAL2(admin), null]) {
        const e = await as(c, who, () =>
          failure(c, `select public.record_job_run('expire-orders', true, '{}')`),
        )
        expect(e.code).toBe(PRIV_DENIED)
      }
      await asService(c, `select public.record_job_run('expire-orders', false, '{"n":1}') r`)
      await asService(c, `select public.record_job_run('expire-orders', true, '{"n":2}') r`)
      expect(
        await countRows(c, `select count(*) n from public.job_runs where job='expire-orders'`),
      ).toBeGreaterThanOrEqual(2)
      const h = (await callJson(c, AAL2(admin), `select public.admin_job_health() r`)) as {
        jobs: { job: string; last_run_ok: boolean; failures_24h: number }[]
      }
      const j = h.jobs.find((x) => x.job === 'expire-orders')!
      expect(j.last_run_ok).toBe(true)
      expect(j.failures_24h).toBeGreaterThanOrEqual(1)
    })
  })

  it('job_runs is append-only for the job log is not writable by app roles', async () => {
    await withTx(async (c) => {
      const admin = await staff(c, 'platform_admin')
      const e = await as(c, AAL2(admin), () =>
        failure(c, `insert into public.job_runs (job, ok) values ('x', true)`),
      )
      expect(e.code).toBe(PRIV_DENIED)
    })
  })
})
