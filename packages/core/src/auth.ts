import { createHash, randomBytes } from 'node:crypto';
import type { Db } from './db';
import { assertMember } from './members';
import { JunctionError, type Actor } from './types';

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export function newWorkerToken(): { token: string; hash: string } {
  const token = 'jw_' + randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

function humanOnly(actor: Actor, what: string) {
  if (actor.type !== 'human') throw new JunctionError('forbidden', `only a human can ${what}`);
}

export async function createWorkerCredential(db: Db, actor: Actor, name: string): Promise<{ id: string; token: string }> {
  humanOnly(actor, 'create a worker credential');
  const n = typeof name === 'string' ? name.trim() : '';
  if (!n || n.length > 60) throw new JunctionError('validation', 'name is required and must be at most 60 characters');
  const { token, hash } = newWorkerToken();
  const [row] = await db`insert into worker_credentials (user_id, name, token_hash) values (${actor.userId}, ${n}, ${hash}) returning id`;
  return { id: row.id, token };
}

export async function listWorkerCredentials(db: Db, actor: Actor): Promise<{ id: string; name: string; createdAt: Date; lastSeenAt: Date | null }[]> {
  const rows = await db`
    select id, name, created_at, last_seen_at from worker_credentials
    where user_id = ${actor.userId} and revoked_at is null order by created_at`;
  return rows as unknown as { id: string; name: string; createdAt: Date; lastSeenAt: Date | null }[];
}

export async function revokeWorkerCredential(db: Db, actor: Actor, id: string): Promise<void> {
  humanOnly(actor, 'revoke a worker credential');
  const rows = await db`
    update worker_credentials set revoked_at = now()
    where id::text = ${id} and user_id = ${actor.userId} and revoked_at is null returning id`;
  if (rows.length === 0) throw new JunctionError('not_found', 'worker credential not found');
}

export async function userByWorkerToken(db: Db, token: string): Promise<{ id: string; name: string } | null> {
  const [u] = await db`
    update worker_credentials w set last_seen_at = now() from users u
    where w.token_hash = ${hashToken(token)} and w.revoked_at is null and u.id = w.user_id
    returning u.id, u.name`;
  return (u as { id: string; name: string } | undefined) ?? null;
}

export async function ensureUser(db: Db, input: { authUserId: string; email: string; name: string }): Promise<{ id: string; name: string }> {
  const [u] = await db`
    insert into users (name, email, auth_user_id) values (${input.name}, ${input.email}, ${input.authUserId})
    on conflict (auth_user_id) do update set auth_user_id = excluded.auth_user_id
    returning id, name`;
  return u as { id: string; name: string };
}

export async function humanSession(db: Db, sessionId: string): Promise<boolean> {
  const [r] = await db`select junction_auth.is_human_session(${sessionId}) as ok`;
  return r.ok;
}

export async function agentSession(db: Db, sessionId: string): Promise<{ id: string; name: string; clientId: string } | null> {
  const [r] = await db`select id, name, client_id from junction_auth.agent_session(${sessionId})`;
  return (r as { id: string; name: string; clientId: string } | undefined) ?? null;
}

export async function userByAuthId(db: Db, authUserId: string): Promise<{ id: string; name: string } | null> {
  const [u] = await db`select id, name from users where auth_user_id = ${authUserId}`;
  return (u as { id: string; name: string } | undefined) ?? null;
}

export async function userProfile(db: Db, userId: string): Promise<{ name: string; email: string; avatarUrl: string | null }> {
  const [u] = await db`
    select u.name, u.email, junction_auth.avatar_url(u.auth_user_id) as avatar_url
    from users u where u.id = ${userId}`;
  if (!u) throw new JunctionError('not_found', 'user not found');
  // avatar_url is user-controlled metadata: only allow GitHub avatars over https
  let avatarUrl: string | null = null;
  try {
    const url = new URL(u.avatarUrl);
    if (url.protocol === 'https:' && url.hostname === 'avatars.githubusercontent.com') avatarUrl = u.avatarUrl;
  } catch { /* null or not a URL */ }
  return { name: u.name, email: u.email, avatarUrl };
}

export async function projectForMember(db: Db, userId: string, slug: string): Promise<{ id: string; slug: string; name: string }> {
  const [p] = await db`select id, slug, name from projects where slug = ${slug}`;
  if (!p) throw new JunctionError('not_found', 'project not found');
  await assertMember(db, userId, p.id);
  return { id: p.id, slug: p.slug, name: p.name };
}
