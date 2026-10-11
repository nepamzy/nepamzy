import { afterAll, describe, expect, it } from 'vitest'
import { PRIV_DENIED, as, createUser, failure, giveRole, pool, withTx } from './helpers'

afterAll(async () => {
  await pool.end()
})

describe('identity bootstrap', () => {
  it('creates profile, customer role and audit event for a new user', async () => {
    await withTx(async (c) => {
      const u = await createUser(c)
      expect((await c.query('select 1 from public.profiles where id=$1', [u])).rowCount).toBe(1)
      const roles = await c.query(
        `select role from public.role_assignments where user_id=$1 and status='active'`,
        [u],
      )
      expect(roles.rows.map((r) => r.role)).toEqual(['customer'])
      const a = await c.query(
        `select 1 from public.audit_events where actor_id=$1 and action='account.created'`,
        [u],
      )
      expect(a.rowCount).toBe(1)
    })
  })
})

describe('my_roles()', () => {
  it('returns only the caller’s own active roles, works at aal1, and is closed to anon', async () => {
    await withTx(async (c) => {
      const a = await createUser(c)
      const b = await createUser(c)
      await giveRole(c, a, 'rider')
      await giveRole(c, b, 'platform_admin')
      const mine = await as(
        c,
        { id: a, aal: 'aal1' },
        async () => (await c.query('select public.my_roles()::text[] as r')).rows[0].r,
      )
      expect([...mine].sort()).toEqual(['customer', 'rider'])
      await c.query(
        `update public.role_assignments set status='revoked', revoked_at=now() where user_id=$1 and role='rider'`,
        [a],
      )
      const after = await as(
        c,
        { id: a, aal: 'aal1' },
        async () => (await c.query('select public.my_roles()::text[] as r')).rows[0].r,
      )
      expect(after).toEqual(['customer'])
      const e = await as(c, null, () => failure(c, 'select public.my_roles()'))
      expect(e.code).toBe(PRIV_DENIED)
    })
  })
})

describe('profiles RLS', () => {
  it('customer reads own profile but not another customer’s (aal1 and aal2)', async () => {
    await withTx(async (c) => {
      const a = await createUser(c)
      const b = await createUser(c)
      for (const aal of ['aal1', 'aal2'] as const) {
        const rows = await as(
          c,
          { id: a, aal },
          async () => (await c.query('select id from public.profiles')).rows,
        )
        expect(rows.map((r) => r.id)).toEqual([a])
        expect(rows.map((r) => r.id)).not.toContain(b)
      }
    })
  })
  it('profile edit is a protected feature: aal1 update affects 0 rows, aal2 succeeds, others untouchable', async () => {
    await withTx(async (c) => {
      const a = await createUser(c)
      const b = await createUser(c)
      const aal1 = await as(c, { id: a, aal: 'aal1' }, () =>
        c.query(`update public.profiles set display_name='x' where id=$1`, [a]),
      )
      expect(aal1.rowCount).toBe(0)
      const aal2 = await as(c, { id: a, aal: 'aal2' }, () =>
        c.query(`update public.profiles set display_name='Ada' where id=$1`, [a]),
      )
      expect(aal2.rowCount).toBe(1)
      const other = await as(c, { id: a, aal: 'aal2' }, () =>
        c.query(`update public.profiles set display_name='hax' where id=$1`, [b]),
      )
      expect(other.rowCount).toBe(0)
      const err = await as(c, { id: a, aal: 'aal2' }, () =>
        failure(c, `update public.profiles set id=gen_random_uuid() where id=$1`, [a]),
      )
      expect(err.code).toBe(PRIV_DENIED) // no column grant on id
    })
  })
  it('a privileged user (vendor) at aal1 cannot read even their own profile', async () => {
    await withTx(async (c) => {
      const v = await createUser(c)
      await giveRole(c, v, 'vendor_owner')
      const rows = await as(
        c,
        { id: v, aal: 'aal1' },
        async () => (await c.query('select id from public.profiles')).rows,
      )
      expect(rows).toHaveLength(0)
      const ok = await as(
        c,
        { id: v, aal: 'aal2' },
        async () => (await c.query('select id from public.profiles')).rows,
      )
      expect(ok).toHaveLength(1)
    })
  })
})

describe('roles cannot be self-assigned or written directly', () => {
  it('authenticated users cannot insert/update/delete role_assignments', async () => {
    await withTx(async (c) => {
      const u = await createUser(c)
      for (const aal of ['aal1', 'aal2'] as const) {
        const e1 = await as(c, { id: u, aal }, () =>
          failure(
            c,
            `insert into public.role_assignments (user_id, role) values ($1,'platform_admin')`,
            [u],
          ),
        )
        expect(e1.code).toBe(PRIV_DENIED)
        const e2 = await as(c, { id: u, aal }, () =>
          failure(c, `update public.role_assignments set role='platform_admin' where user_id=$1`, [
            u,
          ]),
        )
        expect(e2.code).toBe(PRIV_DENIED)
        const e3 = await as(c, { id: u, aal }, () =>
          failure(c, `delete from public.role_assignments where user_id=$1`, [u]),
        )
        expect(e3.code).toBe(PRIV_DENIED)
      }
    })
  })
  it('anon cannot call grant_role', async () => {
    await withTx(async (c) => {
      const u = await createUser(c)
      const e = await as(c, null, () => failure(c, `select public.grant_role($1,'rider')`, [u]))
      expect(e.code).toBe(PRIV_DENIED)
    })
  })
})

describe('grant_role / revoke_role', () => {
  it('denied: non-admin; admin at aal1; self-grant. allowed: admin at aal2 (audited)', async () => {
    await withTx(async (c) => {
      const target = await createUser(c)
      const cust = await createUser(c)
      const admin = await createUser(c)
      await giveRole(c, admin, 'platform_admin')
      const nonAdmin = await as(c, { id: cust, aal: 'aal2' }, () =>
        failure(c, `select public.grant_role($1,'rider')`, [target]),
      )
      expect(nonAdmin.message).toMatch(/forbidden/)
      const aal1 = await as(c, { id: admin, aal: 'aal1' }, () =>
        failure(c, `select public.grant_role($1,'rider')`, [target]),
      )
      expect(aal1.message).toMatch(/aal2/)
      const self = await as(c, { id: admin, aal: 'aal2' }, () =>
        failure(c, `select public.grant_role($1,'finance_admin')`, [admin]),
      )
      expect(self.message).toMatch(/your own roles/)
      await as(c, { id: admin, aal: 'aal2' }, () =>
        c.query(`select public.grant_role($1,'rider')`, [target]),
      )
      const r = await c.query(
        `select 1 from public.role_assignments where user_id=$1 and role='rider' and status='active' and granted_by=$2`,
        [target, admin],
      )
      expect(r.rowCount).toBe(1)
      const a = await c.query(
        `select 1 from public.audit_events where actor_id=$1 and action='role.granted'`,
        [admin],
      )
      expect(a.rowCount).toBe(1)
      await as(c, { id: admin, aal: 'aal2' }, () =>
        c.query(`select public.revoke_role($1,'rider')`, [target]),
      )
      const gone = await c.query(
        `select 1 from public.role_assignments where user_id=$1 and role='rider' and status='active'`,
        [target],
      )
      expect(gone.rowCount).toBe(0)
      expect(
        (
          await c.query(
            `select 1 from public.audit_events where actor_id=$1 and action='role.revoked'`,
            [admin],
          )
        ).rowCount,
      ).toBe(1)
    })
  })
  it('revoke_role: non-admin and aal1 admin denied', async () => {
    await withTx(async (c) => {
      const t = await createUser(c)
      const admin = await createUser(c)
      const cust = await createUser(c)
      await giveRole(c, admin, 'platform_admin')
      await giveRole(c, t, 'rider')
      const e1 = await as(c, { id: cust, aal: 'aal2' }, () =>
        failure(c, `select public.revoke_role($1,'rider')`, [t]),
      )
      expect(e1.message).toMatch(/forbidden/)
      const e2 = await as(c, { id: admin, aal: 'aal1' }, () =>
        failure(c, `select public.revoke_role($1,'rider')`, [t]),
      )
      expect(e2.message).toMatch(/aal2/)
    })
  })
})

describe('audit_events are append-only', () => {
  it('update/delete/truncate are rejected for everyone, including the table owner', async () => {
    await withTx(async (c) => {
      const u = await createUser(c)
      for (const sql of [
        `update public.audit_events set action='tampered' where actor_id='${u}'`,
        `delete from public.audit_events where actor_id='${u}'`,
        `truncate public.audit_events`,
      ]) {
        const e = await failure(c, sql)
        expect(e.message).toMatch(/append-only/)
      }
    })
  })
  it('API roles have no write privileges on audit_events', async () => {
    await withTx(async (c) => {
      const u = await createUser(c)
      const admin = await createUser(c)
      await giveRole(c, admin, 'platform_admin')
      for (const who of [
        null,
        { id: u, aal: 'aal2' as const },
        { id: admin, aal: 'aal2' as const },
      ]) {
        const e = await as(c, who, () =>
          failure(c, `insert into public.audit_events (action) values ('forged.event')`),
        )
        expect(e.code).toBe(PRIV_DENIED)
        const e2 = await as(c, who, () => failure(c, `delete from public.audit_events`))
        expect(e2.code).toBe(PRIV_DENIED)
      }
    })
  })
  it('only platform_admin/support_agent at aal2 can read the audit trail', async () => {
    await withTx(async (c) => {
      const cust = await createUser(c)
      const sup = await createUser(c)
      await giveRole(c, sup, 'support_agent')
      expect(
        await as(
          c,
          { id: cust, aal: 'aal2' },
          async () => (await c.query('select 1 from public.audit_events')).rowCount,
        ),
      ).toBe(0)
      expect(
        await as(
          c,
          { id: sup, aal: 'aal1' },
          async () => (await c.query('select 1 from public.audit_events')).rowCount,
        ),
      ).toBe(0)
      expect(
        await as(
          c,
          { id: sup, aal: 'aal2' },
          async () => (await c.query('select 1 from public.audit_events')).rowCount,
        ),
      ).toBeGreaterThan(0)
    })
  })
})

describe('anonymous access', () => {
  it('anon has no privileges on any table in public', async () => {
    await withTx(async (c) => {
      const tables = (
        await c.query(`select tablename from pg_tables where schemaname='public'`)
      ).rows.map((r) => r.tablename)
      expect(tables.length).toBeGreaterThan(5)
      for (const t of tables) {
        const e = await as(c, null, () => failure(c, `select * from public.${t}`))
        expect(e.code, `anon select on ${t}`).toBe(PRIV_DENIED)
      }
    })
  })
})

describe('vendor / rider isolation', () => {
  it('vendor-A member cannot see vendor-B; aal1 sees nothing', async () => {
    await withTx(async (c) => {
      const ua = await createUser(c)
      const ub = await createUser(c)
      await giveRole(c, ua, 'vendor_owner')
      await giveRole(c, ub, 'vendor_owner')
      const va = (
        await c.query(
          `insert into public.vendors (name, slug) values ('A', 'va-' || gen_random_uuid()) returning id`,
        )
      ).rows[0].id
      const vb = (
        await c.query(
          `insert into public.vendors (name, slug) values ('B', 'vb-' || gen_random_uuid()) returning id`,
        )
      ).rows[0].id
      await c.query('insert into public.vendor_staff values ($1,$2),($3,$4)', [va, ua, vb, ub])
      const seen = await as(c, { id: ua, aal: 'aal2' }, async () =>
        (await c.query('select id from public.vendors')).rows.map((r) => r.id),
      )
      expect(seen).toEqual([va])
      const staff = await as(c, { id: ua, aal: 'aal2' }, async () =>
        (await c.query('select vendor_id from public.vendor_staff')).rows.map((r) => r.vendor_id),
      )
      expect(staff).toEqual([va])
      expect(
        await as(
          c,
          { id: ua, aal: 'aal1' },
          async () => (await c.query('select id from public.vendors')).rowCount,
        ),
      ).toBe(0)
      const w = await as(c, { id: ua, aal: 'aal2' }, () =>
        failure(c, `update public.vendors set name='x' where id=$1`, [vb]),
      )
      expect(w.code).toBe(PRIV_DENIED)
    })
  })
  it('rider cannot read other riders’ rows; admin at aal2 can', async () => {
    await withTx(async (c) => {
      const r1 = await createUser(c)
      const r2 = await createUser(c)
      const admin = await createUser(c)
      await giveRole(c, r1, 'rider')
      await giveRole(c, r2, 'rider')
      await giveRole(c, admin, 'platform_admin')
      // rows left behind by browser runs would change the admin's count; clear them inside this (rolled back) transaction
      await c.query('set local session_replication_role = replica')
      await c.query('delete from public.rider_profiles')
      await c.query('set local session_replication_role = origin')
      await c.query(
        "insert into public.rider_profiles (user_id, full_name, contact_phone) values ($1,'R One','08000000001'),($2,'R Two','08000000002')",
        [r1, r2],
      )
      expect(
        await as(c, { id: r1, aal: 'aal2' }, async () =>
          (await c.query('select user_id from public.rider_profiles')).rows.map((r) => r.user_id),
        ),
      ).toEqual([r1])
      expect(
        await as(
          c,
          { id: r1, aal: 'aal1' },
          async () => (await c.query('select user_id from public.rider_profiles')).rowCount,
        ),
      ).toBe(0)
      expect(
        await as(
          c,
          { id: admin, aal: 'aal2' },
          async () => (await c.query('select user_id from public.rider_profiles')).rowCount,
        ),
      ).toBe(2)
      expect(
        await as(
          c,
          { id: admin, aal: 'aal1' },
          async () => (await c.query('select user_id from public.rider_profiles')).rowCount,
        ),
      ).toBe(0)
    })
  })
})

describe('platform settings', () => {
  it('settlement_policy is locked to DISABLED; other settings are admin+aal2 and audited', async () => {
    await withTx(async (c) => {
      const admin = await createUser(c)
      await giveRole(c, admin, 'platform_admin')
      const cust = await createUser(c)
      const e1 = await as(c, { id: admin, aal: 'aal2' }, () =>
        failure(
          c,
          `select public.set_platform_setting('settlement_policy','"PROVIDER_SPLIT_IMMEDIATE"')`,
        ),
      )
      expect(e1.message).toMatch(/locked to DISABLED/)
      const e2 = await as(c, { id: cust, aal: 'aal2' }, () =>
        failure(c, `select public.set_platform_setting('support_email','"x@example.test"')`),
      )
      expect(e2.message).toMatch(/forbidden/)
      const e3 = await as(c, { id: admin, aal: 'aal1' }, () =>
        failure(c, `select public.set_platform_setting('support_email','"x@example.test"')`),
      )
      expect(e3.message).toMatch(/aal2/)
      await as(c, { id: admin, aal: 'aal2' }, () =>
        c.query(`select public.set_platform_setting('support_email','"x@example.test"')`),
      )
      expect(
        (
          await c.query(
            `select 1 from public.audit_events where action='setting.changed' and entity_id='support_email'`,
          )
        ).rowCount,
      ).toBe(1)
      const seeded = await c.query(
        `select value from public.platform_settings where key='settlement_policy'`,
      )
      expect(seeded.rows[0].value).toBe('DISABLED')
    })
  })
})

describe('service-role-only functions', () => {
  it('rate_limit_hit: authenticated/anon denied; service_role limits per key', async () => {
    await withTx(async (c) => {
      const u = await createUser(c)
      const e = await as(c, { id: u, aal: 'aal2' }, () =>
        failure(c, `select public.rate_limit_hit('k',60,2)`),
      )
      expect(e.code).toBe(PRIV_DENIED)
      const e2 = await as(c, null, () => failure(c, `select public.rate_limit_hit('k',60,2)`))
      expect(e2.code).toBe(PRIV_DENIED)
      await c.query('set local role service_role')
      const res: boolean[] = []
      for (let i = 0; i < 4; i++)
        res.push((await c.query(`select public.rate_limit_hit('test-key',60,2) as ok`)).rows[0].ok)
      await c.query('reset role')
      expect(res).toEqual([true, true, false, false])
    })
  })
  it('record_security_event: only service_role; action whitelist enforced', async () => {
    await withTx(async (c) => {
      const u = await createUser(c)
      const e = await as(c, { id: u, aal: 'aal2' }, () =>
        failure(c, `select public.record_security_event($1,'mfa.failed','{}')`, [u]),
      )
      expect(e.code).toBe(PRIV_DENIED)
      await c.query('set local role service_role')
      await c.query(`select public.record_security_event($1,'mfa.failed','{"n":1}')`, [u])
      const bad = await failure(c, `select public.record_security_event($1,'role.granted','{}')`, [
        u,
      ])
      await c.query('reset role')
      expect(bad.message).toMatch(/unsupported/)
      expect(
        (
          await c.query(
            `select 1 from public.audit_events where actor_id=$1 and action='mfa.failed'`,
            [u],
          )
        ).rowCount,
      ).toBe(1)
    })
  })
})
