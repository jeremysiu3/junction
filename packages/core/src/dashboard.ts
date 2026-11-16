import { staleDays } from './areas';
import { notReplaced } from './context';
import type { Db } from './db';
import { assertMember } from './members';
import { OPEN } from './rules';
import type { Actor, TaskStatus, WorkStatus } from './types';
import { toWorkItemView, workViewSelect } from './work';

// Sql fragment: the latest unanswered question for the task aliased `t`.
export const openQuestion = (db: Db) => db`(select q.question from task_questions q where q.task_id = t.id and q.answer is null
  order by q.created_at desc, q.id desc limit 1)`;

// Time in the current column: the latest status-changing event (estimating and deferring leave the status alone).
const taskSince = (db: Db) => db`(select max(e.created_at) from task_events e where e.task_id = t.id and e.event not in ('estimated', 'deferred'))`;

export type PanelRow = {
  id: string; title: string; status: TaskStatus; requesterName: string; question: string | null;
  stuckReason: string | null; branch: string | null; since: Date;
};

// Approved tasks show here as queued whatever `background` says (it is only set at claim); a task an interactive agent is working on does not.
export async function agentPanel(db: Db, actor: Actor, projectId: string): Promise<PanelRow[]> {
  await assertMember(db, actor.userId, projectId);
  const rows = await db`
    select t.id, t.title, t.status, r.name as requester_name, ${openQuestion(db)} as question,
           t.stuck_reason, t.branch, ${taskSince(db)} as since
    from tasks t join users r on r.id = t.requester_id
    where t.project_id = ${projectId} and t.assignee_id = ${actor.userId}
      and (t.status in ('approved', 'needs_input', 'stuck')
           or (t.background and t.status in ('in_progress', 'ready_for_review', 'in_review')))
    order by array_position(array['needs_input', 'stuck', 'ready_for_review', 'in_review', 'in_progress', 'approved'], t.status::text),
             since, t.id`;
  return rows as unknown as PanelRow[];
}

export type BoardCard = {
  kind: 'request' | 'work'; id: string; title: string; status: TaskStatus | WorkStatus; background: boolean;
  from: string | null; to: string | null; owner: string | null; area: string | null; prNumber: number | null; since: Date; old: boolean;
};
export type Board = { waiting: BoardCard[]; inProgress: BoardCard[]; needsPerson: BoardCard[]; inReview: BoardCard[]; done: BoardCard[]; declined: BoardCard[]; cancelled: BoardCard[] };

const COLUMN: Record<TaskStatus, keyof Board> = {
  pending_approval: 'waiting',
  approved: 'inProgress',
  in_progress: 'inProgress',
  needs_input: 'needsPerson',
  stuck: 'needsPerson',
  ready_for_review: 'inReview',
  in_review: 'inReview',
  done: 'done',
  declined: 'declined',
  cancelled: 'cancelled',
};
const CLOSED_LIMIT = 20; // per closed list, so a burst of cancellations can't push finished work off the board
const CLOSED = ['done', 'declined', 'cancelled'] as const;

export async function boardColumns(db: Db, actor: Actor, projectId: string): Promise<Board> {
  await assertMember(db, actor.userId, projectId);
  const days = await staleDays(db, projectId);
  const oldMs = days * 86_400_000;
  const taskRows = (where: ReturnType<Db>, tail: ReturnType<Db>) => db`
    select t.id, t.title, t.status, t.background, t.repo, t.branch, t.evidence_url, r.name as requester_name, a.name as assignee_name,
           ${taskSince(db)} as since
    from tasks t join users r on r.id = t.requester_id join users a on a.id = t.assignee_id
    where t.project_id = ${projectId} and ${where} ${tail}`;
  const open = await taskRows(db`t.status in ${db(OPEN)}`, db``);
  const closed = (await Promise.all(CLOSED.map(s => taskRows(db`t.status = ${s}`, db`order by since desc limit ${CLOSED_LIMIT}`)))).flat();
  const workRows = await db`${workViewSelect(db)} where w.project_id = ${projectId} and w.status = 'in_progress'`;
  const finished = (await Promise.all((['merged', 'abandoned'] as const).map(s => db`${workViewSelect(db)}
    where w.project_id = ${projectId} and w.status = ${s} order by w.last_activity_at desc limit ${CLOSED_LIMIT}`))).flat();

  const taskCard = (r: Record<string, any>): BoardCard => {
    const pr = r.status === 'in_review' ? /\/pull\/(\d+)/.exec(r.evidenceUrl ?? '') : null;
    return {
      kind: 'request', id: r.id, title: r.title, status: r.status, background: r.background,
      from: r.requesterName, to: r.assigneeName, owner: null, area: null, prNumber: pr ? Number(pr[1]) : null, since: r.since, old: false,
    };
  };
  const workCard = (row: Record<string, any>): BoardCard => {
    const w = toWorkItemView(row);
    return {
      kind: 'work', id: w.id, title: w.title, status: w.status, background: false,
      from: null, to: null, owner: w.ownerName, area: w.areaName, prNumber: null, since: w.lastActivityAt, old: false,
    };
  };

  // A task and its own work item are one card: the work item's key is the task's branch.
  const branches = new Set(open.filter(t => t.branch).map(t => `${t.repo}\0${t.branch}`));
  const cards = [
    ...open.map(taskCard),
    ...closed.map(taskCard),
    ...workRows.filter(w => !branches.has(`${w.repo}\0${w.key}`)).map(workCard),
    ...finished.map(workCard),
  ];
  const board: Board = { waiting: [], inProgress: [], needsPerson: [], inReview: [], done: [], declined: [], cancelled: [] };
  for (const c of cards) {
    const col = c.kind === 'request' ? COLUMN[c.status as TaskStatus]
      : c.status === 'in_progress' ? 'inProgress' : c.status === 'merged' ? 'done' : 'cancelled';
    const closedCol = (CLOSED as readonly string[]).includes(col);
    board[col].push({ ...c, old: !closedCol && Date.now() - c.since.getTime() > oldMs });
  }
  for (const col of ['waiting', 'inProgress', 'needsPerson', 'inReview'] as const) board[col].sort((a, b) => +a.since - +b.since);
  for (const col of CLOSED) board[col] = board[col].sort((a, b) => +b.since - +a.since).slice(0, CLOSED_LIMIT);
  return board;
}

export async function badgeCounts(db: Db, actor: Actor, projectId: string): Promise<{ inbox: number; attention: number }> {
  await assertMember(db, actor.userId, projectId);
  const [r] = await db`
    select count(*) filter (where status = 'pending_approval')::int as inbox,
           count(*) filter (where status in ('needs_input', 'stuck'))::int as attention
    from tasks where project_id = ${projectId} and assignee_id = ${actor.userId}`;
  return { inbox: r.inbox as number, attention: r.attention as number };
}

export type KeyEntry = {
  id: string; kind: 'decision' | 'ownership'; title: string; body: string; authorId: string; authorName: string; createdAt: Date; replacesTitle: string | null;
};

export async function keyContext(db: Db, actor: Actor, projectId: string): Promise<KeyEntry[]> {
  await assertMember(db, actor.userId, projectId);
  const rows = await db`
    select ce.id, ce.kind, ce.title, ce.body, ce.author_id, u.name as author_name, ce.created_at,
           (select o.title from context_entries o where o.id = ce.replaces_id) as replaces_title
    from context_entries ce join users u on u.id = ce.author_id
    where ce.project_id = ${projectId} and ce.visibility = 'project' and ce.kind in ('decision', 'ownership') and ${notReplaced(db)}
    order by ce.created_at desc, ce.id desc`;
  return rows as unknown as KeyEntry[];
}

// The verb for each task event; the object is the task title. `created` and `merged` add a suffix in logEntries.
export const EVENT_TEXT: Record<string, string> = {
  created: 'sent', approved: 'approved', unapproved: 'undid approval of', declined: 'declined', deferred: 'deferred',
  estimated: 'estimated', started: 'started', claimed: 'started', asked: 'asked a question on', answered: 'answered the question on',
  stuck: 'got stuck on', retried: 'retried', finished: 'finished', completed: 'completed', pr_opened: 'opened a PR for',
  pr_closed: 'closed the PR for', merged: 'merged', cancelled: 'cancelled',
  member_removed: 'cancelled', joined: 'joined', left: 'left',
};

export type LogEntry = {
  at: Date; actor: string; agent: boolean; text: string; detail: string | null; event: string; mine: boolean;
  taskId: string | null; workItemId: string | null;
};

// Task events, work updates and project decisions as one stream, newest first. `news` drops the viewer's own rows and the background-agent step events.
async function logEntries(db: Db, viewerId: string, projectId: string, limit: number, opts: { before?: Date; news?: boolean }): Promise<LogEntry[]> {
  // Rows order and page on created_at truncated to ms (all a JS Date holds), and a page never ends inside a ms: rows written
  // in one transaction share a timestamp, and `before` = the last row's `at` with a strict < must not hide the rest.
  const rows = await db`
    with x as (
      (select e.id, date_trunc('milliseconds', e.created_at) as at, u.name as actor_name, e.actor_type = 'agent' as agent, e.event, e.actor_id = ${viewerId} as mine,
              t.title, a.name as assignee_name, r.name as requester_name, null::text as detail, t.id as task_id, null::uuid as work_item_id, e.note
       from task_events e join tasks t on t.id = e.task_id join users u on u.id = e.actor_id
         join users a on a.id = t.assignee_id join users r on r.id = t.requester_id
       where t.project_id = ${projectId})
      union all
      (select wu.id, date_trunc('milliseconds', wu.created_at), u.name, true, 'work_update', wu.author_id = ${viewerId},
              w.key || ': ' || w.title, null, null, wu.summary, null, w.id, null
       from work_updates wu join work_items w on w.id = wu.work_item_id join users u on u.id = wu.author_id
       where w.project_id = ${projectId})
      union all
      (select ce.id, date_trunc('milliseconds', ce.created_at), u.name, true, 'decision', ce.author_id = ${viewerId},
              ce.title, null, null, (select 'Replaces "' || o.title || '"' from context_entries o where o.id = ce.replaces_id), null, null, null
       from context_entries ce join users u on u.id = ce.author_id
       where ce.project_id = ${projectId} and ce.visibility = 'project' and ce.kind = 'decision')
    ), f as (
      select * from x
      where true
        ${opts.before ? db`and x.at < ${opts.before}` : db``}
        ${opts.news ? db`and not x.mine and x.event not in ('claimed', 'asked', 'answered', 'stuck', 'retried', 'finished')` : db``}
    )
    select * from f
    where f.at >= coalesce((select at from f order by at desc, id desc offset ${limit - 1} limit 1), '-infinity')
    order by f.at desc, f.id desc`;
  return rows.map(r => ({
    at: r.at as Date,
    actor: r.agent ? `${r.actorName}'s agent` : (r.actorName as string),
    agent: r.agent as boolean,
    text: r.event === 'work_update' ? `noted progress on ${r.title}`
      : r.event === 'decision' ? `decided: ${r.title}`
      : r.event === 'created' ? `${EVENT_TEXT.created} ${r.title} to ${r.assigneeName}`
      : r.event === 'merged' ? `${EVENT_TEXT.merged} ${r.title} · ${r.requesterName} unblocked`
      : r.event === 'member_removed' ? `${EVENT_TEXT.member_removed} ${r.title} · ${r.note}`
      : `${EVENT_TEXT[r.event] ?? r.event} ${r.title}`,
    detail: r.detail as string | null,
    event: r.event as string,
    mine: r.mine as boolean,
    taskId: r.taskId as string | null,
    workItemId: r.workItemId as string | null,
  }));
}

export async function activityLog(db: Db, actor: Actor, projectId: string, opts: { before?: Date; limit?: number } = {}): Promise<LogEntry[]> {
  await assertMember(db, actor.userId, projectId);
  return logEntries(db, actor.userId, projectId, opts.limit ?? 50, { before: opts.before });
}

export async function overviewNews(db: Db, actor: Actor, projectId: string): Promise<LogEntry[]> {
  await assertMember(db, actor.userId, projectId);
  return (await logEntries(db, actor.userId, projectId, 20, { news: true })).slice(0, 20); // no paging here, so ties at the cut can go
}

export async function dashboardSeenAt(db: Db, actor: Actor, projectId: string): Promise<Date | null> {
  await assertMember(db, actor.userId, projectId);
  const [m] = await db`select dashboard_seen_at from memberships where project_id = ${projectId} and user_id = ${actor.userId}`;
  return m.dashboardSeenAt as Date | null;
}
