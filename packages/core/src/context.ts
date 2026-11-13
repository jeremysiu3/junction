import type { Db } from './db';
import { assertMember, lockUser } from './members';
import { LIMITS, capList } from './rules';
import { JunctionError, type Actor, type ContextEntry } from './types';

export type ContextEntryWithAuthor = ContextEntry & {
  authorName: string;
  replaces: { id: string; title: string; body: string } | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A decision with a row pointing at it via replaces_id is replaced; search and the inbox hide it.
export const notReplaced = (db: Db) => db`not exists (select 1 from context_entries r where r.replaces_id = ce.id)`;

// Explicit column list: keeps search_vector out of results.
export const entryCols = (db: Db) =>
  db`ce.id, ce.project_id, ce.author_id, ce.kind, ce.title, ce.body, ce.tags, ce.visibility, ce.related_task_id, ce.created_at, u.name as author_name,
    (select json_build_object('id', o.id, 'title', o.title, 'body', o.body) from context_entries o where o.id = ce.replaces_id) as replaces`;

function required(field: string, value: string, max = 2000): string {
  const v = (value ?? '').trim();
  if (!v) throw new JunctionError('validation', `${field} must not be blank`);
  if (v.length > max) throw new JunctionError('validation', `${field} must be at most ${max} characters`);
  return v;
}

export async function writeContext(
  db: Db,
  actor: Actor,
  input: { projectId: string; kind: 'note' | 'decision'; title: string; body: string; tags?: string[]; visibility?: 'project' | 'private'; replaces?: string },
): Promise<ContextEntry> {
  if ((input.kind as string) === 'ownership') throw new JunctionError('validation', 'ownership comes from Responsibilities in Project settings; ask a project admin to set the owner');
  if (!['note', 'decision'].includes(input.kind)) throw new JunctionError('validation', 'kind must be note or decision');
  if (input.visibility && !['project', 'private'].includes(input.visibility)) throw new JunctionError('validation', 'visibility must be project or private');
  const title = required('title', input.title, 200);
  const body = required('body', input.body, 10000);
  capList('tags', input.tags ?? [], 20, 50);
  await assertMember(db, actor.userId, input.projectId);
  const alreadyReplaced = new JunctionError('validation', 'already replaced');
  if (input.replaces !== undefined) {
    if (input.kind !== 'decision') throw new JunctionError('validation', 'replaces is only allowed with kind decision');
    if ((input.visibility ?? 'project') !== 'project') throw new JunctionError('validation', 'a decision that replaces another must have project visibility');
    const [target] = UUID.test(input.replaces)
      ? await db`select kind, visibility from context_entries where id = ${input.replaces} and project_id = ${input.projectId}`
      : [];
    if (target?.kind !== 'decision' || target.visibility !== 'project') {
      throw new JunctionError('validation', 'replaces must be a project-visible decision in this project');
    }
    const [taken] = await db`select 1 from context_entries where replaces_id = ${input.replaces}`;
    if (taken) throw alreadyReplaced;
  }
  try {
    return await db.begin(async tx => {
      await lockUser(tx as unknown as Db, actor.userId);
      const [{ n }] = await tx`select count(*)::int as n from context_entries where author_id = ${actor.userId} and created_at > now() - interval '1 hour'`;
      if (n >= LIMITS.contextWritesPerHour) throw new JunctionError('limit', `you can write at most ${LIMITS.contextWritesPerHour} memory entries an hour; try again later`);
      const [row] = await tx`
        insert into context_entries (project_id, author_id, kind, title, body, tags, visibility, replaces_id)
        values (${input.projectId}, ${actor.userId}, ${input.kind}, ${title}, ${body}, ${input.tags ?? []}, ${input.visibility ?? 'project'}, ${input.replaces ?? null})
        returning id, project_id, author_id, kind, title, body, tags, visibility, related_task_id, created_at`;
      return row as unknown as ContextEntry;
    });
  } catch (e) {
    // Backstop for a concurrent replacement: the unique index on replaces_id.
    if ((e as { code?: string; constraint_name?: string }).code === '23505' && (e as { constraint_name?: string }).constraint_name === 'context_entries_replaces_idx') throw alreadyReplaced;
    throw e;
  }
}

export async function searchContext(
  db: Db,
  actor: Actor,
  input: { projectId: string; query: string; kind?: ContextEntry['kind'] },
): Promise<ContextEntryWithAuthor[]> {
  const query = required('query', input.query);
  await assertMember(db, actor.userId, input.projectId);
  const rows = await db`
    select ${entryCols(db)}
    from context_entries ce join users u on u.id = ce.author_id,
         to_tsquery('english', replace(plainto_tsquery('english', ${query})::text, '&', '|')) q
    where ce.project_id = ${input.projectId}
      and (ce.visibility = 'project' or ce.author_id = ${actor.userId})
      and ce.search_vector @@ q
      and ${notReplaced(db)}
      ${input.kind ? db`and ce.kind = ${input.kind}` : db``}
    order by ts_rank(ce.search_vector, q) desc, ce.created_at desc
    limit 10`;
  return rows as unknown as ContextEntryWithAuthor[];
}

export async function findOwner(db: Db, actor: Actor, input: { projectId: string; topic: string }) {
  const topic = required('topic', input.topic);
  const areas = await db`
    select a.name, u.name as owner_name, u.email as owner_email, a.description
    from areas a left join users u on u.id = a.owner_id,
         to_tsquery('english', replace(plainto_tsquery('english', ${topic})::text, '&', '|')) q
    where a.project_id = ${input.projectId}
      and to_tsvector('english', a.name || ' ' || a.description) @@ q
    order by ts_rank(to_tsvector('english', a.name || ' ' || a.description), q) desc, a.name`;
  const members = await db`
    select u.name, u.email from memberships m join users u on u.id = m.user_id
    where m.project_id = ${input.projectId} order by u.name`;
  return {
    areas: areas as unknown as { name: string; ownerName: string | null; ownerEmail: string | null; description: string }[],
    members: members as unknown as { name: string; email: string }[],
  };
}
