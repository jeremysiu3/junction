import type { Db } from './db';
import { findArea, humanOnly } from './areas';
import { assertMember, lockUser } from './members';
import { LIMITS, capList } from './rules';
import {
  JunctionError,
  type Actor,
  type Area,
  type AreaView,
  type DoneItem,
  type Overlap,
  type WorkItemView,
  type WorkStatus,
} from './types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES: WorkStatus[] = ['in_progress', 'merged', 'abandoned'];
const MAX_FREE_TEXT = 64 * 1024; // UTF-16 characters (string length, not bytes), across every free-text field and list item in one record_work call
const REPO_MISSING = 'repo is required: pass repo from junction.json at the repo root';

export function classifyEvidence(evidence: string): 'url' | 'sha' | 'path' {
  if (/^https?:\/\/\S+$/.test(evidence)) return 'url';
  if (/^[0-9a-f]{7,40}$/i.test(evidence)) return 'sha';
  // Path rule: no whitespace; not absolute ('/', drive letter, '\\', '~'); no '..' segment;
  // and it must contain '/' or end in a file extension (\.[A-Za-z0-9]+$), so a bare word like 'done' is not evidence.
  if (
    /^\S+$/.test(evidence) &&
    (evidence.includes('/') || /\.[A-Za-z0-9]+$/.test(evidence)) &&
    !/^(\/|\\|~|[A-Za-z]:)/.test(evidence) &&
    !evidence.split(/[\\/]/).includes('..')
  ) {
    return 'path';
  }
  throw new JunctionError('validation', `evidence "${evidence}" must be a URL, a commit SHA, or a relative file path`);
}

function required(field: string, value: string | null | undefined, max = 2000): string {
  const v = (value ?? '').trim();
  if (!v) throw new JunctionError('validation', `${field} must not be blank`);
  if (v.length > max) throw new JunctionError('validation', `${field} must be at most ${max} characters`);
  return v;
}

// Shared view query: append `where ...` (aliases: w work item, p project). Reused by every work read.
export const workViewSelect = (db: Db) => db`
  select w.id, w.project_id, w.owner_id, u.name as owner_name, w.repo, w.key, w.title,
    w.area_id, a.name as area_name, w.status, w.done, w.not_done, w.paths,
    w.last_activity_at, w.created_at,
    (w.status = 'in_progress' and w.last_activity_at < now() - p.stale_after_days * interval '1 day') as stale,
    floor(extract(epoch from now() - w.last_activity_at) / 86400)::int as days_since_activity
  from work_items w
  join users u on u.id = w.owner_id
  join projects p on p.id = w.project_id
  left join areas a on a.id = w.area_id`;

export function toWorkItemView(row: Record<string, any>): WorkItemView {
  const done = (row.done as { text: string; evidence: string | null }[]).map(
    (d): DoneItem => ({ text: d.text, evidence: d.evidence, confirmed: d.evidence !== null }),
  );
  return { ...row, done } as unknown as WorkItemView;
}

async function loadView(db: Db, projectId: string, id: string): Promise<WorkItemView> {
  if (!UUID.test(id)) throw new JunctionError('not_found', 'work item not found');
  const [row] = await db`${workViewSelect(db)} where w.id = ${id} and w.project_id = ${projectId}`;
  if (!row) throw new JunctionError('not_found', 'work item not found');
  return toWorkItemView(row);
}

// Repo-relative only, so overlap compares like with like: collapse '//', strip leading './' and trailing '/'.
function normalisePaths(paths: string[] | undefined): string[] {
  capList('paths', paths ?? [], 50, 300);
  return (paths ?? []).map(raw => {
    const t = raw.trim();
    const p = t.replace(/\/{2,}/g, '/').replace(/^(\.\/)+/, '').replace(/\/+$/, '');
    if (!p || /^(\/|\\|~|[A-Za-z]:)/.test(t) || p.split(/[\\/]/).includes('..')) {
      throw new JunctionError('validation', 'paths must be repo-relative, e.g. apps/site');
    }
    return p;
  });
}

export type RecordWorkInput = {
  projectId: string;
  repo: string | null;
  key: string;
  title: string;
  summary: string;
  done: { text: string; evidence?: string }[];
  notDone: string[];
  paths?: string[];
  area?: string;
  status?: WorkStatus;
};

export async function recordWork(db: Db, actor: Actor, input: RecordWorkInput): Promise<WorkItemView> {
  await assertMember(db, actor.userId, input.projectId);
  const repo = (input.repo ?? '').trim();
  if (!repo) throw new JunctionError('validation', REPO_MISSING);
  if (repo.length > 100) throw new JunctionError('validation', 'repo must be at most 100 characters');
  const key = required('key', input.key, 200);
  const title = required('title', input.title, 200);
  const summary = required('summary', input.summary);
  const status = input.status ?? 'in_progress';
  if (!STATUSES.includes(status)) throw new JunctionError('validation', `status must be one of ${STATUSES.join(', ')}`);
  capList('done', input.done, 50);
  capList('not_done', input.notDone, 50);
  const done = input.done.map(d => {
    const evidence = (d.evidence ?? '').trim();
    if (evidence.length > 2000) throw new JunctionError('validation', 'evidence must be at most 2000 characters');
    if (evidence) classifyEvidence(evidence);
    return { text: required('done item', d.text), evidence: evidence || null };
  });
  const notDone = input.notDone.map(t => required('not_done item', t));
  const paths = normalisePaths(input.paths);
  const free = [key, title, summary, ...done.flatMap(d => [d.text, d.evidence ?? '']), ...notDone];
  if (free.reduce((n, t) => n + t.length, 0) > MAX_FREE_TEXT) throw new JunctionError('validation', 'this update is too large; keep it under 64 KB');
  const area = input.area?.trim() ? await findArea(db, input.projectId, input.area) : null;
  const searchText = [...done.map(d => d.text), ...notDone].join(' ');

  return db.begin(async tx => {
    // Each call writes one work_updates row (and at most one new work item), so counting updates bounds both.
    await lockUser(tx as unknown as Db, actor.userId);
    const [{ n }] = await tx`select count(*)::int as n from work_updates where author_id = ${actor.userId} and created_at > now() - interval '1 hour'`;
    if (n >= LIMITS.workRecordsPerHour) throw new JunctionError('limit', `you can record at most ${LIMITS.workRecordsPerHour} work updates an hour; try again later`);
    const [item] = await tx`
      insert into work_items (project_id, owner_id, repo, key, title, area_id, status, done, not_done, paths, search_text)
      values (${input.projectId}, ${actor.userId}, ${repo}, ${key}, ${title}, ${area?.id ?? null}, ${status},
        ${tx.json(done)}, ${tx.json(notDone)}, ${tx.array(paths, 1009)}, ${searchText})
      on conflict (project_id, repo, key, owner_id) do update set
        title = excluded.title,
        area_id = coalesce(excluded.area_id, work_items.area_id),
        status = excluded.status,
        done = excluded.done,
        not_done = excluded.not_done,
        paths = excluded.paths,
        search_text = excluded.search_text,
        last_activity_at = now()
      returning id`;
    await tx`
      insert into work_updates (work_item_id, author_id, summary, status, done, not_done)
      values (${item.id}, ${actor.userId}, ${summary}, ${status}, ${tx.json(done)}, ${tx.json(notDone)})`;
    return loadView(tx as unknown as Db, input.projectId, item.id);
  });
}

export async function listWorkItems(db: Db, actor: Actor, projectId: string): Promise<WorkItemView[]> {
  await assertMember(db, actor.userId, projectId);
  const rows = await db`${workViewSelect(db)} where w.project_id = ${projectId} order by w.last_activity_at desc`;
  return rows.map(toWorkItemView);
}

export async function getSnapshot(
  db: Db,
  actor: Actor,
  input: { projectId: string; area?: string; workItemId?: string },
): Promise<{ areas: AreaView[]; workItems: WorkItemView[] }> {
  await assertMember(db, actor.userId, input.projectId);
  const single = input.workItemId ? await loadView(db, input.projectId, input.workItemId) : null;
  const filter = !single && input.area?.trim() ? await findArea(db, input.projectId, input.area) : null;
  const active = (
    await db`${workViewSelect(db)} where w.project_id = ${input.projectId} and w.status = 'in_progress' order by w.last_activity_at desc`
  ).map(toWorkItemView);
  const areaRows = await db`
    select a.id, a.project_id, a.name, a.owner_id, a.description, u.name as owner_name
    from areas a left join users u on u.id = a.owner_id
    where a.project_id = ${input.projectId} order by a.name`;

  const areas = areaRows.map((r): AreaView => {
    const items = active.filter(w => w.areaId === r.id);
    return {
      ...(r as unknown as Area),
      ownerName: r.ownerName,
      inProgress: items.length,
      stale: items.filter(w => w.stale).length,
      notDone: items.flatMap(w => w.notDone.map(text => ({ workItemId: w.id, key: w.key, text }))),
    };
  });
  const workItems = single ? [single] : filter ? active.filter(w => w.areaId === filter.id) : active;
  return { areas, workItems };
}

export async function getWorkItem(db: Db, actor: Actor, projectId: string, id: string) {
  await assertMember(db, actor.userId, projectId);
  const item = await loadView(db, projectId, id);
  const rows = await db`
    select wu.summary, u.name as author_name, wu.status, wu.done, wu.not_done, wu.created_at
    from work_updates wu join users u on u.id = wu.author_id
    where wu.work_item_id = ${id} order by wu.created_at desc, wu.id`;
  const updates = rows.map(r => ({
    summary: r.summary as string,
    authorName: r.authorName as string,
    status: r.status as WorkStatus,
    done: toWorkItemView({ done: r.done }).done,
    notDone: r.notDone as string[],
    createdAt: r.createdAt as Date,
  }));
  return { ...item, updates };
}

export async function markAbandoned(db: Db, actor: Actor, projectId: string, id: string): Promise<WorkItemView> {
  humanOnly(actor, 'marking work abandoned');
  await assertMember(db, actor.userId, projectId);
  if (!UUID.test(id)) throw new JunctionError('not_found', 'work item not found');
  return db.begin(async tx => {
    const [locked] = await tx`select id from work_items where id = ${id} and project_id = ${projectId} for update`;
    if (!locked) throw new JunctionError('not_found', 'work item not found');
    const item = await loadView(tx as unknown as Db, projectId, id);
    if (!item.stale) throw new JunctionError('invalid_transition', 'only stale work can be marked abandoned');
    await tx`update work_items set status = 'abandoned' where id = ${id}`;
    await tx`
      insert into work_updates (work_item_id, author_id, summary, status, done, not_done)
      values (${id}, ${actor.userId}, ${`Marked abandoned (no activity for ${item.daysSinceActivity} days)`}, 'abandoned',
        ${tx.json(item.done.map(d => ({ text: d.text, evidence: d.evidence })))}, ${tx.json(item.notDone)})`;
    return loadView(tx as unknown as Db, projectId, id);
  });
}

const trimSlash = (p: string) => p.replace(/\/+$/, '');

export function pathsOverlap(a: string, b: string): boolean {
  const x = trimSlash(a);
  const y = trimSlash(b);
  return x === y || x.startsWith(y + '/') || y.startsWith(x + '/');
}

export async function searchWork(
  db: Db,
  actor: Actor,
  input: { projectId: string; query: string },
): Promise<WorkItemView[]> {
  const query = required('query', input.query);
  await assertMember(db, actor.userId, input.projectId);
  const rows = await db`${workViewSelect(db)},
    to_tsquery('english', replace(plainto_tsquery('english', ${query})::text, '&', '|')) q
    where w.project_id = ${input.projectId} and w.status in ('in_progress', 'merged') and w.search_vector @@ q
    order by ts_rank(w.search_vector, q) desc, w.last_activity_at desc
    limit 10`;
  return rows.map(toWorkItemView);
}

export async function startWork(
  db: Db,
  actor: Actor,
  input: { projectId: string; repo: string | null; about: string; paths?: string[]; area?: string },
): Promise<{ overlaps: Overlap[]; related: WorkItemView[] }> {
  await assertMember(db, actor.userId, input.projectId);
  const repo = (input.repo ?? '').trim();
  if (!repo) throw new JunctionError('validation', REPO_MISSING);
  if (repo.length > 100) throw new JunctionError('validation', 'repo must be at most 100 characters');
  const about = required('about', input.about);
  const paths = normalisePaths(input.paths);
  const area = input.area?.trim() ? await findArea(db, input.projectId, input.area) : null;

  const active = (
    await db`${workViewSelect(db)}
      where w.project_id = ${input.projectId} and w.status = 'in_progress' and w.owner_id <> ${actor.userId}
      order by w.last_activity_at desc`
  ).map(toWorkItemView);

  const overlaps: Overlap[] = [];
  for (const item of active) {
    const matched = item.repo === repo ? paths.filter(p => item.paths.some(q => pathsOverlap(p, q))) : [];
    if (matched.length) overlaps.push({ workItem: item, reason: 'path', paths: matched });
    else if (area && item.areaId === area.id) overlaps.push({ workItem: item, reason: 'area', paths: [] });
  }

  const skip = new Set(overlaps.map(o => o.workItem.id));
  const related = (await searchWork(db, actor, { projectId: input.projectId, query: about }))
    .filter(w => !skip.has(w.id) && w.ownerId !== actor.userId)
    .slice(0, 5);
  return { overlaps, related };
}
