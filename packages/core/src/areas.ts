import type { Db } from './db';
import { assertAdmin, assertMember } from './members';
import { JunctionError, type Actor, type Area } from './types';
import { wrapUntrusted } from './untrusted';

const areaCols = (db: Db) => db`id, project_id, name, owner_id, description`;

export function humanOnly(actor: Actor, what: string) {
  if (actor.type !== 'human') throw new JunctionError('forbidden', `${what} is human-only`);
}

export async function saveArea(
  db: Db,
  actor: Actor,
  input: { projectId: string; id?: string; name: string; ownerId: string | null; description?: string },
): Promise<Area> {
  humanOnly(actor, 'saving an area');
  await assertAdmin(db, actor.userId, input.projectId);
  const name = (input.name ?? '').trim();
  if (!name) throw new JunctionError('validation', 'name must not be blank');
  if (name.length > 100) throw new JunctionError('validation', 'name must be at most 100 characters');
  if (input.ownerId) {
    const m = await db`select 1 from memberships where user_id = ${input.ownerId} and project_id = ${input.projectId}`;
    if (m.length === 0) throw new JunctionError('validation', 'owner must be a member of this project');
  }
  const description = (input.description ?? '').trim();
  if (description.length > 1000) throw new JunctionError('validation', 'description must be at most 1000 characters');
  try {
    const [row] = input.id
      ? await db`
          update areas set name = ${name}, owner_id = ${input.ownerId}, description = ${description}
          where id = ${input.id} and project_id = ${input.projectId}
          returning ${areaCols(db)}`
      : await db`
          insert into areas (project_id, name, owner_id, description)
          values (${input.projectId}, ${name}, ${input.ownerId}, ${description})
          returning ${areaCols(db)}`;
    if (!row) throw new JunctionError('not_found', 'area not found in this project');
    return row as unknown as Area;
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw new JunctionError('validation', `a responsibility named "${name}" already exists`);
    throw e;
  }
}

export async function findArea(db: Db, projectId: string, name: string): Promise<Area> {
  const q = (name ?? '').trim();
  const [row] = await db`select ${areaCols(db)} from areas where project_id = ${projectId} and lower(name) = lower(${q})`;
  if (row) return row as unknown as Area;
  const all = await db`select name from areas where project_id = ${projectId} order by name`;
  // Admins write the names, and agents read this error.
  const list = all.length ? `Responsibilities:\n${wrapUntrusted(all.map(a => a.name).join(', '))}` : 'This project has no responsibilities';
  throw new JunctionError('validation', `unknown responsibility "${name}". ${list}`);
}

export async function setStaleDays(db: Db, actor: Actor, projectId: string, days: number): Promise<void> {
  humanOnly(actor, 'setting stale days');
  await assertMember(db, actor.userId, projectId);
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new JunctionError('validation', 'days must be an integer from 1 to 365');
  await db`update projects set stale_after_days = ${days} where id = ${projectId}`;
}

export async function staleDays(db: Db, projectId: string): Promise<number> {
  const [row] = await db`select stale_after_days from projects where id = ${projectId}`;
  if (!row) throw new JunctionError('not_found', 'project not found');
  return row.staleAfterDays as number;
}

export async function listMembers(db: Db, actor: Actor, projectId: string): Promise<{ id: string; name: string; email: string; role: 'admin' | 'member' }[]> {
  await assertMember(db, actor.userId, projectId);
  const rows = await db`
    select u.id, u.name, u.email, m.role from memberships m join users u on u.id = m.user_id
    where m.project_id = ${projectId} order by u.name`;
  return rows as unknown as { id: string; name: string; email: string; role: 'admin' | 'member' }[];
}
