import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createDb, ensureUser } from '@junction/core';
import { adminDb, makeProject } from '@junction/core/test/fixtures';
import { authenticateAgent, requestOrigin, unauthorized, type VerifyJwt } from '../lib/agent-auth';

const db = createDb();
const admin = adminDb();
const authUserId = randomUUID();
const clientId = randomUUID();
const humanSid = randomUUID();
const agentSid = randomUUID();
let userId: string;
let p: Awaited<ReturnType<typeof makeProject>>;

beforeAll(async () => {
  p = await makeProject(db);
  await admin`insert into auth.users (id, email) values (${authUserId}, ${authUserId + '@example.com'})`;
  userId = (await ensureUser(db, { authUserId, email: `${authUserId}@example.com`, name: 'Auth' })).id;
  await admin`insert into auth.oauth_clients (id, client_name, registration_type, client_type, token_endpoint_auth_method, redirect_uris, grant_types)
           values (${clientId}, 'Claude Code', 'dynamic', 'public', 'none', 'http://localhost/cb', 'authorization_code,refresh_token')`;
  await admin`insert into auth.sessions (id, user_id) values (${humanSid}, ${authUserId})`;
  await admin`insert into auth.sessions (id, user_id, oauth_client_id) values (${agentSid}, ${authUserId}, ${clientId})`;
});
afterAll(async () => {
  await admin`delete from auth.sessions where user_id = ${authUserId}`;
  await admin`delete from auth.oauth_clients where id = ${clientId}`;
  await db`delete from users where auth_user_id = ${authUserId}`;
  await admin`delete from auth.users where id = ${authUserId}`;
  await Promise.all([db.end(), admin.end()]);
});

const req = (authorization?: string) => new Request('http://x/api', { headers: authorization ? { authorization } : {} });
const verifyAs = (sessionId: string, cid = clientId): VerifyJwt => async () => ({ sessionId, clientId: cid });

describe('authenticateAgent', () => {
  it('accepts a valid agent session', async () => {
    expect(await authenticateAgent(req('Bearer t'), verifyAs(agentSid))).toEqual({ userId, via: 'oauth' });
  });

  it('rejects the same token once the session row is gone', async () => {
    const sid = randomUUID();
    await admin`insert into auth.sessions (id, user_id, oauth_client_id) values (${sid}, ${authUserId}, ${clientId})`;
    expect(await authenticateAgent(req('Bearer t'), verifyAs(sid))).not.toBeNull();
    await admin`delete from auth.sessions where id = ${sid}`;
    expect(await authenticateAgent(req('Bearer t'), verifyAs(sid))).toBeNull();
  });

  it('rejects a human session, a client mismatch and an unverifiable token', async () => {
    expect(await authenticateAgent(req('Bearer t'), verifyAs(humanSid))).toBeNull();
    expect(await authenticateAgent(req('Bearer t'), verifyAs(agentSid, randomUUID()))).toBeNull();
    expect(await authenticateAgent(req('Bearer t'), async () => null)).toBeNull();
  });

  it('accepts a worker token and never falls through to JWT verification for a bad one', async () => {
    const never: VerifyJwt = async () => { throw new Error('verify must not run'); };
    expect(await authenticateAgent(req(`Bearer ${p.jaxon.token}`), never)).toEqual({ userId: p.jaxon.id, via: 'worker' });
    expect(await authenticateAgent(req('Bearer jw_wrong'), never)).toBeNull();
  });

  it('parses the header strictly', async () => {
    expect(await authenticateAgent(req(), verifyAs(agentSid))).toBeNull();
    expect(await authenticateAgent(req('Basic abc'), verifyAs(agentSid))).toBeNull();
    expect(await authenticateAgent(req('Bearer '), verifyAs(agentSid))).toBeNull();
    expect(await authenticateAgent(req('bearer  t '), verifyAs(agentSid))).toEqual({ userId, via: 'oauth' });
  });
});

describe('unauthorized', () => {
  it('is a 401 pointing at the protected-resource metadata', async () => {
    const res = unauthorized('http://x');
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('resource_metadata="http://x/.well-known/oauth-protected-resource/mcp"');
    expect(await res.json()).toEqual({ error: { code: 'unauthorized', message: 'sign in: connect this agent to Junction' } });
  });
});

describe('requestOrigin', () => {
  const spoofed = () => new Request('http://x/mcp', { headers: { host: 'evil.example', 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'http' } });
  afterEach(() => { delete process.env.JUNCTION_APP_URL; });

  it('uses JUNCTION_APP_URL (trailing slash stripped) over spoofable headers', () => {
    process.env.JUNCTION_APP_URL = 'https://app.junctionmcp.com/';
    expect(requestOrigin(spoofed())).toBe('https://app.junctionmcp.com');
  });

  it('falls back to the headers when unset or empty', () => {
    expect(requestOrigin(spoofed())).toBe('http://evil.example');
    process.env.JUNCTION_APP_URL = '';
    expect(requestOrigin(spoofed())).toBe('http://evil.example');
  });
});
