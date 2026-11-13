import type { Db } from './db';
import { assertMember } from './members';
import { OPEN } from './rules';
import { JunctionError, type Actor, type Task, type TaskStatus } from './types';

// pg_trgm similarity of lowercased titles; tuned against the pinned examples in duplicates.test.ts.
export const DUPLICATE_THRESHOLD = 0.45;

export async function findDuplicates(db: Db, projectId: string, title: string) {
  const rows = await db`
    select t.id, t.title, t.status, t.requester_id, t.assignee_id, r.name as requester_name, a.name as assignee_name, t.changes
    from tasks t join users r on r.id = t.requester_id join users a on a.id = t.assignee_id
    where t.project_id = ${projectId} and t.status in ${db(OPEN)}
      and extensions.similarity(lower(t.title), lower(${title})) >= ${DUPLICATE_THRESHOLD}
    order by extensions.similarity(lower(t.title), lower(${title})) desc, t.created_at
    limit 3`;
  return rows as unknown as {
    id: string; title: string; status: TaskStatus; requesterId: string; assigneeId: string; requesterName: string; assigneeName: string; changes: string[] | null;
  }[];
}

export async function joinTask(db: Db, actor: Actor, taskId: string, projectId: string): Promise<Task> {
  await assertMember(db, actor.userId, projectId);
  return db.begin(async tx => {
    const [task] = await tx`select * from tasks where id::text = ${taskId} and project_id = ${projectId} for update`;
    if (!task) throw new JunctionError('not_found', 'task not found');
    if (!OPEN.includes(task.status)) throw new JunctionError('validation', `cannot join a task that is ${task.status}`);
    if (task.requesterId === actor.userId || task.assigneeId === actor.userId)
      throw new JunctionError('validation', 'you are already the requester or the assignee of this request');
    const joined = await tx`
      insert into task_requesters (task_id, user_id) values (${task.id}, ${actor.userId}) on conflict do nothing returning 1`;
    if (!joined.length) throw new JunctionError('validation', 'you have already joined this request');
    await tx`insert into task_events (task_id, actor_id, actor_type, event) values (${task.id}, ${actor.userId}, ${actor.type}, 'joined')`;
    return task as unknown as Task;
  });
}

export async function leaveTask(db: Db, actor: Actor, taskId: string, projectId: string): Promise<Task> {
  await assertMember(db, actor.userId, projectId);
  return db.begin(async tx => {
    const [task] = await tx`select * from tasks where id::text = ${taskId} and project_id = ${projectId} for update`;
    if (!task) throw new JunctionError('not_found', 'task not found');
    const left = await tx`delete from task_requesters where task_id = ${task.id} and user_id = ${actor.userId} returning 1`;
    if (!left.length) throw new JunctionError('validation', 'you have not joined this request');
    await tx`insert into task_events (task_id, actor_id, actor_type, event) values (${task.id}, ${actor.userId}, ${actor.type}, 'left')`;
    return task as unknown as Task;
  });
}
