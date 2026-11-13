import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import {
  agentSession, createDb, createWorkerCredential, ensureUser, humanSession, listWorkerCredentials, newWorkerToken,
  revokeWorkerCredential, userByWorkerToken, userProfile, type JunctionError,
} from '../src';
import { adminDb, agent, human, makeProject } from './fixtures';

const db = createDb();
const admin = adminDb();
afterAll(() => Promise.all([db.end(), admin.end()]));

const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: JunctionError) => e.code);

describe('worker credentials', () => {
  it('newWorkerToken returns a jw_ token whose hash is sha256 hex', () => {
    const { token, hash } = newWorkerToken();
    expect(token).toMatch(/^jw_[A-Za-z0-9_-]{43}$/);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(newWorkerToken().token).not.toBe(token);
  });

  it('create, look up (sets last_seen_at), list', async () => {
    const p = await makeProject(db);
    const { id, token } = await createWorkerCredential(db, human(p.jaxon), '  laptop ');
    expect(token).toMatch(/^jw_/);
    const mine = async () => (await listWorkerCredentials(db, human(p.jaxon))).find(c => c.id === id);
    expect(await mine()).toMatchObject({ id, name: 'laptop', lastSeenAt: null });
    expect(await userByWorkerToken(db, token)).toEqual({ id: p.jaxon.id, name: 'Jaxon' });
    expect((await mine())?.lastSeenAt).toBeInstanceOf(Date);
    expect(await userByWorkerToken(db, 'jw_wrong')).toBeNull();
  });

  it('validates the name and rejects agents', async () => {
    const p = await makeProject(db);
    expect(await code(createWorkerCredential(db, agent(p.jaxon), 'x'))).toBe('forbidden');
    expect(await code(createWorkerCredential(db, human(p.jaxon), '   '))).toBe('validation');
    expect(await code(createWorkerCredential(db, human(p.jaxon), 'x'.repeat(61)))).toBe('validation');
  });

  it('revoke stops the token and hides it from the list; only the owner may revoke', async () => {
    const p = await makeProject(db);
    const { id, token } = await createWorkerCredential(db, human(p.jaxon), 'laptop');
    expect(await code(revokeWorkerCredential(db, human(p.jeremy), id))).toBe('not_found');
    expect(await code(revokeWorkerCredential(db, agent(p.jaxon), id))).toBe('forbidden');
    expect(await userByWorkerToken(db, token)).not.toBeNull();
    await revokeWorkerCredential(db, human(p.jaxon), id);
    expect(await userByWorkerToken(db, token)).toBeNull();
    expect((await listWorkerCredentials(db, human(p.jaxon))).map(c => c.id)).not.toContain(id);
    expect(await code(revokeWorkerCredential(db, human(p.jaxon), id))).toBe('not_found');
  });
});

describe('ensureUser', () => {
  it('upserts on auth_user_id and keeps the first name', async () => {
    const authUserId = randomUUID();
    await admin`insert into auth.users (id, email) values (${authUserId}, ${authUserId + '@example.com'})`;
    try {
      const email = `${authUserId}@example.com`;
      const a = await ensureUser(db, { authUserId, email, name: 'First' });
      const b = await ensureUser(db, { authUserId, email: 'other@example.com', name: 'Second' });
      expect(b).toEqual({ id: a.id, name: 'First' });
      const [u] = await db`select email from users where id = ${a.id}`;
      expect(u.email).toBe(email);
    } finally {
      await db`delete from users where auth_user_id = ${authUserId}`;
      await admin`delete from auth.users where id = ${authUserId}`;
    }
  });
});

describe('userProfile', () => {
  it('returns the GitHub https avatar from auth metadata, null when unlinked or another host/scheme', async () => {
    const p = await makeProject(db);
    expect(await userProfile(db, p.jaxon.id)).toEqual({ name: 'Jaxon', email: p.jaxon.email, avatarUrl: null });
    const authUserId = randomUUID();
    const email = `${authUserId}@example.com`;
    const meta = (avatar_url: string) => db.json({ avatar_url });
    await admin`insert into auth.users (id, email, raw_user_meta_data) values (${authUserId}, ${email}, ${meta('https://avatars.githubusercontent.com/u/1')})`;
    try {
      const u = await ensureUser(db, { authUserId, email, name: 'Gh' });
      expect(await userProfile(db, u.id)).toEqual({ name: 'Gh', email, avatarUrl: 'https://avatars.githubusercontent.com/u/1' });
      await admin`update auth.users set raw_user_meta_data = ${meta('javascript:alert(1)')} where id = ${authUserId}`;
      expect((await userProfile(db, u.id)).avatarUrl).toBeNull();
      await admin`update auth.users set raw_user_meta_data = ${meta('https://evil.example/pixel.png')} where id = ${authUserId}`;
      expect((await userProfile(db, u.id)).avatarUrl).toBeNull();
    } finally {
      await db`delete from users where auth_user_id = ${authUserId}`;
      await admin`delete from auth.users where id = ${authUserId}`;
    }
  });
});

describe('session checks', () => {
  it('tell human sessions from OAuth agent sessions', async () => {
    const authUserId = randomUUID();
    const clientId = randomUUID();
    const humanSid = randomUUID();
    const agentSid = randomUUID();
    await admin`insert into auth.users (id, email) values (${authUserId}, ${authUserId + '@example.com'})`;
    const u = await ensureUser(db, { authUserId, email: `${authUserId}@example.com`, name: 'Sess' });
    await admin`insert into auth.oauth_clients (id, client_name, registration_type, client_type, token_endpoint_auth_method, redirect_uris, grant_types)
             values (${clientId}, 'Claude Code', 'dynamic', 'public', 'none', 'http://localhost/cb', 'authorization_code,refresh_token')`;
    await admin`insert into auth.sessions (id, user_id) values (${humanSid}, ${authUserId})`;
    await admin`insert into auth.sessions (id, user_id, oauth_client_id) values (${agentSid}, ${authUserId}, ${clientId})`;
    try {
      expect(await humanSession(db, humanSid)).toBe(true);
      expect(await humanSession(db, agentSid)).toBe(false);
      expect(await humanSession(db, randomUUID())).toBe(false);
      expect(await agentSession(db, agentSid)).toEqual({ id: u.id, name: 'Sess', clientId });
      expect(await agentSession(db, humanSid)).toBeNull();
      expect(await agentSession(db, randomUUID())).toBeNull();
      await admin`update auth.sessions set not_after = now() - interval '1 minute' where id = ${agentSid}`;
      expect(await agentSession(db, agentSid)).toBeNull();
      await admin`update auth.sessions set not_after = null where id = ${agentSid}`;
      expect(await agentSession(db, agentSid)).not.toBeNull();
      await admin`delete from auth.sessions where id = ${agentSid}`;
      expect(await agentSession(db, agentSid)).toBeNull();
    } finally {
      await admin`delete from auth.sessions where user_id = ${authUserId}`;
      await admin`delete from auth.oauth_clients where id = ${clientId}`;
      await db`delete from users where auth_user_id = ${authUserId}`;
      await admin`delete from auth.users where id = ${authUserId}`;
    }
  });
});
