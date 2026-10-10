import { afterAll, describe, expect, it } from 'vitest'
import { pool } from './helpers'

afterAll(async () => {
  await pool.end()
})

describe('schema hygiene (asserted from the catalog)', () => {
  it('every SECURITY DEFINER function pins search_path', async () => {
    const r = await pool.query(`
      select n.nspname || '.' || p.proname as fn, p.proconfig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where p.prosecdef and n.nspname in ('public','app_private')`)
    expect(r.rowCount).toBeGreaterThan(8)
    for (const row of r.rows) {
      const cfg: string[] = row.proconfig ?? []
      expect(
        cfg.some((s) => s.startsWith('search_path=')),
        `search_path on ${row.fn}`,
      ).toBe(true)
    }
  })
  it('no function in public/app_private is executable by PUBLIC or anon', async () => {
    const r = await pool.query(`
      select n.nspname || '.' || p.proname as fn,
             has_function_privilege('anon', p.oid, 'execute') as anon_exec,
             (select bool_or(a.grantee = 0) from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                where a.privilege_type = 'EXECUTE') as public_exec
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public','app_private')`)
    for (const row of r.rows) {
      expect(row.anon_exec, `anon can execute ${row.fn}`).toBe(false)
      expect(row.public_exec, `PUBLIC can execute ${row.fn}`).not.toBe(true)
    }
  })
  it('service-role-only and internal functions are not executable by authenticated', async () => {
    for (const fn of [
      'public.rate_limit_hit(text,integer,integer)',
      'public.record_security_event(uuid,text,jsonb)',
      'app_private.audit_write(uuid,text,text,text,jsonb)',
      'app_private.handle_new_user()',
    ]) {
      const r = await pool.query(
        `select has_function_privilege('authenticated', $1::regprocedure, 'execute') as x`,
        [fn],
      )
      expect(r.rows[0].x, fn).toBe(false)
    }
  })
  it('RLS is enabled on every table in public and app_private', async () => {
    const r = await pool.query(`
      select n.nspname || '.' || c.relname as t, c.relrowsecurity as rls
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind = 'r' and n.nspname in ('public','app_private')`)
    expect(r.rowCount).toBeGreaterThan(8)
    for (const row of r.rows) expect(row.rls, row.t).toBe(true)
  })
  it('every public table exposed to authenticated has a RESTRICTIVE MFA/aal2 policy', async () => {
    const r = await pool.query(`
      select c.relname,
        exists (select 1 from pg_policy p where p.polrelid = c.oid and not p.polpermissive) as has_restrictive
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind = 'r' and n.nspname = 'public' and
        has_table_privilege('authenticated', c.oid, 'select')`)
    expect(r.rowCount).toBeGreaterThan(5)
    for (const row of r.rows) expect(row.has_restrictive, row.relname).toBe(true)
  })
  it('authenticated has no INSERT/DELETE on public tables and UPDATE only on profiles.display_name', async () => {
    const t = await pool.query(`
      select table_name, privilege_type from information_schema.role_table_grants
      where grantee = 'authenticated' and table_schema = 'public'
        and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')`)
    expect(t.rows).toEqual([])
    const c = await pool.query(`
      select table_name, column_name from information_schema.column_privileges
      where grantee = 'authenticated' and table_schema = 'public' and privilege_type in ('UPDATE','INSERT')`)
    expect(c.rows).toEqual([{ table_name: 'profiles', column_name: 'display_name' }])
  })
  it('anon has no table privileges at all', async () => {
    const r = await pool.query(`
      select table_schema, table_name from information_schema.role_table_grants
      where grantee = 'anon' and table_schema in ('public','app_private')`)
    expect(r.rows).toEqual([])
  })
})
