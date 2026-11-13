import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createDb } from '../src';
import { adminDb } from './fixtures';

const db = createDb();
const admin = adminDb();
afterAll(() => Promise.all([db.end(), admin.end()]));

describe('schema', () => {
  it('has every table with RLS on and no policies except junction_app\'s own', async () => {
    const rows = await db`select tablename, rowsecurity from pg_tables where schemaname = 'public' order by tablename`;
    expect(rows.map(r => r.tablename)).toEqual(['areas','context_entries','invites','memberships','notifications','projects','task_events','task_questions','task_requesters','tasks','users','work_items','work_updates','worker_credentials']);
    expect(rows.every(r => r.rowsecurity)).toBe(true);
    const policies = await db`select tablename, roles::text as roles from pg_policies where schemaname = 'public' order by tablename`;
    expect(policies.every(p => p.roles === '{junction_app}')).toBe(true);
    expect(policies.map(p => p.tablename)).toEqual(rows.map(r => r.tablename));
  });

  it('keeps every junction_auth function away from public, anon and authenticated', async () => {
    const fns = await db`select p.oid::regprocedure::text as fn, p.proacl is null as default_acl,
        exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0) as public_grant,
        has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
        has_schema_privilege('anon', 'junction_auth', 'usage') as anon_schema, has_schema_privilege('authenticated', 'junction_auth', 'usage') as authenticated_schema
      from pg_proc p where p.pronamespace = 'junction_auth'::regnamespace`;
    expect(fns.length).toBeGreaterThan(0);
    for (const f of fns) {
      expect(f, f.fn).toMatchObject({ defaultAcl: false, publicGrant: false, anon: false, authenticated: false, anonSchema: false, authenticatedSchema: false });
    }
  });

  it('pins search_path on every junction_auth function to pg_catalog, pg_temp', async () => {
    const fns = await db`select proname, proconfig from pg_proc where pronamespace = 'junction_auth'::regnamespace`;
    expect(fns.length).toBeGreaterThan(0);
    for (const f of fns) expect(f.proconfig, f.proname).toEqual(['search_path=pg_catalog, pg_temp']);
  });

  // An empty search_path still searches pg_temp first, so junction_app could plant a type and casts there and run SQL as
  // postgres. Needs a session row so the cast is evaluated. admin does the setup, then drops to junction_app.
  it('cannot be hijacked through pg_temp types and casts', async () => {
    const authUserId = randomUUID();
    const sid = randomUUID();
    let result: boolean | undefined;
    await expect(admin.begin(async sql => {
      await sql`insert into auth.users (id, email) values (${authUserId}, ${authUserId + '@example.com'})`;
      await sql`insert into auth.sessions (id, user_id) values (${sid}, ${authUserId})`;
      await sql.unsafe('grant junction_app to postgres');
      await sql.unsafe('set local role junction_app');
      await sql.unsafe('create temp table warmup (v int)'); // the probe makes pg_temp exist before the planted text table
      await sql.unsafe('create temp table text (v pg_catalog.text)');
      await sql.unsafe(`create function pg_temp.evil(u pg_catalog.uuid) returns pg_temp.text language plpgsql as $f$
        begin raise exception 'HIJACK: running as %', pg_catalog.current_user(); end $f$`);
      await sql.unsafe('create function pg_temp.back(t pg_temp.text) returns pg_catalog.text language sql as $f$ select t.v $f$');
      await sql.unsafe('create cast (pg_catalog.uuid as pg_temp.text) with function pg_temp.evil(pg_catalog.uuid)');
      await sql.unsafe('create cast (pg_temp.text as pg_catalog.text) with function pg_temp.back(pg_temp.text) as implicit');
      [{ result }] = await sql.unsafe(`select junction_auth.is_human_session('${sid}') as result`); // sid is a uuid we made
      throw new Error('rollback');
    })).rejects.toThrow('rollback');
    expect(result).toBe(true);
  });

  it.each(['anon', 'authenticated'])('refuses to run a junction_auth function as %s', async role => {
    // admin: junction_app can't switch roles
    await expect(admin.begin(async sql => {
      await sql.unsafe(`set local role ${role}`);
      await sql`select junction_auth.is_human_session('x')`;
    })).rejects.toThrow(/permission denied/);
  });

  it('rejects an unknown task status', async () => {
    await expect(db.begin(async sql => {
      const [u] = await sql`insert into users (name, email) values ('t', 't@example.com') returning id`;
      const [p] = await sql`insert into projects (slug, name) values ('t', 't') returning id`;
      await sql`insert into tasks (project_id, requester_id, assignee_id, title, description, blocking_reason, status)
                values (${p.id}, ${u.id}, ${u.id}, 't', 'd', 'b', 'bogus')`;
    })).rejects.toThrow(/check constraint|tasks_status/);
  });

  it('rejects a second replacement of the same decision', async () => {
    await expect(db.begin(async sql => {
      const [u] = await sql`insert into users (name, email) values ('replace', 'replace@example.com') returning id`;
      const [p] = await sql`insert into projects (slug, name) values ('replace', 'replace') returning id`;
      const [d] = await sql`insert into context_entries (project_id, author_id, kind, title)
                            values (${p.id}, ${u.id}, 'decision', 'd') returning id`;
      await sql`insert into context_entries (project_id, author_id, kind, title, replaces_id)
                values (${p.id}, ${u.id}, 'decision', 'd2', ${d.id})`;
      await sql`insert into context_entries (project_id, author_id, kind, title, replaces_id)
                values (${p.id}, ${u.id}, 'decision', 'd3', ${d.id})`;
    })).rejects.toThrow(/unique|context_entries_replaces/);
  });
});
