import { afterAll, describe, expect, it } from 'vitest'
import type { PoolClient } from 'pg'
import { PRIV_DENIED, as, createUser, pool, svc, withTx } from './helpers'
import { callFails, callJson } from './rider-helpers'
import { staff } from './refund-helpers'
import { AAL2 } from './helpers'
import { asService } from './notif-helpers'

afterAll(async () => {
  await pool.end()
})

type Problem = { job: string; kind: string }
const problems = async (c: PoolClient) =>
  ((await asService<{ ok: boolean; problems: Problem[] }>(c, `select public.job_health_check() r`))
    .problems ?? []) as Problem[]
const kinds = (ps: Problem[], job: string) =>
  ps
    .filter((p) => p.job === job)
    .map((p) => p.kind)
    .sort()
/** Isolate from whatever earlier suites left in the job log and the outbox. */
async function clean(c: PoolClient) {
  await c.query(`set local session_replication_role = replica`)
  await c.query(`delete from public.job_runs`)
  await c.query(`delete from public.notification_outbox`)
  await c.query(`delete from public.notification_errors`)
  await c.query(`set local session_replication_role = origin`)
}
const run = (c: PoolClient, job: string, ok: boolean, ageMin = 0) =>
  c.query(
    `insert into public.job_runs (job, ok, finished_at) values ($1, $2, now() - make_interval(mins => $3))`,
    [job, ok, ageMin],
  )

describe('job health check: a job that stopped, keeps failing or piles up work is detected', () => {
  it('a job that never ran is reported; nothing is reported for a healthy set', async () => {
    await withTx(async (c) => {
      await clean(c)
      expect((await problems(c)).map((p) => `${p.job}:${p.kind}`).sort()).toEqual([
        'expire-orders:never_run',
        'process-notifications:never_run',
        'purge-location:never_run',
      ])
      for (const j of ['expire-orders', 'process-notifications', 'purge-location'])
        await run(c, j, true)
      expect(await problems(c)).toEqual([])
      expect((await asService<{ ok: boolean }>(c, `select public.job_health_check() r`)).ok).toBe(
        true,
      )
    })
  })

  it('a job whose last success is older than its window is stale, even though its row exists', async () => {
    await withTx(async (c) => {
      await clean(c)
      await run(c, 'expire-orders', true, 16) // window 15 minutes
      await run(c, 'process-notifications', true, 4) // window 5 minutes
      await run(c, 'purge-location', true, 179) // window 180 minutes
      expect(await problems(c)).toEqual([
        { job: 'expire-orders', kind: 'stale', last_ok_at: expect.any(String) },
      ])
    })
  })

  it('failures are reported: last run failed, and repeated failures; success afterwards clears the first', async () => {
    await withTx(async (c) => {
      await clean(c)
      for (const j of ['expire-orders', 'process-notifications', 'purge-location'])
        await run(c, j, true, 20)
      await run(c, 'purge-location', true, 1)
      await run(c, 'process-notifications', false, 3)
      await run(c, 'process-notifications', false, 2)
      await run(c, 'process-notifications', false, 1)
      await run(c, 'process-notifications', true, 4)
      expect(kinds(await problems(c), 'process-notifications')).toEqual([
        'last_run_failed',
        'repeated_failures',
      ])
      await run(c, 'process-notifications', true, 0)
      expect(kinds(await problems(c), 'process-notifications')).toEqual(['repeated_failures'])
    })
  })

  it('dead, stuck and backlogged notifications and write errors are reported', async () => {
    await withTx(async (c) => {
      await clean(c)
      for (const j of ['expire-orders', 'process-notifications', 'purge-location'])
        await run(c, j, true)
      const u = await createUser(c, 'n')
      const mk = async (status: string, age: string, locked: string | null = null) => {
        const n = (
          await c.query(
            `insert into public.notifications (user_id, kind, title, body, event_key) values ($1, 'order', 'Order update', 'Open your order to see what changed.', $2) returning id`,
            [u, `k-${Math.random().toString(36).slice(2)}`],
          )
        ).rows[0].id
        await c.query(
          `insert into public.notification_outbox (notification_id, channel, status, created_at, locked_at)
           values ($1, 'local_sink', $2, now() - $3::interval, case when $4::text is null then null else now() - $4::interval end)`,
          [n, status, age, locked],
        )
      }
      // outbox rows only exist for opted-in users
      await c.query(
        `insert into public.notification_preferences (user_id, email_enabled) values ($1, true)`,
        [u],
      )
      await mk('dead', '1 minute')
      await mk('processing', '1 hour', '10 minutes')
      await mk('pending', '30 minutes')
      await c.query(
        `insert into public.notification_errors (user_id, event_key, error) values ($1, 'k', 'boom')`,
        [u],
      )
      expect(kinds(await problems(c), 'process-notifications')).toEqual([
        'notifications_backlog',
        'notifications_dead',
        'notifications_stuck',
        'write_errors',
      ])
    })
  })

  it('only the service role can run the check; administrators see the same verdict', async () => {
    await withTx(async (c) => {
      await clean(c)
      const admin = await staff(c, 'platform_admin')
      const cust = await createUser(c, 'c')
      for (const who of [null, AAL2(cust), AAL2(admin)])
        expect((await callFails(c, who, `select public.job_health_check() r`)).code).toBe(
          PRIV_DENIED,
        )
      const h = (await callJson(c, AAL2(admin), `select public.admin_job_health() r`)) as {
        problems: Problem[]
        jobs: { max_age_minutes: number }[]
      }
      expect(h.problems.map((p) => p.kind)).toContain('never_run')
      expect(h.jobs.map((j) => j.max_age_minutes)).toEqual([15, 5, 180])
      void as
      void svc
    })
  })
})
