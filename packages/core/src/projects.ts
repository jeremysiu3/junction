import { randomBytes } from 'node:crypto';
import type { Db } from './db';
import { hashToken } from './auth';
import { humanOnly } from './areas';
import { assertAdmin, assertMember, lockUser } from './members';
import { LIMITS, OPEN, hasLink } from './rules';
import { JunctionError, type Actor } from './types';

const LAST_ADMIN = 'a project needs at least one admin';

function projectName(name: string): string {
  const n = typeof name === 'string' ? name.trim() : '';
  if (n.length < 1 || n.length > 60) throw new JunctionError('validation', 'name must be 1-60 characters');
  if (hasLink(n)) throw new JunctionError('validation', 'name must not contain links');
  return n;
}

export async function createProject(db: Db, actor: Actor, input: { name: string }): Promise<{ id: string; slug: string }> {
  humanOnly(actor, 'creating a project');
  const name = projectName(input.name);
  const base = (name.toLowerCase().match(/[a-z0-9]+/g) ?? []).join('-').slice(0, 40).replace(/-$/, '') || 'project';
  return db.begin(async tx => {
    await lockUser(tx as unknown as Db, actor.userId);
    const [{ owned }] = await tx`select count(*)::int as owned from projects where created_by = ${actor.userId}`;
    if (owned >= LIMITS.projectsPerUser) throw new JunctionError('limit', `you can create at most ${LIMITS.projectsPerUser} projects`);
    const taken = new Set((await tx`select slug from projects where slug = ${base} or slug like ${base + '-%'}`).map(r => r.slug as string));
    let slug = base;
    // ponytail: check-then-insert; a concurrent create with the same name hits the unique index and errors, retry by hand.
    for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
    const [p] = await tx`insert into projects (slug, name, created_by) values (${slug}, ${name}, ${actor.userId}) returning id, slug`;
    await tx`insert into memberships (project_id, user_id, role) values (${p.id}, ${actor.userId}, 'admin')`;
    return { id: p.id as string, slug: p.slug as string };
  });
}

export async function renameProject(db: Db, actor: Actor, projectId: string, name: string): Promise<void> {
  humanOnly(actor, 'renaming a project');
  await assertAdmin(db, actor.userId, projectId);
  await db`update projects set name = ${projectName(name)} where id = ${projectId}`;
}

export async function createInvite(db: Db, actor: Actor, projectId: string, email: string): Promise<{ id: string; token: string; email: string }> {
  humanOnly(actor, 'inviting someone');
  await assertAdmin(db, actor.userId, projectId);
  const e = typeof email === 'string' ? email.trim().toLowerCase() : '';
  // One bare address: the email is sent to this exact string, so no "Name <addr>" or address lists.
  if (e.length > 254 || !/^[^\s@<>,;"()]+@[^\s@<>,;"()]+\.[^\s@<>,;"()]+$/.test(e)) throw new JunctionError('validation', 'enter one email address');
  const token = 'ji_' + randomBytes(32).toString('base64url');
  return db.begin(async tx => {
    await lockUser(tx as unknown as Db, actor.userId);
    const [c] = await tx`
      select
        (select count(*)::int from invites where invited_by = ${actor.userId} and created_at > now() - interval '24 hours') as today,
        (select count(*)::int from invites where project_id = ${projectId} and accepted_at is null and cancelled_at is null and expires_at > now()) as open`;
    if (c.today >= LIMITS.invitesPerDay) throw new JunctionError('limit', `you can send at most ${LIMITS.invitesPerDay} invites a day; try again tomorrow`);
    if (c.open >= LIMITS.pendingInvitesPerProject) throw new JunctionError('limit', `this project has ${LIMITS.pendingInvitesPerProject} open invites; cancel some first`);
    const [row] = await tx`
      insert into invites (project_id, email, token_hash, invited_by) values (${projectId}, ${e}, ${hashToken(token)}, ${actor.userId}) returning id`;
    return { id: row.id as string, token, email: e };
  });
}

export async function inviteByToken(
  db: Db,
  token: string,
): Promise<{ projectName: string; inviterName: string; status: 'open' | 'used' | 'expired' | 'cancelled' } | null> {
  const [r] = await db`
    select p.name as project_name, u.name as inviter_name, i.accepted_at, i.cancelled_at, i.expires_at <= now() as expired
    from invites i join projects p on p.id = i.project_id join users u on u.id = i.invited_by
    where i.token_hash = ${hashToken(token ?? '')}`;
  if (!r) return null;
  const status = r.acceptedAt ? 'used' : r.cancelledAt ? 'cancelled' : r.expired ? 'expired' : 'open';
  return { projectName: r.projectName, inviterName: r.inviterName, status };
}

export async function acceptInvite(db: Db, actor: Actor, token: string): Promise<{ projectId: string; slug: string; firstTime: boolean }> {
  humanOnly(actor, 'accepting an invite');
  return db.begin(async tx => {
    const [i] = await tx`
      select i.id, i.project_id, i.accepted_at, i.cancelled_at, i.expires_at <= now() as expired, p.slug
      from invites i join projects p on p.id = i.project_id
      where i.token_hash = ${hashToken(token ?? '')} for update of i`;
    if (!i) throw new JunctionError('not_found', 'invite not found');
    if (i.acceptedAt) throw new JunctionError('validation', 'this invite link has already been used');
    if (i.cancelledAt) throw new JunctionError('validation', 'this invite link was cancelled');
    if (i.expired) throw new JunctionError('validation', 'this invite link has expired');
    const added = await tx`
      insert into memberships (project_id, user_id, role) values (${i.projectId}, ${actor.userId}, 'member')
      on conflict do nothing returning 1`;
    await tx`update invites set accepted_at = now(), accepted_by = ${actor.userId} where id = ${i.id}`;
    return { projectId: i.projectId as string, slug: i.slug as string, firstTime: added.length > 0 };
  });
}

export async function listInvites(db: Db, actor: Actor, projectId: string): Promise<{ id: string; email: string; createdAt: Date; expiresAt: Date }[]> {
  await assertAdmin(db, actor.userId, projectId);
  const rows = await db`
    select id, email, created_at, expires_at from invites
    where project_id = ${projectId} and accepted_at is null and cancelled_at is null and expires_at > now() order by created_at`;
  return rows as unknown as { id: string; email: string; createdAt: Date; expiresAt: Date }[];
}

export async function cancelInvite(db: Db, actor: Actor, projectId: string, inviteId: string): Promise<void> {
  humanOnly(actor, 'cancelling an invite');
  await assertAdmin(db, actor.userId, projectId);
  const rows = await db`
    update invites set cancelled_at = now()
    where id::text = ${inviteId} and project_id = ${projectId} and accepted_at is null and cancelled_at is null returning id`;
  if (rows.length === 0) throw new JunctionError('not_found', 'open invite not found');
}

// Locks the admin rows so two concurrent demotions can't both pass the last-admin check.
async function assertAnotherAdmin(tx: Db, projectId: string, userId: string): Promise<void> {
  const admins = await tx`select user_id from memberships where project_id = ${projectId} and role = 'admin' order by user_id for update`;
  if (admins.every(a => a.userId === userId)) throw new JunctionError('validation', LAST_ADMIN);
}

// Locks the project row (as deleteAccount does, so membership changes in a project run one at a time), then the admin rows,
// then checks the actor is still one, so a concurrently removed admin can't act.
async function assertAdminLocked(tx: Db, actorId: string, projectId: string): Promise<void> {
  await tx`select 1 from projects where id = ${projectId} for update`;
  const admins = await tx`select user_id from memberships where project_id = ${projectId} and role = 'admin' order by user_id for update`;
  if (!admins.some(a => a.userId === actorId)) throw new JunctionError('forbidden', 'only a project admin can do this');
}

export async function setRole(db: Db, actor: Actor, projectId: string, userId: string, role: 'admin' | 'member'): Promise<void> {
  humanOnly(actor, 'changing a role');
  if (role !== 'admin' && role !== 'member') throw new JunctionError('validation', 'role must be admin or member');
  await db.begin(async tx => {
    await assertAdminLocked(tx as unknown as Db, actor.userId, projectId);
    if (role === 'member') await assertAnotherAdmin(tx as unknown as Db, projectId, userId);
    const rows = await tx`update memberships set role = ${role} where project_id = ${projectId} and user_id::text = ${userId} returning 1`;
    if (rows.length === 0) throw new JunctionError('not_found', 'member not found');
  });
}

// Shared by removeMember and deleteAccount: cancels the user's open tasks, cleans up their rows and deletes the membership.
async function dropMember(tx: Db, projectId: string, target: { id: string; name: string }, actor: Actor, note: string): Promise<void> {
  await tx`delete from memberships where project_id = ${projectId} and user_id = ${target.id}`;
  // Admin action, not a lifecycle step: bypasses nextStatus.
  const cancelled = await tx`
    update tasks set status = 'cancelled', updated_at = now()
    where project_id = ${projectId} and status in ${tx(OPEN)} and (assignee_id = ${target.id} or requester_id = ${target.id})
    returning id, requester_id, assignee_id`;
  for (const t of cancelled) {
    await tx`insert into task_events (task_id, actor_id, actor_type, event, note)
             values (${t.id}, ${actor.userId}, ${actor.type}, 'member_removed', ${note})`;
    const co = await tx`select user_id from task_requesters where task_id = ${t.id}`;
    const parties = new Set([t.requesterId, t.assigneeId, ...co.map(c => c.userId)]);
    parties.delete(target.id);
    for (const to of parties) await tx`insert into notifications (user_id, task_id, kind) values (${to}, ${t.id}, 'cancelled')`;
  }
  await tx`update areas set owner_id = null where project_id = ${projectId} and owner_id = ${target.id}`;
  await tx`delete from task_requesters where user_id = ${target.id} and task_id in (select id from tasks where project_id = ${projectId})`;
}

export async function removeMember(db: Db, actor: Actor, projectId: string, userId: string): Promise<void> {
  humanOnly(actor, 'removing a member');
  await db.begin(async tx => {
    await assertAdminLocked(tx as unknown as Db, actor.userId, projectId);
    const [target] = await tx`
      select u.id, u.name, m.role from memberships m join users u on u.id = m.user_id
      where m.project_id = ${projectId} and u.id::text = ${userId} for update of m`;
    if (!target) throw new JunctionError('not_found', 'member not found');
    if (target.role === 'admin') await assertAnotherAdmin(tx as unknown as Db, projectId, target.id);
    await dropMember(tx as unknown as Db, projectId, target as { id: string; name: string }, actor, `${target.name} was removed from the project`);
  });
}

// Every project table cascades from projects, so this removes its tasks, context, work, areas, invites and memberships.
export async function deleteProject(db: Db, actor: Actor, projectId: string): Promise<void> {
  humanOnly(actor, 'deleting a project');
  await db.begin(async tx => {
    await assertAdminLocked(tx as unknown as Db, actor.userId, projectId);
    await tx`delete from projects where id = ${projectId}`;
  });
}

// Leaves every project, revokes workers, anonymizes the users row (history keeps resolving) and deletes the login,
// which cascades sessions and OAuth consents so connected agents stop working.
export async function deleteAccount(db: Db, actor: Actor): Promise<void> {
  humanOnly(actor, 'deleting an account');
  await db.begin(async t => {
    const tx = t as unknown as Db;
    const [me] = await tx`select id, name, auth_user_id from users where id = ${actor.userId} for update`;
    if (!me) throw new JunctionError('not_found', 'user not found');
    // Locking the project row (so a concurrent invite accept waits) and all its member rows (in user_id order, like the admin locks)
    // stops a concurrent change from invalidating the checks below.
    const plan: { id: string; sole: boolean }[] = [];
    for (const p of await tx`select p.id, p.name from memberships m join projects p on p.id = m.project_id where m.user_id = ${me.id} order by p.created_at, p.id`) {
      await tx`select 1 from projects where id = ${p.id} for update`;
      const members = await tx`select user_id, role from memberships where project_id = ${p.id} order by user_id for update`;
      const mine = members.find(m => m.userId === me.id);
      if (!mine) continue;
      const others = members.filter(m => m.userId !== me.id);
      if (mine.role === 'admin' && others.length > 0 && !others.some(o => o.role === 'admin')) {
        throw new JunctionError('validation', `make someone else an admin of ${p.name} first`);
      }
      plan.push({ id: p.id, sole: others.length === 0 });
    }
    for (const p of plan) {
      if (p.sole) await tx`delete from projects where id = ${p.id}`;
      else await dropMember(tx, p.id, me as { id: string; name: string }, actor, 'a member deleted their account');
    }
    await tx`update worker_credentials set revoked_at = now() where user_id = ${me.id} and revoked_at is null`;
    await tx`update users set name = 'Deleted user', email = 'deleted-' || id || '@junction.invalid', auth_user_id = null where id = ${me.id}`;
    if (me.authUserId) await tx`select junction_auth.delete_user(${me.authUserId})`;
  });
}

// Drives the setup page's ticks. The project only gates access: both checks are per user.
export async function setupState(db: Db, actor: Actor, projectId: string): Promise<{ agentConnected: boolean; workerSeen: boolean }> {
  await assertMember(db, actor.userId, projectId);
  const [r] = await db`
    select
      junction_auth.agent_connected(${actor.userId}) as agent_connected,
      exists (select 1 from worker_credentials where user_id = ${actor.userId} and revoked_at is null and last_seen_at is not null) as worker_seen`;
  return { agentConnected: r.agentConnected, workerSeen: r.workerSeen };
}

// The user's active OAuth grants (their agents). lastUsedAt comes from the sessions those grants minted.
export async function listConnections(db: Db, actor: Actor): Promise<{ clientId: string; name: string; grantedAt: Date; lastUsedAt: Date | null }[]> {
  const rows = await db`select client_id, name, granted_at, last_used_at from junction_auth.list_connections(${actor.userId}) order by granted_at`;
  return rows as unknown as { clientId: string; name: string; grantedAt: Date; lastUsedAt: Date | null }[];
}
