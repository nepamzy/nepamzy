import { afterAll, describe, expect, it } from 'vitest'
import {
  AAL1,
  AAL2,
  as,
  createUser,
  failure,
  giveRole,
  pool,
  withTx,
  PRIV_DENIED,
  svc,
} from './helpers'

afterAll(async () => {
  await pool.end()
})

describe('two-step sign-in is optional except for staff', () => {
  it('a customer or vendor with no authenticator works at aal1; with one, they must complete it; staff always must', async () => {
    await withTx(async (c) => {
      const plain = await createUser(c, 'plain', { mfa: false })
      const enrolled = await createUser(c, 'enrolled')
      const vendor = await createUser(c, 'vendor', { mfa: false })
      await giveRole(c, vendor, 'vendor_owner')
      const admin = await createUser(c, 'admin', { mfa: false })
      await giveRole(c, admin, 'platform_admin')
      // get_notification_preferences needs the second step to be satisfied (is_aal2) and nothing else
      const ok = async (who: ReturnType<typeof AAL1>) => {
        try {
          await c.query('savepoint s')
          await as(c, who, () => c.query('select public.get_notification_preferences()'))
          await c.query('release savepoint s')
          return true
        } catch {
          await c.query('rollback to savepoint s')
          return false
        }
      }
      expect(await ok(AAL1(plain))).toBe(true)
      expect(await ok(AAL1(vendor))).toBe(true)
      expect(await ok(AAL1(enrolled))).toBe(false)
      expect(await ok(AAL2(enrolled))).toBe(true)
      expect(await ok(AAL1(admin))).toBe(false)
      expect(await ok(AAL2(admin))).toBe(true)
      expect(await ok(null)).toBe(false)
      // a function that needs the second step follows the same rule
      const prefs = await as(
        c,
        AAL1(plain),
        async () => (await c.query(`select public.get_notification_preferences() r`)).rows[0].r,
      )
      expect(prefs.email_enabled).toBe(false)
      expect(
        (
          await as(c, AAL1(enrolled), () =>
            failure(c, `select public.get_notification_preferences()`),
          )
        ).code,
      ).toBe(PRIV_DENIED)
    })
  })
})

describe('password reset codes', () => {
  it('are service-only, single use, expire, and lock after five wrong tries', async () => {
    await withTx(async (c) => {
      const u = await createUser(c, 'reset', { mfa: false })
      const hash = 'a'.repeat(64)
      for (const sql of [
        `select public.password_reset_issue('${u}', '${hash}')`,
        `select public.password_reset_check('${u}', '${hash}')`,
        `select public.auth_user_id_by_email('x@example.test')`,
        `select * from public.password_reset_codes`,
      ]) {
        expect((await as(c, AAL2(u), () => failure(c, sql))).code).toBe(PRIV_DENIED)
        expect((await as(c, null, () => failure(c, sql))).code).toBe(PRIV_DENIED)
      }
      const q = async (sql: string, p: unknown[] = []) =>
        svc(c, async () => (await c.query(sql, p)).rows[0].r as string)
      expect(await q(`select public.password_reset_check($1, $2) r`, [u, hash])).toBe('invalid') // none yet
      await svc(c, () => c.query(`select public.password_reset_issue($1, $2)`, [u, hash]))
      expect(await q(`select public.password_reset_check($1, $2) r`, [u, 'b'.repeat(64)])).toBe(
        'invalid',
      )
      expect(await q(`select public.password_reset_check($1, $2) r`, [u, hash])).toBe('ok')
      expect(await q(`select public.password_reset_check($1, $2) r`, [u, hash])).toBe('invalid') // single use
      // lock after five wrong
      await svc(c, () => c.query(`select public.password_reset_issue($1, $2)`, [u, hash]))
      for (let i = 0; i < 5; i++)
        expect(await q(`select public.password_reset_check($1, $2) r`, [u, 'c'.repeat(64)])).toBe(
          'invalid',
        )
      expect(await q(`select public.password_reset_check($1, $2) r`, [u, hash])).toBe('locked')
      // asking again replaces the code and resets the counter
      await svc(c, () => c.query(`select public.password_reset_issue($1, $2)`, [u, hash]))
      expect(await q(`select public.password_reset_check($1, $2) r`, [u, hash])).toBe('ok')
      // expiry
      await svc(c, () => c.query(`select public.password_reset_issue($1, $2)`, [u, hash]))
      await c.query(
        `update public.password_reset_codes set expires_at = now() - interval '1 minute' where user_id = $1`,
        [u],
      )
      expect(await q(`select public.password_reset_check($1, $2) r`, [u, hash])).toBe('invalid')
    })
  })
  it('finds an account by e-mail, ignoring case', async () => {
    await withTx(async (c) => {
      const u = await createUser(c, 'Lookup', { mfa: false })
      const email = (await c.query('select email from auth.users where id = $1', [u])).rows[0]
        .email as string
      const r = await svc(
        c,
        async () =>
          (await c.query(`select public.auth_user_id_by_email($1) r`, [email.toUpperCase()]))
            .rows[0].r,
      )
      expect(r).toBe(u)
    })
  })
})
