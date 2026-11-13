import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { agentSession, approveTask, createDb, createProject, deleteAccount, sendTask, type JunctionError } from '../src';
import { adminDb, agent, human, makeProject } from './fixtures';

const db = createDb();
const admin = adminDb();
afterAll(() => Promise.all([db.end(), admin.end()]));

const err = (p: Promise<unknown>) => p.then(() => null, (e: JunctionError) => e);

const send = (p: Awaited<ReturnType<typeof makeProject>>, from: 'jeremy' | 'jaxon', to: string, title: string) =>
  sendTask(db, agent(p[from]), { projectId: p.project.id, assignee: to, title, description: 'd', blockingReason: 'b', changes: ['c'], repo: 'site' });

describe('deleteAccount', () => {
  it('is blocked for a sole admin of a project with other members, and changes nothing', async () => {
    const p = await makeProject(db);
    const t = await send(p, 'jaxon', 'Jeremy', 'Open');
    const e = await err(deleteAccount(db, human(p.jeremy)));
    expect(e?.code).toBe('validation');
    expect(e?.message).toBe('make someone else an admin of Test project first');
    expect(await db`select 1 from memberships where user_id = ${p.jeremy.id}`).toHaveLength(1);
    expect((await db`select status from tasks where id = ${t.id}`)[0].status).toBe('pending_approval');
    expect((await db`select name from users where id = ${p.jeremy.id}`)[0].name).toBe('Jeremy');
    expect(await db`select 1 from worker_credentials where user_id = ${p.jeremy.id} and revoked_at is null`).toHaveLength(1);
  });

  it('refuses agents', async () => {
    const p = await makeProject(db);
    expect((await err(deleteAccount(db, agent(p.jaxon))))?.code).toBe('forbidden');
  });

  it('deletes projects where the user is the only member', async () => {
    const p = await makeProject(db);
    const own = await createProject(db, human(p.jaxon), { name: 'Solo' });
    await deleteAccount(db, human(p.jaxon));
    expect(await db`select 1 from projects where id = ${own.id}`).toHaveLength(0);
    expect(await db`select 1 from projects where id = ${p.project.id}`).toHaveLength(1);
  });

  it('removes them from shared projects like an admin removal, and cleans up the account', async () => {
    const p = await makeProject(db);
    const t1 = await send(p, 'jeremy', 'Jaxon', 'To Jaxon');
    const t2 = await send(p, 'jaxon', 'Jeremy', 'From Jaxon');
    await approveTask(db, human(p.jeremy), t2.id);
    const authUserId = randomUUID();
    const clientId = randomUUID();
    const sid = randomUUID();
    await admin`insert into auth.users (id, email) values (${authUserId}, ${authUserId + '@example.com'})`;
    await db`update users set auth_user_id = ${authUserId} where id = ${p.jaxon.id}`;
    await admin`insert into auth.oauth_clients (id, client_name, registration_type, client_type, token_endpoint_auth_method, redirect_uris, grant_types)
             values (${clientId}, 'Claude Code', 'dynamic', 'public', 'none', 'http://localhost/cb', 'authorization_code,refresh_token')`;
    await admin`insert into auth.sessions (id, user_id, oauth_client_id) values (${sid}, ${authUserId}, ${clientId})`;
    await admin`insert into auth.oauth_consents (id, user_id, client_id, scopes) values (${randomUUID()}, ${authUserId}, ${clientId}, 'openid')`;
    try {
      expect(await agentSession(db, sid)).not.toBeNull();
      await deleteAccount(db, human(p.jaxon));

      for (const id of [t1.id, t2.id]) {
        const [t] = await db`select status from tasks where id = ${id}`;
        expect(t.status).toBe('cancelled');
        const [e] = await db`select actor_id, actor_type, note from task_events where task_id = ${id} and event = 'member_removed'`;
        expect(e).toEqual({ actorId: p.jaxon.id, actorType: 'human', note: 'a member deleted their account' });
        expect(await db`select 1 from notifications where task_id = ${id} and user_id = ${p.jeremy.id} and kind = 'cancelled'`).toHaveLength(1);
      }
      expect(await db`select 1 from memberships where user_id = ${p.jaxon.id}`).toHaveLength(0);
      expect(await db`select 1 from worker_credentials where user_id = ${p.jaxon.id} and revoked_at is null`).toHaveLength(0);
      const [u] = await db`select name, email, auth_user_id from users where id = ${p.jaxon.id}`;
      expect(u).toEqual({ name: 'Deleted user', email: `deleted-${p.jaxon.id}@junction.invalid`, authUserId: null });
      expect(await admin`select 1 from auth.users where id = ${authUserId}`).toHaveLength(0);
      expect(await admin`select 1 from auth.oauth_consents where user_id = ${authUserId}`).toHaveLength(0);
      expect(await agentSession(db, sid)).toBeNull();
    } finally {
      await admin`delete from auth.sessions where user_id = ${authUserId}`;
      await admin`delete from auth.oauth_clients where id = ${clientId}`;
      await admin`delete from auth.users where id = ${authUserId}`;
    }
  });
});
