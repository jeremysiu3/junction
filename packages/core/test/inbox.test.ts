import { afterAll, describe, expect, it } from 'vitest';
import {
  JunctionError, answerQuestion, askQuestion, claimTask, checkInbox, completeTask, createDb, deferTask, getBoard, pendingApprovals,
  projectForMember, markDashboardSeen, recordWork, sendTask, startTask, writeContext, cancelTask, declineTask, markStuck, reportPr,
} from '../src';
import { agent, approveAged, human, makeProject } from './fixtures';

const db = createDb();
afterAll(() => db.end());

const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: JunctionError) => e.code);
const send = (p: Awaited<ReturnType<typeof makeProject>>, from: 'jeremy' | 'jaxon', to: string, title = 'Build X') =>
  sendTask(db, agent(p[from]), { projectId: p.project.id, assignee: to, title, description: 'd', blockingReason: 'r', repo: 'site', changes: ['Change one thing'] });

describe('checkInbox', () => {
  it('shows pending task and new_request once', async () => {
    const p = await makeProject(db);
    const t = await send(p, 'jeremy', 'Jaxon');
    const first = await checkInbox(db, agent(p.jaxon), p.project.id);
    expect(first.tasks.map(x => x.id)).toEqual([t.id]);
    expect(first.tasks[0].requesterName).toBe('Jeremy');
    expect(first.notifications).toMatchObject([{ kind: 'new_request', taskId: t.id, taskTitle: 'Build X' }]);
    const second = await checkInbox(db, agent(p.jaxon), p.project.id);
    expect(second.notifications).toHaveLength(0);
  });

  it('firstSession is true once, even when the first check is a peek', async () => {
    const p = await makeProject(db);
    expect((await checkInbox(db, agent(p.jaxon), p.project.id, { peek: true })).firstSession).toBe(true);
    expect((await checkInbox(db, agent(p.jaxon), p.project.id, { peek: true })).firstSession).toBe(false);
    expect((await checkInbox(db, agent(p.jaxon), p.project.id)).firstSession).toBe(false);
  });

  it('checkInbox peek leaves notifications unread and last_checked_at unchanged', async () => {
    const p = await makeProject(db);
    const t = await send(p, 'jeremy', 'Jaxon');
    const checked = () => db`select last_checked_at from memberships where project_id = ${p.project.id} and user_id = ${p.jaxon.id}`;
    const before = await checked();
    const peeked = await checkInbox(db, agent(p.jaxon), p.project.id, { peek: true });
    expect(peeked.notifications).toMatchObject([{ kind: 'new_request', taskId: t.id }]);
    expect(await checked()).toEqual(before);
    const real = await checkInbox(db, agent(p.jaxon), p.project.id);
    expect(real.notifications).toMatchObject([{ kind: 'new_request', taskId: t.id }]);
    expect(await checked()).not.toEqual(before);
  });

  it("whatsNew shows others' project updates and decisions once, never own or private", async () => {
    const p = await makeProject(db);
    const t = await send(p, 'jeremy', 'Jaxon');
    await approveAged(db, human(p.jaxon), t.id);
    await startTask(db, agent(p.jaxon), t.id, p.project.id);
    await completeTask(db, agent(p.jaxon), t.id, { evidenceNote: 'done' }, p.project.id);
    await writeContext(db, agent(p.jaxon), { projectId: p.project.id, kind: 'decision', title: 'Use REST', body: 'b' });
    await writeContext(db, agent(p.jaxon), { projectId: p.project.id, kind: 'note', title: 'private note', body: 'b', visibility: 'private' });
    await writeContext(db, agent(p.jeremy), { projectId: p.project.id, kind: 'decision', title: 'Mine', body: 'b' });
    const first = await checkInbox(db, agent(p.jeremy), p.project.id);
    expect(first.whatsNew.map(e => e.title).sort()).toEqual(['Completed: Build X', 'Use REST']);
    expect(first.whatsNew[0].authorName).toBe('Jaxon');
    expect((await checkInbox(db, agent(p.jeremy), p.project.id)).whatsNew).toHaveLength(0);
  });

  it('rejects a non-member', async () => {
    const p = await makeProject(db);
    const other = await makeProject(db);
    expect(await code(checkInbox(db, agent(other.jeremy), p.project.id))).toBe('forbidden');
  });
});

describe('replacedDecisions', () => {
  it("lists my decisions others replaced once; whatsNew drops replaced decisions", async () => {
    const p = await makeProject(db);
    const old = await writeContext(db, agent(p.jeremy), { projectId: p.project.id, kind: 'decision', title: 'Use queue', body: 'b' });
    await checkInbox(db, agent(p.jeremy), p.project.id);
    const next = await writeContext(db, agent(p.jaxon), { projectId: p.project.id, kind: 'decision', title: 'Use stream', body: 'b2', replaces: old.id });
    const first = await checkInbox(db, agent(p.jeremy), p.project.id);
    expect(first.replacedDecisions).toEqual([
      { id: old.id, title: 'Use queue', replacedBy: { id: next.id, title: 'Use stream', authorName: 'Jaxon' } },
    ]);
    expect(first.whatsNew.map(e => e.id)).toEqual([next.id]);
    expect(first.whatsNew[0].replaces).toMatchObject({ id: old.id, title: 'Use queue' });
    expect((await checkInbox(db, agent(p.jeremy), p.project.id)).replacedDecisions).toEqual([]);
    // replacing your own decision is not news to you
    const own = await writeContext(db, agent(p.jeremy), { projectId: p.project.id, kind: 'decision', title: 'Mine', body: 'b' });
    await writeContext(db, agent(p.jeremy), { projectId: p.project.id, kind: 'decision', title: 'Mine v2', body: 'b', replaces: own.id });
    expect((await checkInbox(db, agent(p.jeremy), p.project.id)).replacedDecisions).toEqual([]);
  });
});

describe('work in inbox and feed', () => {
  const work = (p: Awaited<ReturnType<typeof makeProject>>, who: 'jeremy' | 'jaxon', summary = 's') =>
    recordWork(db, agent(p[who]), { projectId: p.project.id, repo: 'site', key: 'feat/x', title: 'X', summary, done: [], notDone: [] });

  it("Jeremy sees Jaxon's work update once; staleWork lists Jaxon's stale item", async () => {
    const p = await makeProject(db);
    const w = await work(p, 'jaxon');
    await work(p, 'jeremy');
    const first = await checkInbox(db, agent(p.jeremy), p.project.id);
    expect(first.workUpdates).toMatchObject([{ workItemId: w.id, repo: 'site', key: 'feat/x', title: 'X', ownerName: 'Jaxon', summary: 's', status: 'in_progress' }]);
    expect(first.staleWork).toEqual([]);
    expect((await checkInbox(db, agent(p.jeremy), p.project.id)).workUpdates).toEqual([]);
    await db`update work_items set last_activity_at = now() - interval '30 days' where id = ${w.id}`;
    expect((await checkInbox(db, agent(p.jeremy), p.project.id)).staleWork.map(x => x.id)).toEqual([w.id]);
  });

  it('markDashboardSeen and checkInbox keep independent markers', async () => {
    const p = await makeProject(db);
    await work(p, 'jaxon', 'jaxon progress');
    await checkInbox(db, agent(p.jeremy), p.project.id);
    await work(p, 'jaxon', 'later');
    await markDashboardSeen(db, human(p.jeremy), p.project.id);
    expect((await checkInbox(db, agent(p.jeremy), p.project.id)).workUpdates.map(u => u.summary)).toEqual(['later']);

    await work(p, 'jaxon', 'newest');
    await markDashboardSeen(db, human(p.jeremy), p.project.id);
    expect((await checkInbox(db, agent(p.jeremy), p.project.id)).workUpdates.map(u => u.summary)).toEqual(['newest']);
  });
});

describe('getBoard', () => {
  it('excludes closed tasks and shows deferredAt', async () => {
    const p = await makeProject(db);
    const open = await send(p, 'jeremy', 'Jaxon', 'open');
    const deferred = await send(p, 'jeremy', 'Jaxon', 'deferred');
    await deferTask(db, human(p.jaxon), deferred.id);
    const done = await send(p, 'jeremy', 'Jaxon', 'done');
    await approveAged(db, human(p.jaxon), done.id);
    await startTask(db, agent(p.jaxon), done.id, p.project.id);
    await completeTask(db, agent(p.jaxon), done.id, { evidenceNote: 'ok' }, p.project.id);
    const declined = await send(p, 'jeremy', 'Jaxon', 'declined');
    await declineTask(db, human(p.jaxon), declined.id);
    const cancelled = await send(p, 'jeremy', 'Jaxon', 'cancelled');
    await cancelTask(db, agent(p.jeremy), cancelled.id, p.project.id);

    const board = await getBoard(db, agent(p.scott), p.project.id);
    expect(board.map(r => r.title)).toEqual(['open', 'deferred']);
    expect(board[0]).toMatchObject({ requesterName: 'Jeremy', assigneeName: 'Jaxon', taskId: open.id, deferredAt: null });
    expect(board[1].deferredAt).toBeInstanceOf(Date);
  });
});

describe('automation reads', () => {
  const claimed = async (title = 'Build X') => {
    const p = await makeProject(db);
    const t = await send(p, 'jeremy', 'Jaxon', title);
    await approveAged(db, human(p.jaxon), t.id);
    await claimTask(db, agent(p.jaxon), t.id, p.project.id);
    return { p, t };
  };

  it('check_inbox returns you and the open question for a needs_input task', async () => {
    const { p, t } = await claimed();
    await askQuestion(db, agent(p.jaxon), t.id, 'Which db?', p.project.id);
    const inbox = await checkInbox(db, agent(p.jaxon), p.project.id);
    expect(inbox.you).toEqual({ id: p.jaxon.id, name: 'Jaxon' });
    expect(inbox.tasks).toMatchObject([{ id: t.id, status: 'needs_input', background: true, openQuestion: 'Which db?', stuckReason: null, repo: 'site' }]);
    expect(inbox.tasks[0].branch).toMatch(/^junction\//);
    await answerQuestion(db, agent(p.jaxon), t.id, 'pg', p.project.id);
    expect((await checkInbox(db, agent(p.jaxon), p.project.id)).tasks[0].openQuestion).toBeNull();
  });

  it('getBoard lists a ready_for_review task', async () => {
    const { p, t } = await claimed();
    await completeTask(db, agent(p.jaxon), t.id, { evidenceNote: 'pushed' }, p.project.id);
    const board = await getBoard(db, agent(p.scott), p.project.id);
    expect(board).toMatchObject([{ taskId: t.id, status: 'ready_for_review' }]);
  });
});

describe('getBoard automation states', () => {
  it('lists needs_input, stuck and in_review tasks, and drops a merged one', async () => {
    const p = await makeProject(db);
    const task = async (title: string) => {
      const t = await send(p, 'jeremy', 'Jaxon', title);
      await approveAged(db, human(p.jaxon), t.id);
      await claimTask(db, agent(p.jaxon), t.id, p.project.id);
      return t;
    };
    const ask = await task('ask');
    await askQuestion(db, agent(p.jaxon), ask.id, 'Which db?', p.project.id);
    const stuck = await task('stuck');
    await markStuck(db, agent(p.jaxon), stuck.id, 'no creds', p.project.id);
    const review = await task('review');
    await completeTask(db, agent(p.jaxon), review.id, { evidenceNote: 'n' }, p.project.id);
    await reportPr(db, agent(p.jaxon), review.id, { prUrl: 'https://github.com/o/r/pull/1', state: 'open' }, p.project.id);
    const merged = await task('merged');
    await completeTask(db, agent(p.jaxon), merged.id, { evidenceNote: 'n' }, p.project.id);
    await reportPr(db, agent(p.jaxon), merged.id, { prUrl: 'https://github.com/o/r/pull/2', state: 'merged' }, p.project.id);

    const board = await getBoard(db, agent(p.scott), p.project.id);
    expect(board.map(r => [r.title, r.status])).toEqual([['ask', 'needs_input'], ['stuck', 'stuck'], ['review', 'in_review']]);
  });
});

describe('pendingApprovals', () => {
  it("returns only the user's pending tasks, with projectName", async () => {
    const p = await makeProject(db);
    const mine = await send(p, 'jeremy', 'Jaxon');
    await send(p, 'jaxon', 'Jeremy', 'for jeremy');
    const rows = await pendingApprovals(db, human(p.jaxon));
    expect(rows.map(r => r.id)).toEqual([mine.id]);
    expect(rows[0]).toMatchObject({ projectName: 'Test project', requesterName: 'Jeremy', fromWorkItemKey: null, fromWorkItemOwner: null });
  });

  it('includes the source work item key and owner for a request from a not-done item', async () => {
    const p = await makeProject(db);
    const w = await recordWork(db, agent(p.jaxon), { projectId: p.project.id, repo: 'site', key: 'feat/site-ui', title: 'Site UI', summary: 's', done: [], notDone: ['Contact form backend'] });
    await sendTask(db, agent(p.jeremy), { projectId: p.project.id, assignee: 'Jaxon', title: 'T', description: 'd', blockingReason: 'r', repo: 'site', changes: ['Change one thing'], fromWorkItemId: w.id, fromItem: 'Contact form backend' });
    const [row] = await pendingApprovals(db, human(p.jaxon));
    expect(row).toMatchObject({ fromWorkItemId: w.id, fromItem: 'Contact form backend', fromWorkItemKey: 'feat/site-ui', fromWorkItemOwner: 'Jaxon' });
  });
});

describe('auth lookups', () => {
  it('projectForMember', async () => {
    const p = await makeProject(db);
    const other = await makeProject(db);
    expect(await projectForMember(db, p.jaxon.id, p.project.slug)).toEqual(p.project);
    expect(await code(projectForMember(db, p.jaxon.id, 'no-such-slug'))).toBe('not_found');
    expect(await code(projectForMember(db, p.jaxon.id, other.project.slug))).toBe('forbidden');
  });
});
