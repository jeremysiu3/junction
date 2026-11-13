import type { Db } from './db';
import { findDuplicates } from './duplicates';
import { assertMember, lockUser, resolveAssignee } from './members';
import { LIMITS, nextStatus } from './rules';
import { fold, wrapUntrusted } from './untrusted';
import { getWorkItem } from './work';
import { JunctionError, type Actor, type Task, type TaskAction, type TaskStatus } from './types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cap(field: string, v: string, max: number): string {
  if (v.length > max) throw new JunctionError('validation', `${field} must be at most ${max} characters`);
  return v;
}

function required(field: string, value: string, max: number): string {
  const v = (value ?? '').trim();
  if (!v) throw new JunctionError('validation', `${field} must not be blank`);
  return cap(field, v, max);
}

export async function sendTask(
  db: Db,
  actor: Actor,
  input: { projectId: string; assignee: string; title: string; description: string; blockingReason: string; changes: string[]; notDuplicateReason?: string; repo?: string; fromWorkItemId?: string; fromItem?: string },
): Promise<Task> {
  const title = required('title', input.title, 200);
  const description = required('description', input.description, 5000);
  const blockingReason = required('blocking_reason', input.blockingReason, 1000);
  const changes = Array.isArray(input.changes) ? input.changes.map(c => (typeof c === 'string' ? c.trim() : '')) : [];
  if (changes.length < 1 || changes.length > 5 || changes.some(c => !c || c.length > 100))
    throw new JunctionError('validation', 'changes must be 1-5 short lines, each at most 100 characters');
  await assertMember(db, actor.userId, input.projectId);
  const assignee = await resolveAssignee(db, input.projectId, input.assignee);
  if (assignee.id === actor.userId) throw new JunctionError('validation', 'you cannot send a request to yourself');

  if (input.fromItem && !input.fromWorkItemId) throw new JunctionError('validation', 'not_done_item requires work_item_id');
  let fromItem: string | null = null;
  let repo = (input.repo ?? '').trim();
  if (!input.fromWorkItemId && !repo) throw new JunctionError('validation', 'repo is required');
  if (input.fromWorkItemId) {
    const w = await getWorkItem(db, actor, input.projectId, input.fromWorkItemId);
    if (w.ownerId !== assignee.id) throw new JunctionError('validation', "assignee must be the work item's owner");
    if (repo && repo !== w.repo) throw new JunctionError('validation', "repo must match the work item's repo");
    repo = w.repo;
    // Wrapped output is folded (NFKC, no format chars), so match on the fold and keep the stored original.
    const wanted = fold((input.fromItem ?? '').trim());
    fromItem = w.notDone.find(n => fold(n) === wanted) ?? null;
    if (fromItem === null) throw new JunctionError('validation', "from_item must exactly match one of the work item's not-done entries");
  }
  const fromWorkItemId = input.fromWorkItemId || null;

  const notDuplicateReason = cap('not_duplicate_reason', (input.notDuplicateReason ?? '').trim(), 500) || null;
  // ponytail: runs before the insert, so two simultaneous identical sends can both pass; it's a hint, not an invariant
  const matches = notDuplicateReason ? [] : await findDuplicates(db, input.projectId, title);
  if (matches.length) {
    const lines = matches.map(m => {
      const line = `${m.id} "${m.title}" (${m.status}, from ${m.requesterName} to ${m.assigneeName})`;
      // Wrapped even for your own request: the line also carries the assignee's display name.
      return wrapUntrusted(line) + (m.assigneeId === actor.userId ? ' — already assigned to you' : '');
    });
    const yours = matches.some(m => m.assigneeId === actor.userId)
      ? "A request assigned to you is already yours (it's in your Inbox): don't send it back; work on it once it's approved, or ask the user to decline it in the dashboard.\n" : '';
    throw new JunctionError('duplicate', `Similar open requests:\n${lines.join('\n')}\n${yours}If this is your own request it's already covered. To be told when someone else's request is done, call join_task with its task_id. If yours is really different, call send_task again with not_duplicate_reason saying how.`);
  }

  return db.begin(async tx => {
    await lockUser(tx as unknown as Db, actor.userId);
    const [{ n }] = await tx`select count(*)::int as n from tasks where requester_id = ${actor.userId} and created_at > now() - interval '1 hour'`;
    if (n >= LIMITS.tasksPerHour) throw new JunctionError('limit', `you can send at most ${LIMITS.tasksPerHour} requests an hour; try again later`);
    const [task] = await tx`
      insert into tasks (project_id, requester_id, assignee_id, title, description, blocking_reason, changes, not_duplicate_reason, repo, from_work_item_id, from_item)
      values (${input.projectId}, ${actor.userId}, ${assignee.id}, ${title}, ${description}, ${blockingReason}, ${changes}, ${notDuplicateReason}, ${repo}, ${fromWorkItemId}, ${fromItem})
      returning *`;
    await tx`insert into task_events (task_id, actor_id, actor_type, event) values (${task.id}, ${actor.userId}, ${actor.type}, 'created')`;
    await tx`insert into notifications (user_id, task_id, kind) values (${assignee.id}, ${task.id}, 'new_request')`;
    return task as unknown as Task;
  });
}

// The requester plus everyone who joined the request; they all get the requester's notifications.
const requesterIds = async (tx: Db, task: Task): Promise<string[]> => {
  const co = await tx`select user_id from task_requesters where task_id = ${task.id} order by joined_at`;
  return [task.requesterId, ...co.map(c => c.userId as string)];
};

const notifyAll = async (tx: Db, userIds: string[], taskId: string, kind: string) => {
  for (const userId of userIds) await tx`insert into notifications (user_id, task_id, kind) values (${userId}, ${taskId}, ${kind})`;
};

// A human gets this long to undo an approval; nothing claims or starts the task meanwhile.
export const UNDO_SECONDS = 15;

const approvedWithin = async (tx: Db, taskId: string): Promise<boolean> => {
  const [r] = await tx`
    select exists (select 1 from task_events where task_id = ${taskId} and event = 'approved'
                   and created_at > now() - make_interval(secs => ${UNDO_SECONDS})) as fresh`;
  return r.fresh as boolean;
};

// Guard for claim and start. Runs in `after`, so role and state errors win over this one; a throw rolls the transaction back.
const notInUndoWindow = async (tx: Db, task: Task) => {
  if (await approvedWithin(tx, task.id)) throw new JunctionError('invalid_transition', 'approval can still be undone; try again shortly');
};

type Extra = {
  event: string;
  patch?: Record<string, unknown>;
  note?: string | null;
  notify?: { to: 'requester' | 'assignee'; kind: string };
  after?: (tx: Db, task: Task) => Promise<void>;
};

// projectId is optional: agent tools scope to their project, dashboard actions (approve/decline/defer) have none.
const transition = (db: Db, actor: Actor, taskId: string, action: TaskAction, x: Extra, projectId?: string) =>
  decide(db, actor, taskId, () => [action, x], projectId);

// Like transition, but picks the action and effects from the locked task row.
async function decide(db: Db, actor: Actor, taskId: string, pick: (t: Task) => [TaskAction, Extra], projectId?: string): Promise<Task> {
  if (!UUID.test(taskId)) throw new JunctionError('not_found', 'task not found');
  return db.begin(async tx => {
    const [row] = await tx`select * from tasks where id = ${taskId} ${projectId ? tx`and project_id = ${projectId}` : tx``} for update`;
    if (!row) throw new JunctionError('not_found', 'task not found');
    const current = row as unknown as Task;
    const [action, x] = pick(current);
    const status = nextStatus(current, actor, action);
    const [updated] = await tx`update tasks set ${tx({ status, ...x.patch })}, updated_at = now() where id = ${taskId} returning *`;
    const task = updated as unknown as Task;
    await tx`insert into task_events (task_id, actor_id, actor_type, event, note)
             values (${taskId}, ${actor.userId}, ${actor.type}, ${x.event}, ${x.note ?? null})`;
    if (x.notify) {
      const to = x.notify.to === 'requester' ? await requesterIds(tx as unknown as Db, task) : [task.assigneeId];
      await notifyAll(tx as unknown as Db, to, taskId, x.notify.kind);
    }
    await x.after?.(tx as unknown as Db, task);
    return task;
  });
}

export const addEstimate = (db: Db, actor: Actor, taskId: string, estimateText: string, projectId: string) =>
  transition(db, actor, taskId, 'estimate', { event: 'estimated', patch: { estimateText: required('estimate_text', estimateText, 500) } }, projectId);

export const approveTask = (db: Db, actor: Actor, taskId: string) =>
  transition(db, actor, taskId, 'approve', { event: 'approved', notify: { to: 'requester', kind: 'approved' } });

export const unapproveTask = (db: Db, actor: Actor, taskId: string) =>
  transition(db, actor, taskId, 'unapprove', {
    event: 'unapproved',
    patch: { deferredAt: null }, // an undone approval of a once-deferred task must not show as deferred
    after: async (tx, task) => {
      const [r] = await tx`
        select exists (select 1 from task_events where task_id = ${task.id} and event in ('claimed', 'started')
                       and created_at > (select max(created_at) from task_events where task_id = ${task.id} and event = 'approved')) as worked`;
      if (!(await approvedWithin(tx, task.id)) || r.worked) throw new JunctionError('invalid_transition', 'too late to undo this approval');
      const ids = await requesterIds(tx, task);
      for (const id of ids) {
        const gone = await tx`
          delete from notifications where user_id = ${id} and task_id = ${task.id} and kind = 'approved' and not read returning id`;
        if (!gone.length) await notifyAll(tx, [id], task.id, 'approval_undone');
      }
    },
  });

// async, so an over-long note rejects instead of throwing before a promise exists
export const declineTask = async (db: Db, actor: Actor, taskId: string, note?: string) =>
  transition(db, actor, taskId, 'decline', { event: 'declined', note: cap('note', note ?? '', 1000) || null, notify: { to: 'requester', kind: 'declined' } });

export const deferTask = (db: Db, actor: Actor, taskId: string) =>
  transition(db, actor, taskId, 'defer', { event: 'deferred', patch: { deferredAt: new Date() } });

export const startTask = (db: Db, actor: Actor, taskId: string, projectId: string) =>
  transition(db, actor, taskId, 'start', { event: 'started', after: notInUndoWindow }, projectId);

export const cancelTask = (db: Db, actor: Actor, taskId: string, projectId: string) =>
  transition(db, actor, taskId, 'cancel', {
    event: 'cancelled',
    notify: { to: 'assignee', kind: 'cancelled' },
    after: async (tx, task) => notifyAll(tx, (await requesterIds(tx, task)).slice(1), task.id, 'cancelled'), // co-requesters; the requester is the actor
  }, projectId);

const BRANCH = /^[A-Za-z0-9._/-]+$/;
const STOP_WORDS = new Set(['a', 'an', 'the', 'to', 'for', 'of', 'on', 'in', 'and', 'with']);
const SLUG_MAX = 24;

// The part after `junction/`: the first 3 non-stop words of the title, at most 24 characters, cut at a word boundary.
export function branchSlug(title: string): string {
  const words = (title.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(w => !STOP_WORDS.has(w)).slice(0, 3);
  while (words.length > 1 && words.join('-').length > SLUG_MAX) words.pop();
  return words.join('-').slice(0, SLUG_MAX) || 'task';
}

// An existing branch is kept. Otherwise pick junction/<slug>, then -2, -3 ... for this project and repo.
// ponytail: concurrent claims of same-titled tasks can pick the same name; the unique index makes the loser fail, and its next poll retries.
const nameBranch = async (tx: Db, task: Task) => {
  if (task.branch) return;
  const base = `junction/${branchSlug(task.title)}`;
  const taken = new Set((await tx`
    select branch from tasks
    where project_id = ${task.projectId} and repo is not distinct from ${task.repo} and (branch = ${base} or branch like ${base + '-%'})`).map(r => r.branch as string));
  let branch = base;
  for (let n = 2; taken.has(branch); n++) branch = `${base}-${n}`;
  await tx`update tasks set branch = ${branch} where id = ${task.id}`;
  task.branch = branch;
};

export const claimTask = (db: Db, actor: Actor, taskId: string, projectId: string) =>
  transition(db, actor, taskId, 'claim', {
    event: 'claimed',
    patch: { background: true },
    after: async (tx, task) => {
      await notInUndoWindow(tx, task);
      await nameBranch(tx, task);
    },
  }, projectId);

export async function askQuestion(db: Db, actor: Actor, taskId: string, question: string, projectId: string): Promise<Task> {
  const q = required('question', question, 2000);
  return transition(db, actor, taskId, 'ask', {
    event: 'asked',
    notify: { to: 'assignee', kind: 'needs_input' },
    after: async (tx, task) => {
      await tx`insert into task_questions (task_id, question) values (${task.id}, ${q})`;
    },
  }, projectId);
}

export async function answerQuestion(db: Db, actor: Actor, taskId: string, answer: string, projectId: string): Promise<Task> {
  const a = required('answer', answer, 2000);
  return transition(db, actor, taskId, 'answer', {
    event: 'answered',
    after: async (tx, task) => {
      const done = await tx`
        update task_questions set answer = ${a}, answered_by = ${actor.userId}, answered_actor_type = ${actor.type}, answered_at = now()
        where id = (select id from task_questions where task_id = ${task.id} and answer is null order by created_at desc, id desc limit 1)
        returning id`;
      if (!done.length) throw new JunctionError('invalid_transition', 'no open question');
    },
  }, projectId);
}

export async function markStuck(db: Db, actor: Actor, taskId: string, reason: string, projectId: string): Promise<Task> {
  const r = required('reason', reason, 2000);
  return transition(db, actor, taskId, 'stuck', {
    event: 'stuck', note: r, patch: { stuckReason: r }, notify: { to: 'assignee', kind: 'stuck' },
  }, projectId);
}

export const retryTask = (db: Db, actor: Actor, taskId: string, projectId: string) =>
  transition(db, actor, taskId, 'retry', { event: 'retried', patch: { stuckReason: null } }, projectId);

export async function completeTask(
  db: Db,
  actor: Actor,
  taskId: string,
  evidence: { evidenceUrl?: string; evidenceNote?: string; branch?: string },
  projectId: string,
): Promise<Task> {
  const note = cap('evidence_note', evidence.evidenceNote?.trim() ?? '', 2000) || null;
  const url = cap('evidence_url', evidence.evidenceUrl?.trim() ?? '', 2000) || null;
  const branch = evidence.branch?.trim() || null;
  if (url && !/^https?:\/\//.test(url)) throw new JunctionError('validation', 'evidence_url must start with http:// or https://');
  if (!note && !url) throw new JunctionError('validation', 'evidence requires an evidence_note or an evidence_url');
  if (branch && (!BRANCH.test(branch) || branch.includes('..'))) throw new JunctionError('validation', 'branch must match [A-Za-z0-9._/-]+ and not contain ..');
  return decide(db, actor, taskId, t => {
    const patch = { evidenceUrl: url, evidenceNote: note };
    if (branch && t.branch && branch !== t.branch) throw new JunctionError('validation', `branch must be ${t.branch}`);
    if (branch || t.branch) {
      return ['finish', { event: 'finished', patch: { ...patch, branch: branch ?? t.branch }, notify: { to: 'assignee', kind: 'ready_for_review' } }];
    }
    return ['complete', { event: 'completed', patch, after: (tx, task) => deliver(tx, task, null) }];
  }, projectId).catch(e => {
    // the unique (project, repo, branch) index: another task already holds this branch
    if (e?.code === '23505') throw new JunctionError('validation', 'branch is already used by another task');
    throw e;
  });
}

export async function reportPr(
  db: Db,
  actor: Actor,
  taskId: string,
  report: { prUrl: string; state: 'open' | 'merged' | 'closed' },
  projectId: string,
): Promise<Task> {
  const prUrl = (report.prUrl ?? '').trim();
  if (!/^https:\/\/\S+$/.test(prUrl)) throw new JunctionError('validation', 'pr_url must be an https:// URL');
  switch (report.state) {
    case 'open':
      return transition(db, actor, taskId, 'pr_open', { event: 'pr_opened', patch: { evidenceUrl: prUrl }, notify: { to: 'requester', kind: 'preview' } }, projectId);
    case 'closed':
      return transition(db, actor, taskId, 'pr_closed', { event: 'pr_closed' }, projectId);
    case 'merged':
      return transition(db, actor, taskId, 'merge', { event: 'merged', patch: { evidenceUrl: prUrl }, after: (tx, task) => deliver(tx, task, prUrl) }, projectId);
    default:
      throw new JunctionError('validation', 'state must be one of open, merged, closed');
  }
}

// Runs inside the transition's transaction, after the task row is updated.
async function deliver(tx: Db, task: Task, prUrl: string | null): Promise<void> {
  await notifyAll(tx, await requesterIds(tx, task), task.id, 'unblocked');
  await tx`insert into context_entries (project_id, author_id, kind, title, body, visibility, related_task_id)
           values (${task.projectId}, ${task.assigneeId}, 'update', ${'Completed: ' + task.title},
                   ${[task.evidenceNote, task.evidenceUrl].filter(Boolean).join('\n')}, 'project', ${task.id})`;

  if (task.branch) {
    const [w] = await tx`
      update work_items set status = 'merged', last_activity_at = now()
      where project_id = ${task.projectId} and owner_id = ${task.assigneeId} and repo = ${task.repo} and key = ${task.branch}
      returning id, done, not_done`;
    if (w) {
      await tx`insert into work_updates (work_item_id, author_id, summary, status, done, not_done)
               values (${w.id}, ${task.assigneeId}, ${prUrl ? `Merged via ${prUrl}` : `Delivered: ${task.title}`}, 'merged', ${tx.json(w.done)}, ${tx.json(w.notDone)})`;
    }
  }

  if (task.fromWorkItemId && task.fromItem) {
    const [w] = await tx`select id, status, done, not_done from work_items where id = ${task.fromWorkItemId} for update`;
    // ponytail: skip when the owner already removed the item from not_done; nothing left to move
    if (w && (w.notDone as string[]).includes(task.fromItem)) {
      const notDone = (w.notDone as string[]).filter(t => t !== task.fromItem);
      const done = [...(w.done as { text: string; evidence: string | null }[]), { text: task.fromItem, evidence: prUrl }];
      const searchText = [...done.map(d => d.text), ...notDone].join(' ');
      await tx`update work_items set done = ${tx.json(done)}, not_done = ${tx.json(notDone)}, search_text = ${searchText}, last_activity_at = now()
               where id = ${w.id}`;
      await tx`insert into work_updates (work_item_id, author_id, summary, status, done, not_done)
               values (${w.id}, ${task.assigneeId}, ${`Delivered: ${task.fromItem}`}, ${w.status}, ${tx.json(done)}, ${tx.json(notDone)})`;
    }
  }
}

// Prompt text for the headless agent. Each question is wrapped (the headless agent wrote it); the answers are the assignee's own words, so they stay outside.
export function taskBrief(task: Task, requesterName: string, questions: { question: string; answer: string | null }[]): string {
  const brief = wrapUntrusted(
    `Request from ${requesterName}: ${task.title}\n\n${task.description}\n\n${task.changes ? `Proposed changes:\n${task.changes.map(c => `- ${c}`).join('\n')}\n\n` : ''}Why they're blocked: ${task.blockingReason}`);
  const answered = questions.filter(q => q.answer);
  if (!answered.length) return brief;
  return `${brief}\n\nQuestions you asked and the answers:\n${answered.map(q => `Q: ${wrapUntrusted(q.question)}\nA: ${q.answer}`).join('\n')}`;
}

export async function workerQueue(db: Db, actor: Actor, projectId: string) {
  await assertMember(db, actor.userId, projectId);
  const [you] = await db`select id, name from users where id = ${actor.userId}`;
  const approved = await db`
    select t.*, r.name as requester_name from tasks t join users r on r.id = t.requester_id
    where t.project_id = ${projectId} and t.assignee_id = ${actor.userId} and t.status = 'approved'
      and not exists (select 1 from task_events e where e.task_id = t.id and e.event = 'approved'
                      and e.created_at > now() - make_interval(secs => ${UNDO_SECONDS}))
    order by t.created_at, t.id`;
  const questions = approved.length
    ? await db`select task_id, question, answer from task_questions where task_id in ${db(approved.map(t => t.id))} order by created_at, id`
    : [];
  const mine = await db`
    select id, title, status, repo, branch, background from tasks
    where project_id = ${projectId} and assignee_id = ${actor.userId}
      and status in ('in_progress', 'needs_input', 'stuck', 'ready_for_review', 'in_review')
      and (background or branch is not null)
    order by created_at, id`;
  return {
    you: { id: you.id as string, name: you.name as string },
    approved: approved.map(t => ({
      id: t.id as string,
      title: t.title as string,
      repo: t.repo as string | null,
      branch: t.branch as string | null,
      brief: taskBrief(t as unknown as Task, t.requesterName as string, questions.filter(q => q.taskId === t.id) as unknown as { question: string; answer: string | null }[]),
    })),
    mine: mine as unknown as { id: string; title: string; status: TaskStatus; repo: string | null; branch: string | null; background: boolean }[],
  };
}

export async function getTaskDetail(db: Db, actor: Actor, projectId: string, taskId: string) {
  await assertMember(db, actor.userId, projectId);
  if (!UUID.test(taskId)) throw new JunctionError('not_found', 'task not found');
  const [row] = await db`
    select t.*, r.name as requester_name, a.name as assignee_name
    from tasks t join users r on r.id = t.requester_id join users a on a.id = t.assignee_id
    where t.id = ${taskId} and t.project_id = ${projectId}`;
  if (!row) throw new JunctionError('not_found', 'task not found');
  const events = await db`
    select e.event, e.note, e.actor_type, u.name as actor_name, e.created_at
    from task_events e join users u on u.id = e.actor_id
    where e.task_id = ${taskId} order by e.created_at, e.id`;
  const questions = await db`
    select question, answer, created_at, answered_at from task_questions where task_id = ${taskId} order by created_at, id`;
  const coRequesters = await db`
    select u.name from task_requesters tr join users u on u.id = tr.user_id where tr.task_id = ${taskId} order by tr.joined_at, u.name`;
  const { requesterName, assigneeName, ...task } = row;
  return {
    task: task as unknown as Task,
    requesterName: requesterName as string,
    assigneeName: assigneeName as string,
    coRequesterNames: coRequesters.map((r) => r.name as string),
    events: events as unknown as { event: string; note: string | null; actorType: 'agent' | 'human'; actorName: string; createdAt: Date }[],
    questions: questions as unknown as { question: string; answer: string | null; createdAt: Date; answeredAt: Date | null }[],
  };
}
