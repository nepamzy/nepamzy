import { afterAll, describe, expect, it } from 'vitest'
import {
  AAL1,
  AAL2,
  PRIV_DENIED,
  as,
  createUser,
  failure,
  giveRole,
  pool,
  svc,
  withTx,
} from './helpers'
import { callFails, callJson } from './rider-helpers'
import { staff } from './refund-helpers'

afterAll(async () => {
  await pool.end()
})

const REASON = 'Pilot rehearsal: adjusting a value for testing'
const set = (key: string, value: unknown, reason: string | null = REASON) =>
  [
    `select public.set_platform_setting($1, $2::jsonb, $3) r`,
    [key, JSON.stringify(value), reason],
  ] as [string, unknown[]]
const read = async (
  c: Parameters<typeof withTx>[0] extends (c: infer C) => unknown ? C : never,
  key: string,
) =>
  (await c.query(`select value from public.platform_settings where key=$1`, [key])).rows[0]?.value
const auditCount = async (c: Parameters<typeof read>[0], key: string) =>
  Number(
    (
      await c.query(
        `select count(*) n from public.audit_events where action='setting.changed' and entity_id=$1`,
        [key],
      )
    ).rows[0].n,
  )

describe('set_platform_setting: authority, allowlist, reason and audit', () => {
  it('only a platform administrator at aal2 can call it; every other caller fails and nothing changes', async () => {
    await withTx(async (c) => {
      const before = await read(c, 'vendor_commission_bps')
      const admin = await staff(c, 'platform_admin')
      const others = [
        ['anon', null],
        ['customer', AAL2(await createUser(c, 'c'))],
        ['support', AAL2(await staff(c, 'support_agent'))],
        ['finance', AAL2(await staff(c, 'finance_admin'))],
        ['admin at aal1', AAL1(admin)],
      ] as const
      for (const [label, who] of others) {
        const e = await callFails(c, who, ...set('vendor_commission_bps', 700))
        expect(e.code, label).toBe(PRIV_DENIED)
      }
      expect(await read(c, 'vendor_commission_bps')).toEqual(before)
      expect(await auditCount(c, 'vendor_commission_bps')).toBe(0)
    })
  })

  it('unknown keys are rejected, whatever the value, and nothing is created', async () => {
    await withTx(async (c) => {
      const admin = AAL2(await staff(c, 'platform_admin'))
      for (const k of [
        'support_email',
        'made_up_key',
        '',
        'PLATFORM_FEE_BPS',
        "x'; drop table public.orders;--",
        'rider_terms_current_version ',
      ]) {
        const e = await callFails(c, admin, ...set(k, 1))
        expect(e.message, k).toMatch(/unknown_setting/)
      }
      expect(
        Number(
          (
            await c.query(
              `select count(*) n from public.platform_settings where key = 'support_email'`,
            )
          ).rows[0].n,
        ),
      ).toBe(0)
    })
  })

  it('the table itself refuses unknown keys (service role and owner paths included)', async () => {
    await withTx(async (c) => {
      const e = await failure(
        c,
        `insert into public.platform_settings (key, value) values ('sneaky_flag', 'true'::jsonb)`,
      )
      expect(e.message).toMatch(/unknown_setting/)
    })
  })

  it('the service role (used by the job routes and the e2e fixtures) can still upsert KNOWN keys, and is refused unknown ones', async () => {
    await withTx(async (c) => {
      await svc(c, async () => {
        await c.query(
          `insert into public.platform_settings (key, value) values ('delivery_fee_kobo', '50000'::jsonb)
           on conflict (key) do update set value = excluded.value`,
        )
      })
      const e = await svc(c, () =>
        failure(
          c,
          `insert into public.platform_settings (key, value) values ('sneaky_flag', 'true'::jsonb)`,
        ),
      )
      expect(e.message).toMatch(/unknown_setting/)
    })
  })

  it('locked keys cannot be changed through the function', async () => {
    await withTx(async (c) => {
      const admin = AAL2(await staff(c, 'platform_admin'))
      expect((await callFails(c, admin, ...set('mock_payments_enabled', true))).message).toMatch(
        /direct database access/,
      )
      expect(
        (await callFails(c, admin, ...set('rider_terms_current_version', 'v9'))).message,
      ).toMatch(/direct database access/)
      expect(
        (await callFails(c, admin, ...set('settlement_policy', 'PROVIDER_SPLIT_IMMEDIATE')))
          .message,
      ).toMatch(/locked to DISABLED/)
    })
  })

  it('wrong types, malformed values and out-of-range values are rejected and change nothing', async () => {
    await withTx(async (c) => {
      const admin = AAL2(await staff(c, 'platform_admin'))
      const cases: [string, unknown, RegExp][] = [
        ['vendor_commission_bps', '500', /invalid value/],
        ['vendor_commission_bps', 5.5, /invalid value/],
        ['vendor_commission_bps', -1, /invalid value/],
        ['vendor_commission_bps', null, /invalid value/],
        ['vendor_commission_bps', 2001, /out of range/],
        ['vendor_commission_bps', { a: 1 }, /invalid value/],
        ['delivery_fee_kobo', 1000001, /out of range/],
        ['refund_support_approval_limit_kobo', 100000001, /out of range/],
        ['typed_signature_enabled', 'yes', /invalid value/],
        ['typed_signature_enabled', 1, /invalid value/],
        ['refund_fee_policy', 'everything', /invalid value/],
        ['refund_fee_policy', 5, /invalid value/],
        ['return_policy', 'case_by_case', /invalid value/],
        ['return_policy', { default: 'maybe' }, /invalid value/],
        ['return_policy', { default: 'returnable', extra: 1 }, /invalid value/],
        [
          'return_policy',
          { default: 'returnable', categories: { food: 'always' } },
          /invalid value/,
        ],
      ]
      for (const [k, v, re] of cases) {
        const before = await read(c, k)
        const e = await callFails(c, admin, ...set(k, v))
        expect(e.code, `${k}=${JSON.stringify(v)}`).toBe('22023')
        expect(e.message, `${k}=${JSON.stringify(v)}`).toMatch(re)
        expect(await read(c, k)).toEqual(before)
      }
      expect(await auditCount(c, 'vendor_commission_bps')).toBe(0)
    })
  })

  it('a reason is required: missing, null, empty, blank, too short and too long are all refused', async () => {
    await withTx(async (c) => {
      const admin = AAL2(await staff(c, 'platform_admin'))
      const before = await read(c, 'vendor_commission_bps')
      for (const r of [null, '', '   ', 'short', '          \n\t  ', 'x'.repeat(501)]) {
        const e = await callFails(c, admin, ...set('vendor_commission_bps', 700, r))
        expect(e.message, JSON.stringify(r)?.slice(0, 20)).toMatch(/setting_reason_required/)
      }
      expect(await read(c, 'vendor_commission_bps')).toEqual(before)
      expect(await auditCount(c, 'vendor_commission_bps')).toBe(0)
    })
  })

  it('a valid change by an administrator succeeds and the audit record holds actor, old and new value and the reason', async () => {
    await withTx(async (c) => {
      const adminId = await staff(c, 'platform_admin')
      const before = await read(c, 'vendor_commission_bps')
      await callJson(
        c,
        AAL2(adminId),
        ...set(
          'vendor_commission_bps',
          750,
          '  Raising the placeholder fee\u0007 for the rehearsal  ',
        ),
      )
      expect(await read(c, 'vendor_commission_bps')).toBe(750)
      const a = (
        await c.query(
          `select actor_id, entity_type, details from public.audit_events where action='setting.changed' and entity_id='vendor_commission_bps'`,
        )
      ).rows
      expect(a).toHaveLength(1)
      expect(a[0].actor_id).toBe(adminId)
      expect(a[0].entity_type).toBe('platform_setting')
      expect(a[0].details).toEqual({
        old: before,
        new: 750,
        reason: 'Raising the placeholder fee  for the rehearsal', // control character becomes a space; ends trimmed
        outcome: 'applied',
      })
      // records can not be altered afterwards
      const e = await failure(
        c,
        `update public.audit_events set details = '{}'::jsonb where entity_id='vendor_commission_bps'`,
      )
      expect(e.message).toBeTruthy()
    })
  })

  it('the other value kinds work when valid (boolean, enum, return policy)', async () => {
    await withTx(async (c) => {
      const admin = AAL2(await staff(c, 'platform_admin'))
      await callJson(c, admin, ...set('typed_signature_enabled', false))
      await callJson(c, admin, ...set('refund_fee_policy', 'proportional_service_fee'))
      await callJson(
        c,
        admin,
        ...set('return_policy', {
          default: 'case_by_case',
          categories: { food: 'not_returnable' },
        }),
      )
      expect(await read(c, 'refund_fee_policy')).toBe('proportional_service_fee')
      expect((await read(c, 'return_policy')).categories.food).toBe('not_returnable')
      expect(await auditCount(c, 'return_policy')).toBe(1)
    })
  })

  it('no two-argument or reason-less path exists, and the function is not executable by anon', async () => {
    await withTx(async (c) => {
      const fns = (
        await c.query(
          `select pg_get_function_identity_arguments(p.oid) a, has_function_privilege('anon', p.oid, 'execute') anon,
                  has_function_privilege('public', p.oid, 'execute') pub
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'set_platform_setting'`,
        )
      ).rows
      expect(fns).toHaveLength(1)
      expect(fns[0].a).toBe('p_key text, p_value jsonb, p_reason text')
      expect(fns[0].anon).toBe(false)
      expect(fns[0].pub).toBe(false)
      const admin = AAL2(await staff(c, 'platform_admin'))
      const e = await callFails(
        c,
        admin,
        `select public.set_platform_setting('vendor_commission_bps', '700'::jsonb) r`,
      )
      expect(e.message).toMatch(/does not exist/)
    })
  })

  it('a refused change leaves no partial update and no success audit record', async () => {
    await withTx(async (c) => {
      const admin = AAL2(await staff(c, 'platform_admin'))
      await callFails(c, admin, ...set('vendor_commission_bps', 99999))
      await callFails(c, admin, ...set('vendor_commission_bps', 700, 'no'))
      expect(await auditCount(c, 'vendor_commission_bps')).toBe(0)
    })
    await withTx(async (c) => {
      // an ordinary customer with a forged admin claim is no administrator
      const u = await createUser(c, 'forger')
      await giveRole(c, u, 'customer')
      const e = await as(c, AAL2(u), () => failure(c, ...set('vendor_commission_bps', 700)))
      expect(e.code).toBe(PRIV_DENIED)
    })
  })
})
