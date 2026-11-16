import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import {
  JunctionError, acceptInvite, approveTask, assertMember, cancelInvite, createDb, createInvite, createProject, deleteProject, hasLink, inviteByToken, listConnections, listInvites, listMembers,
  removeMember, roleOf, renameProject, sendTask, setRole, setupState, userByWorkerToken,
} from '../src';
import { adminDb, agent, human, makeProject } from './fixtures';

const db = createDb();
const admin = adminDb();
afterAll(() => Promise.all([db.end(), admin.end()]));

const err = (p: Promise<unknown>) => p.then(() => null, (e: JunctionError) => e);
const code = async (p: Promise<unknown>) => (await err(p))?.code ?? 'ok';

describe('createProject', () => {
  it('slugs the name, adds -2 on collision, makes the creator admin, refuses agents', async () => {
    const p = await makeProject(db);
    const name = `Big Site! ${p.project.slug}`;
    const a = await createProject(db, human(p.jaxon), { name });
    const b = await createProject(db, human(p.jaxon), { name });
    expect(a.slug).toBe(`big-site-${p.project.slug}`.slice(0, 40).replace(/-$/, ''));
    expect(b.slug).toBe(`${a.slug}-2`);
    const [m] = await db`select role from memberships where project_id = ${a.id} and user_id = ${p.jaxon.id}`;
    expect(m.role).toBe('admin');
    expect(await code(createProject(db, agent(p.jaxon), { name: 'x' }))).toBe('forbidden');
    for (const bad of [' ', 'x'.repeat(61)]) {
      expect((await err(createProject(db, human(p.jaxon), { name: bad })))?.message).toBe('name must be 1-60 characters');
    }
  });

  it("falls back to 'project' when the name has no letters or digits", async () => {
    const p = await makeProject(db);
    const a = await createProject(db, human(p.jaxon), { name: '!!!' });
    expect(a.slug).toMatch(/^project(-\d+)?$/);
  });
});

describe('invites', () => {
  it('create, look up, accept once, then the link is used', async () => {
    const p = await makeProject(db);
    const outsider = await makeProject(db);
    const inv = await createInvite(db, human(p.jeremy), p.project.id, '  New@Example.com ');
    expect(inv.email).toBe('new@example.com');
    expect(inv.token).toMatch(/^ji_[A-Za-z0-9_-]{43}$/);
    const [row] = await db`select email, token_hash from invites where id = ${inv.id}`;
    expect(row.email).toBe('new@example.com');
    expect(row.tokenHash).not.toContain(inv.token);
    expect(await listInvites(db, human(p.jeremy), p.project.id)).toMatchObject([{ id: inv.id, email: 'new@example.com' }]);
    expect(await inviteByToken(db, inv.token)).toEqual({ projectName: 'Test project', inviterName: 'Jeremy', status: 'open' });
    expect(await inviteByToken(db, 'ji_nope')).toBeNull();

    const r = await acceptInvite(db, human(outsider.scott), inv.token);
    expect(r).toEqual({ projectId: p.project.id, slug: p.project.slug, firstTime: true });
    await assertMember(db, outsider.scott.id, p.project.id);
    expect((await inviteByToken(db, inv.token))?.status).toBe('used');
    expect((await err(acceptInvite(db, human(outsider.jaxon), inv.token)))?.message).toBe('this invite link has already been used');
    expect(await listInvites(db, human(p.jeremy), p.project.id)).toEqual([]);
  });

  it('an existing member accepting changes nothing but marks the invite used', async () => {
    const p = await makeProject(db);
    const inv = await createInvite(db, human(p.jeremy), p.project.id, 'jaxon@example.com');
    expect((await acceptInvite(db, human(p.jaxon), inv.token)).firstTime).toBe(false);
    const [m] = await db`select role from memberships where project_id = ${p.project.id} and user_id = ${p.jaxon.id}`;
    expect(m.role).toBe('member');
    expect((await inviteByToken(db, inv.token))?.status).toBe('used');
  });

  it('rejects an expired invite', async () => {
    const p = await makeProject(db);
    const outsider = await makeProject(db);
    const inv = await createInvite(db, human(p.jeremy), p.project.id, 'a@example.com');
    await db`update invites set expires_at = now() - interval '1 second' where id = ${inv.id}`;
    expect((await inviteByToken(db, inv.token))?.status).toBe('expired');
    expect((await err(acceptInvite(db, human(outsider.scott), inv.token)))?.message).toBe('this invite link has expired');
  });

  it('rejects a cancelled invite', async () => {
    const p = await makeProject(db);
    const outsider = await makeProject(db);
    const inv = await createInvite(db, human(p.jeremy), p.project.id, 'a@example.com');
    await cancelInvite(db, human(p.jeremy), p.project.id, inv.id);
    expect((await inviteByToken(db, inv.token))?.status).toBe('cancelled');
    expect((await err(acceptInvite(db, human(outsider.scott), inv.token)))?.message).toBe('this invite link was cancelled');
    expect(await listInvites(db, human(p.jeremy), p.project.id)).toEqual([]);
  });

  it('validates the email, and refuses agents on accept', async () => {
    const p = await makeProject(db);
    for (const bad of ['nope', 'Spam <a@b.com>', 'a@b.com, c@d.com', 'a@b', 'a b@c.com', `${'x'.repeat(250)}@b.com`]) {
      expect((await err(createInvite(db, human(p.jeremy), p.project.id, bad)))?.message, bad).toBe('enter one email address');
    }
    const inv = await createInvite(db, human(p.jeremy), p.project.id, 'a@example.com');
    expect(await code(acceptInvite(db, agent(p.scott), inv.token))).toBe('forbidden');
  });
});

describe('admin-only actions', () => {
  it('a member gets forbidden and nothing changes', async () => {
    const p = await makeProject(db);
    const k = human(p.jaxon);
    const inv = await createInvite(db, human(p.jeremy), p.project.id, 'a@example.com');
    const forbidden = 'only a project admin can do this';
    for (const call of [
      () => createInvite(db, k, p.project.id, 'b@example.com'),
      () => listInvites(db, k, p.project.id),
      () => cancelInvite(db, k, p.project.id, inv.id),
      () => setRole(db, k, p.project.id, p.jaxon.id, 'admin'),
      () => removeMember(db, k, p.project.id, p.scott.id),
      () => renameProject(db, k, p.project.id, 'Renamed'),
    ]) {
      const e = await err(call());
      expect([e?.code, e?.message]).toEqual(['forbidden', forbidden]);
    }
    const [{ n }] = await db`select count(*)::int as n from invites where project_id = ${p.project.id} and cancelled_at is null`;
    expect(n).toBe(1);
    const [m] = await db`select role from memberships where user_id = ${p.jaxon.id} and project_id = ${p.project.id}`;
    expect(m.role).toBe('member');
    await assertMember(db, p.scott.id, p.project.id);
    const [proj] = await db`select name from projects where id = ${p.project.id}`;
    expect(proj.name).toBe('Test project');
  });

  it('renameProject keeps the slug and validates the name', async () => {
    const p = await makeProject(db);
    await renameProject(db, human(p.jeremy), p.project.id, '  Renamed ');
    const [proj] = await db`select name, slug from projects where id = ${p.project.id}`;
    expect([proj.name, proj.slug]).toEqual(['Renamed', p.project.slug]);
    expect((await err(renameProject(db, human(p.jeremy), p.project.id, '')))?.message).toBe('name must be 1-60 characters');
  });
});

describe('setRole', () => {
  it('refuses to demote the only admin; works once another admin exists', async () => {
    const p = await makeProject(db);
    const j = human(p.jeremy);
    expect((await err(setRole(db, j, p.project.id, p.jeremy.id, 'member')))?.message).toBe('a project needs at least one admin');
    await setRole(db, j, p.project.id, p.jaxon.id, 'admin');
    await setRole(db, j, p.project.id, p.jeremy.id, 'member');
    const roles = await listMembers(db, human(p.scott), p.project.id);
    expect(roles.map(m => [m.name, m.role])).toEqual([['Jaxon', 'admin'], ['Jeremy', 'member'], ['Scott', 'member']]);
  });
});

describe('deleteProject', () => {
  it('admin deletes the project and everything in it; members, agents and outsiders cannot', async () => {
    const p = await makeProject(db);
    const t = await sendTask(db, agent(p.jaxon), { projectId: p.project.id, assignee: 'Jeremy', title: 'Doomed', description: 'd', blockingReason: 'b', changes: ['c'], repo: 'site' });
    await createInvite(db, human(p.jeremy), p.project.id, `x-${p.project.slug}@example.com`);
    const other = await makeProject(db);
    expect(await code(deleteProject(db, human(p.jaxon), p.project.id))).toBe('forbidden');
    expect(await code(deleteProject(db, agent(p.jeremy), p.project.id))).toBe('forbidden');
    expect(await code(deleteProject(db, human(other.jeremy), p.project.id))).toBe('forbidden');

    await deleteProject(db, human(p.jeremy), p.project.id);

    expect(await db`select 1 from projects where id = ${p.project.id}`).toHaveLength(0);
    expect(await db`select 1 from tasks where id = ${t.id}`).toHaveLength(0);
    expect(await db`select 1 from memberships where project_id = ${p.project.id}`).toHaveLength(0);
    expect(await db`select 1 from invites where project_id = ${p.project.id}`).toHaveLength(0);
    expect(await db`select 1 from projects where id = ${other.project.id}`).toHaveLength(1);
  });
});

describe('removeMember', () => {
  const send = (p: Awaited<ReturnType<typeof makeProject>>, from: 'jeremy' | 'jaxon', to: string, title: string) =>
    sendTask(db, agent(p[from]), { projectId: p.project.id, assignee: to, title, description: 'd', blockingReason: 'b', changes: ['c'], repo: 'site' });

  it('cancels open tasks both ways with events and notifications, deletes the membership', async () => {
    const p = await makeProject(db);
    const t1 = await send(p, 'jeremy', 'Jaxon', 'To Jaxon');
    const t2 = await send(p, 'jaxon', 'Jeremy', 'From Jaxon');
    await approveTask(db, human(p.jeremy), t2.id);
    const t3 = await send(p, 'jeremy', 'Scott', 'Unrelated');
    await db`insert into task_requesters (task_id, user_id) values (${t1.id}, ${p.scott.id})`;

    await removeMember(db, human(p.jeremy), p.project.id, p.jaxon.id);

    const rows = await db`select id, status from tasks where project_id = ${p.project.id}`;
    const status = Object.fromEntries(rows.map(r => [r.id, r.status]));
    expect(status).toEqual({ [t1.id]: 'cancelled', [t2.id]: 'cancelled', [t3.id]: 'pending_approval' });
    for (const id of [t1.id, t2.id]) {
      const [e] = await db`select actor_id, actor_type, note from task_events where task_id = ${id} and event = 'member_removed'`;
      expect(e).toEqual({ actorId: p.jeremy.id, actorType: 'human', note: 'Jaxon was removed from the project' });
    }
    const notes = await db`select user_id, task_id, kind from notifications where kind = 'cancelled' and task_id in ${db([t1.id, t2.id])}`;
    expect(notes.map(n => `${n.taskId === t1.id ? 't1' : 't2'}:${n.userId === p.jeremy.id ? 'jeremy' : n.userId === p.scott.id ? 'scott' : 'other'}`).sort())
      .toEqual(['t1:jeremy', 't1:scott', 't2:jeremy']);
    expect((await err(assertMember(db, p.jaxon.id, p.project.id)))?.code).toBe('forbidden');
  });

  it('drops the removed user from task_requesters without cancelling tasks they only co-requested', async () => {
    const p = await makeProject(db);
    const t = await send(p, 'jeremy', 'Scott', 'Co-requested');
    await db`insert into task_requesters (task_id, user_id) values (${t.id}, ${p.jaxon.id})`;
    await removeMember(db, human(p.jeremy), p.project.id, p.jaxon.id);
    expect(await db`select 1 from task_requesters where task_id = ${t.id}`).toHaveLength(0);
    const [row] = await db`select status from tasks where id = ${t.id}`;
    expect(row.status).toBe('pending_approval');
  });

  it('keeps at least one admin, but an admin may leave when another remains', async () => {
    const p = await makeProject(db);
    const j = human(p.jeremy);
    expect((await err(removeMember(db, j, p.project.id, p.jeremy.id)))?.message).toBe('a project needs at least one admin');
    await setRole(db, j, p.project.id, p.jaxon.id, 'admin');
    await removeMember(db, j, p.project.id, p.jeremy.id);
    expect((await err(assertMember(db, p.jeremy.id, p.project.id)))?.code).toBe('forbidden');
  });
});

describe('setupState', () => {
  it('flips agentConnected on an active OAuth consent and workerSeen on first worker use; members only', async () => {
    const p = await makeProject(db);
    const authUserId = randomUUID();
    const clientId = randomUUID();
    await admin`insert into auth.users (id, email) values (${authUserId}, ${authUserId + '@example.com'})`;
    await db`update users set auth_user_id = ${authUserId} where id = ${p.jaxon.id}`;
    await admin`insert into auth.oauth_clients (id, client_name, registration_type, client_type, token_endpoint_auth_method, redirect_uris, grant_types)
             values (${clientId}, 'Claude Code', 'dynamic', 'public', 'none', 'http://localhost/cb', 'authorization_code,refresh_token')`;
    try {
      const k = human(p.jaxon);
      expect(await setupState(db, k, p.project.id)).toEqual({ agentConnected: false, workerSeen: false });
      // a user without an auth account is never connected
      expect(await setupState(db, human(p.scott), p.project.id)).toEqual({ agentConnected: false, workerSeen: false });
      await admin`insert into auth.oauth_consents (id, user_id, client_id, scopes) values (${randomUUID()}, ${authUserId}, ${clientId}, 'openid')`;
      expect(await setupState(db, k, p.project.id)).toEqual({ agentConnected: true, workerSeen: false });
      await admin`update auth.oauth_consents set revoked_at = now() where user_id = ${authUserId}`;
      expect((await setupState(db, k, p.project.id)).agentConnected).toBe(false);
      await userByWorkerToken(db, p.jaxon.token);
      expect(await setupState(db, k, p.project.id)).toEqual({ agentConnected: false, workerSeen: true });
      await db`update worker_credentials set revoked_at = now() where user_id = ${p.jaxon.id}`;
      expect((await setupState(db, k, p.project.id)).workerSeen).toBe(false);
      const outsider = await makeProject(db);
      expect(await code(setupState(db, human(outsider.jaxon), p.project.id))).toBe('forbidden');
    } finally {
      await admin`delete from auth.oauth_clients where id = ${clientId}`;
      await db`update users set auth_user_id = null where id = ${p.jaxon.id}`;
      await admin`delete from auth.users where id = ${authUserId}`;
    }
  });
});

describe('roleOf', () => {
  it('returns the role and refuses non-members', async () => {
    const p = await makeProject(db);
    expect(await roleOf(db, p.jeremy.id, p.project.id)).toBe('admin');
    expect(await roleOf(db, p.jaxon.id, p.project.id)).toBe('member');
    const outsider = await makeProject(db);
    expect(await code(roleOf(db, outsider.jaxon.id, p.project.id))).toBe('forbidden');
  });
});

describe('listConnections', () => {
  it('lists active consents with the client name and hides revoked ones', async () => {
    const p = await makeProject(db);
    const authUserId = randomUUID();
    const clientId = randomUUID();
    await admin`insert into auth.users (id, email) values (${authUserId}, ${authUserId + '@example.com'})`;
    await db`update users set auth_user_id = ${authUserId} where id = ${p.jaxon.id}`;
    await admin`insert into auth.oauth_clients (id, client_name, registration_type, client_type, token_endpoint_auth_method, redirect_uris, grant_types)
             values (${clientId}, 'Claude Code', 'dynamic', 'public', 'none', 'http://localhost/cb', 'authorization_code,refresh_token')`;
    try {
      const k = human(p.jaxon);
      expect(await listConnections(db, k)).toEqual([]);
      await admin`insert into auth.oauth_consents (id, user_id, client_id, scopes) values (${randomUUID()}, ${authUserId}, ${clientId}, 'openid')`;
      const [c] = await listConnections(db, k);
      expect(c).toMatchObject({ clientId, name: 'Claude Code', lastUsedAt: null });
      expect(c.grantedAt).toBeInstanceOf(Date);
      expect(await listConnections(db, human(p.scott))).toEqual([]);
      await admin`update auth.oauth_consents set revoked_at = now() where user_id = ${authUserId}`;
      expect(await listConnections(db, k)).toEqual([]);
    } finally {
      await admin`delete from auth.oauth_clients where id = ${clientId}`;
      await db`update users set auth_user_id = null where id = ${p.jaxon.id}`;
      await admin`delete from auth.users where id = ${authUserId}`;
    }
  });
});

describe('abuse limits', () => {
  type State = { age?: string; cancelled?: boolean; accepted?: boolean; expired?: boolean };
  const seedInvites = (projectId: string, userId: string, n: number, s: State = {}) =>
    db`insert into invites (project_id, email, token_hash, invited_by, created_at, cancelled_at, accepted_at, expires_at)
       select ${projectId}, 'x@example.com', 'h-' || gen_random_uuid(), ${userId}, now() - ${s.age ?? '2 days'}::interval,
         ${s.cancelled ? db`now()` : null}, ${s.accepted ? db`now()` : null}, now() + ${s.expired ? '-1 hour' : '5 days'}::interval
       from generate_series(1, ${n})`;

  it('caps invites at 20 per admin per day', async () => {
    const p = await makeProject(db);
    await seedInvites(p.project.id, p.jeremy.id, 20, { age: '1 hour' });
    const e = await err(createInvite(db, human(p.jeremy), p.project.id, 'a@example.com'));
    expect(e?.code).toBe('limit');
    expect(e?.message).toBe('you can send at most 20 invites a day; try again tomorrow');
    await db`update invites set created_at = now() - interval '25 hours' where project_id = ${p.project.id}`;
    expect(await code(createInvite(db, human(p.jeremy), p.project.id, 'a@example.com'))).toBe('ok');
  });

  it('caps open invites at 50 per project; cancelled, accepted and expired ones do not count', async () => {
    const p = await makeProject(db);
    await seedInvites(p.project.id, p.jeremy.id, 49);
    await seedInvites(p.project.id, p.jeremy.id, 1, { cancelled: true });
    await seedInvites(p.project.id, p.jeremy.id, 1, { accepted: true });
    await seedInvites(p.project.id, p.jeremy.id, 1, { expired: true });
    expect(await code(createInvite(db, human(p.jeremy), p.project.id, 'a@example.com'))).toBe('ok');
    const e = await err(createInvite(db, human(p.jeremy), p.project.id, 'b@example.com'));
    expect(e?.code).toBe('limit');
    expect(e?.message).toBe('this project has 50 open invites; cancel some first');
  });

  it('caps projects at 10 per creator; membership alone does not count', async () => {
    const p = await makeProject(db);
    // Jaxon is a member of p's project but created none of them.
    for (let i = 0; i < 10; i++) await createProject(db, human(p.jaxon), { name: `Mine ${i}` });
    const e = await err(createProject(db, human(p.jaxon), { name: 'One too many' }));
    expect(e?.code).toBe('limit');
    expect(e?.message).toBe('you can create at most 10 projects');
    expect(await code(createProject(db, human(p.scott), { name: 'Scott first' }))).toBe('ok');
  });

  it('refuses links in project names on create and rename', async () => {
    const p = await makeProject(db);
    const msg = 'name must not contain links';
    expect((await err(createProject(db, human(p.jeremy), { name: 'see evil.com' })))?.message).toBe(msg);
    expect((await err(renameProject(db, human(p.jeremy), p.project.id, 'see evil.com')))?.message).toBe(msg);
    expect(await code(renameProject(db, human(p.jeremy), p.project.id, 'Project v1.2'))).toBe('ok');
  });
});

describe('hasLink', () => {
  it('flags urls and any domain, not versions or plain words', () => {
    for (const s of ['visit evil.com', 'http://x', 'www.x', 'a.io', 'x.dev/y', 'scam.shop', 'bit.do', 'evil.us', 'evil.top', 'evil\uFF0Ecom', 'evil\uFF0Ecom', 'Next.js app']) expect(hasLink(s), s).toBe(true);
    for (const s of ['Project v1.2', 'Q3 roadmap', 'com']) expect(hasLink(s), s).toBe(false);
  });

  it('treats ideographic full stops as dots and catches non-Latin TLDs', () => {
    for (const s of ['evil\u3002com', 'evil\uFF61com', 'evil.рф', 'пример.рф/x']) expect(hasLink(s), s).toBe(true);
    for (const s of ['v1.2', 'Release v1.2 notes']) expect(hasLink(s), s).toBe(false);
  });

  it('catches combining marks in labels and TLDs', () => {
    for (const s of ['evi\u0335.com', 'x\u0301.com', 'evil.c\u0335om', 'a\u0335.io']) expect(hasLink(s), s).toBe(true);
    for (const s of ['v1.2', 'Release v1.2 notes', 'caf\u0065\u0301 menu']) expect(hasLink(s), s).toBe(false);
  });

  it('stays fast on long input with no dots', () => {
    for (const s of ['a'.repeat(100_000), 'a-'.repeat(50_000), 'рф'.repeat(50_000), 'a\u0335'.repeat(50_000)]) {
      const start = performance.now();
      expect(hasLink(s)).toBe(false);
      expect(performance.now() - start).toBeLessThan(100);
    }
  });
});
