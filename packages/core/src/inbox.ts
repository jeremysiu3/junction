import { openQuestion } from './dashboard';
import { entryCols, notReplaced, type ContextEntryWithAuthor } from './context';
import type { Db } from './db';
import { assertMember } from './members';
import { OPEN } from './rules';
import type { Actor, Task, WorkStatus } from './types';
import { toWorkItemView, workViewSelect } from './work';

export async function checkInbox(db: Db, actor: Actor, projectId: string, opts: { peek?: boolean } = {}) {
  await assertMember(db, actor.userId, projectId);
  return db.begin(async tx => {
    const tasks = await tx`
      select t.*, r.name as requester_name,
             ${openQuestion(tx as unknown as Db)} as open_question
      from tasks t join users r on r.id = t.requester_id
      where t.project_id = ${projectId} and t.assignee_id = ${actor.userId}
        and t.status in ${tx(OPEN)}
      order by t.created_at`;
    const [you] = await tx`select id, name from users where id = ${actor.userId}`;
    const notifications = await tx`
      select n.id, n.kind, n.task_id, t.title as task_title, n.created_at,
             (select e.note from task_events e where e.task_id = n.task_id and e.event = 'declined'
              order by e.created_at desc, e.id desc limit 1) as note
      from notifications n join tasks t on t.id = n.task_id
      where n.user_id = ${actor.userId} and t.project_id = ${projectId} and not n.read
      order by n.created_at`;
    const whatsNew = await tx`
      select ${entryCols(tx as unknown as Db)}
      from context_entries ce join users u on u.id = ce.author_id
      where ce.project_id = ${projectId} and ce.author_id <> ${actor.userId}
        and ce.visibility = 'project' and ce.kind in ('update', 'decision')
        and ${notReplaced(tx as unknown as Db)}
        and ce.created_at > coalesce(
          (select last_checked_at from memberships where project_id = ${projectId} and user_id = ${actor.userId}), '-infinity')
      order by ce.created_at desc
      limit 20`;
    const workUpdates = await tx`
      select wu.work_item_id, w.repo, w.key, w.title, u.name as owner_name, wu.summary, wu.status, wu.created_at
      from work_updates wu join work_items w on w.id = wu.work_item_id join users u on u.id = wu.author_id
      where w.project_id = ${projectId} and wu.author_id <> ${actor.userId}
        and wu.created_at > coalesce(
          (select last_checked_at from memberships where project_id = ${projectId} and user_id = ${actor.userId}), '-infinity')
      order by wu.created_at desc
      limit 20`;
    const replacedDecisions = await tx`
      select o.id, o.title, n.id as replaced_by_id, n.title as replaced_by_title, u.name as replaced_by_author
      from context_entries n join context_entries o on o.id = n.replaces_id join users u on u.id = n.author_id
      where n.project_id = ${projectId} and n.visibility = 'project' and o.author_id = ${actor.userId} and n.author_id <> ${actor.userId}
        and n.created_at > coalesce(
          (select last_checked_at from memberships where project_id = ${projectId} and user_id = ${actor.userId}), '-infinity')
      order by n.created_at desc`;
    const staleWork = (
      await tx`${workViewSelect(tx as unknown as Db)} where w.project_id = ${projectId} and w.status = 'in_progress'`
    ).map(toWorkItemView).filter(w => w.stale);
    // Read before the update: the briefing shows once per membership, even on peek.
    const [{ briefedAt }] = await tx`select briefed_at from memberships where project_id = ${projectId} and user_id = ${actor.userId} for update`;
    await tx`update memberships set briefed_at = now() where project_id = ${projectId} and user_id = ${actor.userId} and briefed_at is null`;
    if (!opts.peek) {
      if (notifications.length) await tx`update notifications set read = true where id in ${tx(notifications.map(n => n.id))}`;
      await tx`update memberships set last_checked_at = now() where project_id = ${projectId} and user_id = ${actor.userId}`;
    }
    return {
      you: { id: you.id as string, name: you.name as string },
      firstSession: briefedAt === null,
      tasks: tasks as unknown as (Task & { requesterName: string; openQuestion: string | null })[],
      notifications: notifications.map(n => ({ kind: n.kind as string, taskId: n.taskId as string, taskTitle: n.taskTitle as string, createdAt: n.createdAt as Date, note: n.kind === 'declined' ? (n.note as string | null) : null })),
      whatsNew: whatsNew as unknown as ContextEntryWithAuthor[],
      workUpdates: workUpdates as unknown as {
        workItemId: string; repo: string; key: string; title: string; ownerName: string;
        summary: string; status: WorkStatus; createdAt: Date;
      }[],
      staleWork,
      replacedDecisions: replacedDecisions.map(r => ({
        id: r.id as string,
        title: r.title as string,
        replacedBy: { id: r.replacedById as string, title: r.replacedByTitle as string, authorName: r.replacedByAuthor as string },
      })),
    };
  });
}

export async function markDashboardSeen(db: Db, actor: Actor, projectId: string): Promise<void> {
  await assertMember(db, actor.userId, projectId);
  await db`update memberships set dashboard_seen_at = now() where project_id = ${projectId} and user_id = ${actor.userId}`;
}

export async function getBoard(db: Db, actor: Actor, projectId: string) {
  await assertMember(db, actor.userId, projectId);
  const rows = await db`
    select t.id as task_id, t.title, t.status, r.name as requester_name, a.name as assignee_name,
           t.estimate_text, t.deferred_at, t.changes
    from tasks t join users r on r.id = t.requester_id join users a on a.id = t.assignee_id
    where t.project_id = ${projectId} and t.status in ${db(OPEN)}
    order by t.created_at, t.id`;
  return rows as unknown as {
    taskId: string; title: string; status: Task['status']; requesterName: string; assigneeName: string;
    estimateText: string | null; deferredAt: Date | null; changes: string[] | null;
  }[];
}

export async function pendingApprovals(db: Db, actor: Actor) {
  const rows = await db`
    select t.*, p.name as project_name, r.name as requester_name, w.key as from_work_item_key, wo.name as from_work_item_owner,
           array(select u.name from task_requesters tr join users u on u.id = tr.user_id where tr.task_id = t.id order by tr.joined_at, u.name) as co_requester_names
    from tasks t join projects p on p.id = t.project_id join users r on r.id = t.requester_id
      left join work_items w on w.id = t.from_work_item_id left join users wo on wo.id = w.owner_id
    where t.assignee_id = ${actor.userId} and t.status = 'pending_approval'
    order by t.created_at`;
  return rows as unknown as (Task & { projectName: string; requesterName: string; fromWorkItemKey: string | null; fromWorkItemOwner: string | null; coRequesterNames: string[]; notDuplicateReason: string | null })[];
}

export async function projectsFor(db: Db, userId: string) {
  const rows = await db`
    select p.id, p.slug, p.name from projects p join memberships m on m.project_id = p.id
    where m.user_id = ${userId} order by p.name`;
  return rows as unknown as { id: string; slug: string; name: string }[];
}
