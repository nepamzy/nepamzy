import { afterAll, describe, expect, it } from 'vitest'
import { AAL1, AAL2, PRIV_DENIED, createUser, pool, withTx } from './helpers'
import { callFails, callJson, staff } from './refund-helpers'

afterAll(async () => {
  await pool.end()
})

const submit = (
  c: Parameters<typeof callJson>[0],
  who: string,
  kind: string,
  detail: string | null = null,
) =>
  callJson(c, AAL2(who), `select public.submit_data_request($1,$2) r`, [kind, detail]) as Promise<{
    created: boolean
    reason?: string
  }>

describe('account closure and personal-data requests', () => {
  it('a user records a request once per kind while one is open; others cannot see it; the audit trail records it', async () => {
    await withTx(async (c) => {
      const u = await createUser(c, 'req')
      const other = await createUser(c, 'other')
      expect(await submit(c, u, 'access', 'Please send me a copy of my data')).toMatchObject({
        created: true,
      })
      expect(await submit(c, u, 'access')).toEqual({ created: false, reason: 'already_open' })
      expect(await submit(c, u, 'closure')).toMatchObject({ created: true })
      const mine = (await callJson(c, AAL2(u), `select public.my_data_requests() r`)) as {
        kind: string
        status: string
      }[]
      expect(mine.map((r) => r.kind).sort()).toEqual(['access', 'closure'])
      expect(await callJson(c, AAL2(other), `select public.my_data_requests() r`)).toEqual([])
      expect(
        Number(
          (
            await c.query(
              `select count(*) n from public.audit_events where action='data_request.submitted' and actor_id=$1`,
              [u],
            )
          ).rows[0].n,
        ),
      ).toBe(2)
    })
  })

  it('refuses unknown kinds, over-long detail, aal1 and anonymous callers', async () => {
    await withTx(async (c) => {
      const u = await createUser(c, 'bad')
      expect(
        (
          await callFails(
            c,
            AAL2(u),
            `select public.submit_data_request('delete-everything-now', null) r`,
          )
        ).message,
      ).toMatch(/invalid_kind/)
      expect(
        (
          await callFails(c, AAL2(u), `select public.submit_data_request('other',$1) r`, [
            'x'.repeat(501),
          ])
        ).message,
      ).toMatch(/detail_too_long/)
      for (const who of [AAL1(u), null])
        expect(
          (await callFails(c, who, `select public.submit_data_request('other', null) r`)).code,
        ).toBe(PRIV_DENIED)
    })
  })

  it('only platform administrators list and resolve; a note is mandatory; resolving twice is refused; the requester sees the outcome', async () => {
    await withTx(async (c) => {
      const u = await createUser(c, 'subject')
      const admin = await staff(c, 'platform_admin')
      const support = await staff(c, 'support_agent')
      await submit(c, u, 'deletion', 'Close and remove my account')
      const list = (await callJson(
        c,
        AAL2(admin),
        `select public.admin_list_data_requests('open') r`,
      )) as { id: string; requester: string }[]
      expect(list.length).toBeGreaterThanOrEqual(1)
      const mine = list.find((r) => r.requester)!
      for (const who of [AAL2(support), AAL2(u), AAL1(admin), null]) {
        expect((await callFails(c, who, `select public.admin_list_data_requests() r`)).code).toBe(
          PRIV_DENIED,
        )
        expect(
          (
            await callFails(
              c,
              who,
              `select public.admin_resolve_data_request($1,'completed','Handled by hand today') r`,
              [mine.id],
            )
          ).code,
        ).toBe(PRIV_DENIED)
      }
      expect(
        (
          await callFails(
            c,
            AAL2(admin),
            `select public.admin_resolve_data_request($1,'completed','short') r`,
            [mine.id],
          )
        ).code,
      ).toBe('22023')
      await callJson(
        c,
        AAL2(admin),
        `select public.admin_resolve_data_request($1,'declined','Account has open orders; try again later') r`,
        [mine.id],
      )
      expect(
        (
          await callFails(
            c,
            AAL2(admin),
            `select public.admin_resolve_data_request($1,'completed','Handled by hand today') r`,
            [mine.id],
          )
        ).message,
      ).toMatch(/already_resolved/)
      expect(
        Number(
          (
            await c.query(
              `select count(*) n from public.audit_events where action='data_request.declined' and actor_id=$1`,
              [admin],
            )
          ).rows[0].n,
        ),
      ).toBe(1)
    })
  })
})
