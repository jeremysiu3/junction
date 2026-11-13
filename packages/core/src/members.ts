import type { Db } from './db';
import { JunctionError } from './types';
import { wrapUntrusted } from './untrusted';

export async function assertMember(db: Db, userId: string, projectId: string): Promise<void> {
  const rows = await db`select 1 from memberships where user_id = ${userId} and project_id = ${projectId}`;
  if (rows.length === 0) throw new JunctionError('forbidden', 'not a member of this project');
}

// Serializes a user's limit-checked inserts: concurrent calls from one user count one at a time.
// "no key update" still conflicts with itself but not with the FOR KEY SHARE every foreign-key check takes, so two users sending to each other cannot deadlock.
export async function lockUser(tx: Db, userId: string): Promise<void> {
  await tx`select 1 from users where id = ${userId} for no key update`;
}

export async function assertAdmin(db: Db, userId: string, projectId: string): Promise<void> {
  const rows = await db`select 1 from memberships where user_id = ${userId} and project_id = ${projectId} and role = 'admin'`;
  if (rows.length === 0) throw new JunctionError('forbidden', 'only a project admin can do this');
}

export async function resolveAssignee(db: Db, projectId: string, nameOrEmail: string): Promise<{ id: string; name: string }> {
  const members = await db`
    select u.id, u.name, u.email from memberships m join users u on u.id = m.user_id
    where m.project_id = ${projectId} order by u.name`;
  const q = nameOrEmail.trim().toLowerCase();
  const hits = members.filter(m => m.name.toLowerCase() === q || m.email.toLowerCase() === q);
  if (hits.length !== 1) {
    const list = members.map(m => `${m.name} <${m.email}>`).join(', ');
    throw new JunctionError('validation', `${hits.length ? 'ambiguous' : 'unknown'} assignee "${nameOrEmail}". Members:\n${wrapUntrusted(list)}`);
  }
  return { id: hits[0].id, name: hits[0].name };
}

export async function roleOf(db: Db, userId: string, projectId: string): Promise<'admin' | 'member'> {
  const [r] = await db`select role from memberships where user_id = ${userId} and project_id = ${projectId}`;
  if (!r) throw new JunctionError('forbidden', 'not a member of this project');
  return r.role;
}
