import { afterAll, describe, expect, it, test } from 'vitest';
import {
  JunctionError, EVENT_TEXT, activityLog, agentPanel, answerQuestion, askQuestion, badgeCounts, boardColumns, cancelTask, claimTask, completeTask, createDb,
  dashboardSeenAt, declineTask, keyContext, markDashboardSeen, markStuck, overviewNews, recordWork, removeMember, reportPr, sendTask, setStaleDays, startTask,
  writeContext,
  type TaskStatus,
} from '../src';
import { agent, approveAged, human, makeProject } from './fixtures';

const db = createDb();
afterAll(() => db.end());

type P = Awaited<ReturnType<typeof makeProject>>;
const send = (p: P, title = 'Build X', over: object = {}) =>
  sendTask(db, agent(p.jeremy), {
    projectId: p.project.id, assignee: 'Jaxon', title, description: 'Please build', blockingReason: 'Need it', repo: 'site', changes: ['One change'], ...over,
  });
const approved = async (p: P, title?: string, over: object = {}) => {
  const t = await send(p, title, over);
  await approveAged(db, human(p.jaxon), t.id);
  return t;
};
const claimed = async (p: P, title?: string) => {
  const t = await approved(p, title);
  await claimTask(db, agent(p.jaxon), t.id, p.project.id);
  return t;
};
const code = (x: Promise<unknown>) => x.then(() => 'ok', (e: JunctionError) => e.code);
const backdateTask = (id: string, days: number) =>
  db`update task_events set created_at = created_at - ${days} * interval '1 day' where task_id = ${id}`;

// Distinct titles so duplicate detection stays quiet.
const TITLES = [
  'Add CSV export endpoint', 'Fix login redirect', 'Rotate signing keys', 'Migrate billing webhooks', 'Upgrade postgres driver', 'Write onboarding docs',
  'Tune search ranking', 'Refactor audit log', 'Localize error pages', 'Cache avatar thumbnails', 'Replace cron scheduler', 'Harden upload limits',
];
let titleN = 0;

// Drives a fresh task to `status`.
async function reach(p: P, status: TaskStatus, title = TITLES[titleN++ % TITLES.length]) {
  const k = agent(p.jaxon);
  const t = await send(p, title);
  if (status === 'pending_approval') return t;
  if (status === 'declined') return declineTask(db, human(p.jaxon), t.id);
  if (status === 'cancelled') return cancelTask(db, agent(p.jeremy), t.id, p.project.id);
  await approveAged(db, human(p.jaxon), t.id);
  if (status === 'approved') return t;
  await claimTask(db, k, t.id, p.project.id);
  if (status === 'in_progress') return t;
  if (status === 'needs_input') return askQuestion(db, k, t.id, 'Which?', p.project.id);
  if (status === 'stuck') return markStuck(db, k, t.id, 'tests fail', p.project.id);
  await completeTask(db, k, t.id, { evidenceNote: 'ok' }, p.project.id);
  if (status === 'ready_for_review') return t;
  if (status === 'done') return reportPr(db, k, t.id, { prUrl: 'https://x/pull/1', state: 'merged' }, p.project.id);
  return reportPr(db, k, t.id, { prUrl: 'https://github.com/o/r/pull/12', state: 'open' }, p.project.id);
}

describe('agentPanel', () => {
  it('approved (any background) as queued, needs_input and stuck always, background in_progress/ready/in_review; interactive in_progress hidden', async () => {
    const p = await makeProject(db);
    const queued = await reach(p, 'approved');
    const ask = await reach(p, 'needs_input');
    const stuck = await reach(p, 'stuck');
    const working = await reach(p, 'in_progress');
    const ready = await reach(p, 'ready_for_review');
    const review = await reach(p, 'in_review');
    // interactive: started, never claimed
    const interactive = await approved(p, 'Interactive');
    await startTask(db, agent(p.jaxon), interactive.id, p.project.id);
    await reach(p, 'pending_approval');
    await reach(p, 'done');
    // another assignee's task never shows
    await sendTask(db, agent(p.jaxon), {
      projectId: p.project.id, assignee: 'Jeremy', title: 'Mine', description: 'd', blockingReason: 'b', repo: 'site', changes: ['c'],
    });

    const rows = await agentPanel(db, human(p.jaxon), p.project.id);
    expect(rows.map(r => r.id).sort()).toEqual([queued, ask, stuck, working, ready, review].map(t => t.id).sort());
    expect(rows.map(r => r.id)).not.toContain(interactive.id);
    expect(await agentPanel(db, human(p.jeremy), p.project.id)).toEqual([]);
  });

  it('order: needs_input, stuck, ready_for_review, in_review, in_progress, approved', async () => {
    const p = await makeProject(db);
    const statuses: TaskStatus[] = ['approved', 'in_progress', 'in_review', 'ready_for_review', 'stuck', 'needs_input'];
    for (const s of statuses) await reach(p, s);
    const rows = await agentPanel(db, human(p.jaxon), p.project.id);
    expect(rows.map(r => r.status)).toEqual(['needs_input', 'stuck', 'ready_for_review', 'in_review', 'in_progress', 'approved']);
  });

  it('carries the open question, the stuck reason and since = latest event time', async () => {
    const p = await makeProject(db);
    const a = await reach(p, 'needs_input', 'T needs_input');
    const s = await reach(p, 'stuck', 'Fix login redirect');
    const rows = await agentPanel(db, human(p.jaxon), p.project.id);
    const [ev] = await db`select max(created_at) as at from task_events where task_id = ${a.id}`;
    expect(rows[0]).toMatchObject({ id: a.id, question: 'Which?', stuckReason: null, requesterName: 'Jeremy', branch: 'junction/t-needs-input' });
    expect(rows[0].since).toEqual(ev.at);
    expect(rows[1]).toMatchObject({ id: s.id, question: null, stuckReason: 'tests fail' });
    await answerQuestion(db, agent(p.jaxon), a.id, 'This', p.project.id);
    expect((await agentPanel(db, human(p.jaxon), p.project.id)).find(r => r.id === a.id)).toMatchObject({ status: 'approved', question: null });
  });
});

describe('boardColumns', () => {
  const expected: [TaskStatus, string][] = [
    ['pending_approval', 'waiting'], ['approved', 'inProgress'], ['in_progress', 'inProgress'],
    ['needs_input', 'needsPerson'], ['stuck', 'needsPerson'], ['ready_for_review', 'inReview'], ['in_review', 'inReview'],
    ['done', 'done'], ['declined', 'done'], ['cancelled', 'done'],
  ];
  test.each(expected)('maps %s to %s', async (status, column) => {
    const p = await makeProject(db);
    const t = await reach(p, status);
    const board = (await boardColumns(db, human(p.jeremy), p.project.id)) as unknown as Record<string, { id: string }[]>;
    for (const [col, cards] of Object.entries(board)) expect(cards.map(c => c.id)).toEqual(col === column ? [t.id] : []);
  });

  it('request cards carry from/to; work cards carry owner/area', async () => {
    const p = await makeProject(db);
    const t = await reach(p, 'in_review');
    const w = await recordWork(db, agent(p.scott), {
      projectId: p.project.id, repo: 'site', key: 'feat/a', title: 'Work A', summary: 's', done: [], notDone: [],
    });
    const board = await boardColumns(db, human(p.jeremy), p.project.id);
    expect(board.inReview[0]).toMatchObject({ kind: 'request', id: t.id, from: 'Jeremy', to: 'Jaxon', owner: null, area: null, prNumber: 12, background: true });
    expect(board.inProgress[0]).toMatchObject({ kind: 'work', id: w.id, from: null, to: null, owner: 'Scott', area: null, prNumber: null });
  });

  it('active work in inProgress, merged/abandoned in done, a work item whose key is an open task branch in the same repo is hidden', async () => {
    const p = await makeProject(db);
    const t = await claimed(p, 'Contact form');
    const work = (key: string, repo = 'site', status?: 'merged' | 'abandoned') =>
      recordWork(db, agent(p.jaxon), { projectId: p.project.id, repo, key, title: key, summary: 's', done: [], notDone: [], status });
    await work('junction/contact-form');
    const otherRepo = await work('junction/contact-form', 'api');
    const plain = await work('feat/plain');
    const merged = await work('feat/merged', 'site', 'merged');
    const dropped = await work('feat/dropped', 'site', 'abandoned');
    const board = await boardColumns(db, human(p.jeremy), p.project.id);
    expect(board.inProgress.map(c => c.id).sort()).toEqual([t.id, otherRepo.id, plain.id].sort());
    expect(board.done.map(c => c.id).sort()).toEqual([merged.id, dropped.id].sort());
  });

  it('done is the 20 most recent across tasks and work; in_review prNumber from evidence_url /pull/12', async () => {
    const p = await makeProject(db);
    const old = await reach(p, 'declined', 'oldest');
    await backdateTask(old.id, 5);
    for (let i = 0; i < 10; i++) await reach(p, 'cancelled', `c${i}`);
    for (let i = 0; i < 10; i++) {
      await recordWork(db, agent(p.jaxon), { projectId: p.project.id, repo: 'site', key: `m${i}`, title: `m${i}`, summary: 's', done: [], notDone: [], status: 'merged' });
    }
    const t = await reach(p, 'in_review');
    const board = await boardColumns(db, human(p.jeremy), p.project.id);
    expect(board.done).toHaveLength(20);
    expect(board.done.map(c => c.id)).not.toContain(old.id);
    expect(board.done.every((c, i, a) => i === 0 || +a[i - 1].since >= +c.since)).toBe(true);
    expect(board.inReview).toMatchObject([{ id: t.id, prNumber: 12 }]);
  });

  it('old = since older than staleDays', async () => {
    const p = await makeProject(db);
    await setStaleDays(db, human(p.jeremy), p.project.id, 3);
    const stale = await reach(p, 'pending_approval', 'stale');
    const fresh = await reach(p, 'pending_approval', 'fresh');
    await backdateTask(stale.id, 4);
    const w = await recordWork(db, agent(p.jaxon), { projectId: p.project.id, repo: 'site', key: 'w', title: 'w', summary: 's', done: [], notDone: [] });
    await db`update work_items set last_activity_at = now() - interval '4 days' where id = ${w.id}`;
    const board = await boardColumns(db, human(p.jeremy), p.project.id);
    expect(board.waiting.map(c => [c.id, c.old])).toEqual([[stale.id, true], [fresh.id, false]]);
    expect(board.inProgress).toMatchObject([{ id: w.id, old: true }]);
  });
});

describe('badgeCounts', () => {
  it('inbox = my pending_approval here; attention = my needs_input + stuck', async () => {
    const p = await makeProject(db);
    await reach(p, 'pending_approval');
    await reach(p, 'pending_approval');
    await reach(p, 'needs_input');
    await reach(p, 'stuck');
    await reach(p, 'approved');
    expect(await badgeCounts(db, human(p.jaxon), p.project.id)).toEqual({ inbox: 2, attention: 2 });
    expect(await badgeCounts(db, human(p.jeremy), p.project.id)).toEqual({ inbox: 0, attention: 0 });
  });
});

const decide = (p: P, who: 'jeremy' | 'jaxon', title: string, over: object = {}) =>
  writeContext(db, agent(p[who]), { projectId: p.project.id, kind: 'decision', title, body: `Body of ${title}`, ...over });
const note = (p: P, who: 'jeremy' | 'jaxon', title: string) =>
  recordWork(db, agent(p[who]), { projectId: p.project.id, repo: 'site', key: 'feat-x', title, summary: `Sum of ${title}`, done: [], notDone: [] });

// Separates timestamps by more than a millisecond.
const tick = () => new Promise(r => setTimeout(r, 3));
// Gives an entry its own timestamp (the log pages on whole milliseconds).
const spaced = (e: { id: string }, secondsAgo: number) =>
  db`update context_entries set created_at = now() - ${secondsAgo} * interval '1 second' where id = ${e.id}`;

describe('keyContext', () => {
  it('project decisions and ownership, newest first, replaced and private and notes/updates excluded, replacesTitle set', async () => {
    const p = await makeProject(db);
    const old = await decide(p, 'jeremy', 'Use REST');
    await decide(p, 'jeremy', 'Private call', { visibility: 'private' });
    await writeContext(db, agent(p.jaxon), { projectId: p.project.id, kind: 'note', title: 'A note', body: 'n' });
    // Legacy row: writeContext no longer accepts ownership.
    await db`insert into context_entries (project_id, author_id, kind, title, body) values (${p.project.id}, ${p.jaxon.id}, 'ownership', 'Jaxon owns auth', 'since Oct')`;
    await decide(p, 'jaxon', 'Use GraphQL', { replaces: old.id });
    const k = await keyContext(db, human(p.jeremy), p.project.id);
    expect(k.map(e => [e.kind, e.title, e.authorName, e.replacesTitle])).toEqual([
      ['decision', 'Use GraphQL', 'Jaxon', 'Use REST'],
      ['ownership', 'Jaxon owns auth', 'Jaxon', null],
    ]);
    expect(k[0].body).toBe('Body of Use GraphQL');
    expect(k[0].createdAt).toBeInstanceOf(Date);
  });
});

describe('activityLog', () => {
  it('task events + work updates + decisions, newest first, agent flag, mine flag, wording for created/claimed/merged', async () => {
    const p = await makeProject(db);
    const t = await send(p, 'Footer links');
    await tick();
    await approveAged(db, human(p.jaxon), t.id);
    await tick();
    await claimTask(db, agent(p.jaxon), t.id, p.project.id);
    await tick();
    await completeTask(db, agent(p.jaxon), t.id, { evidenceNote: 'ok' }, p.project.id);
    await tick();
    await reportPr(db, agent(p.jaxon), t.id, { prUrl: 'https://x/pull/1', state: 'merged' }, p.project.id);
    await tick();
    await note(p, 'jaxon', 'Footer');
    await tick();
    const old = await decide(p, 'jeremy', 'Use REST');
    await tick();
    await decide(p, 'jaxon', 'Use GraphQL', { replaces: old.id });
    await tick();
    await decide(p, 'jaxon', 'Private call', { visibility: 'private' });
    await tick();

    const log = await activityLog(db, human(p.jeremy), p.project.id);
    const line = (e: (typeof log)[number]) => `${e.actor} ${e.text}`;
    expect(log.map(e => [e.event, line(e)])).toEqual([
      ['decision', "Jaxon's agent decided: Use GraphQL"],
      ['decision', "Jeremy's agent decided: Use REST"],
      ['work_update', "Jaxon's agent noted progress on feat-x: Footer"],
      ['merged', "Jaxon's agent merged Footer links · Jeremy unblocked"],
      ['finished', "Jaxon's agent finished Footer links"],
      ['claimed', "Jaxon's agent started Footer links"],
      ['approved', 'Jaxon approved Footer links'],
      ['created', "Jeremy's agent sent Footer links to Jaxon"],
    ]);
    expect(log.map(e => e.at.getTime())).toEqual([...log.map(e => e.at.getTime())].sort((a, b) => b - a));
    expect(log.map(e => [e.event, e.agent, e.mine])).toEqual([
      ['decision', true, false], ['decision', true, true], ['work_update', true, false], ['merged', true, false],
      ['finished', true, false], ['claimed', true, false], ['approved', false, false], ['created', true, true],
    ]);
    expect(log[0].detail).toBe('Replaces "Use REST"');
    expect(log[1].detail).toBeNull();
    expect(log[2]).toMatchObject({ detail: 'Sum of Footer', workItemId: expect.any(String), taskId: null });
    expect(log[7]).toMatchObject({ taskId: t.id, workItemId: null });
    expect(Object.keys(EVENT_TEXT)).toContain('unapproved');
  });

  it('labels a removed member\'s cancelled task with its note', async () => {
    const p = await makeProject(db);
    const t = await send(p, 'Footer links');
    await removeMember(db, human(p.jeremy), p.project.id, p.jaxon.id);
    const log = await activityLog(db, human(p.jeremy), p.project.id);
    expect(log.find(e => e.event === 'member_removed')?.text).toBe('cancelled Footer links · Jaxon was removed from the project');
    expect(t.id).toBe(log.find(e => e.event === 'member_removed')?.taskId);
  });

  it('every task_events event has an EVENT_TEXT label', async () => {
    const [{ def }] = await db`select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'task_events_event_check'`;
    const events = [...(def as string).matchAll(/'([a-z_]+)'/g)].map(m => m[1]);
    expect(events.length).toBeGreaterThan(10);
    expect(events.filter(e => !(e in EVENT_TEXT))).toEqual([]);
  });

  it('pages with before and limit (default 50)', async () => {
    const p = await makeProject(db);
    for (let i = 1; i <= 55; i++) await spaced(await decide(p, 'jeremy', `D${i}`), 55 - i);
    const first = await activityLog(db, human(p.jeremy), p.project.id);
    expect(first).toHaveLength(50);
    expect(first[0].text).toBe('decided: D55');
    const rest = await activityLog(db, human(p.jeremy), p.project.id, { before: first[49].at });
    expect(rest.map(e => e.text)).toEqual(['decided: D5', 'decided: D4', 'decided: D3', 'decided: D2', 'decided: D1']);
    expect(await activityLog(db, human(p.jeremy), p.project.id, { limit: 3 })).toHaveLength(3);
  });

  it('never splits rows sharing a timestamp: paging with a small limit loses and duplicates nothing', async () => {
    const p = await makeProject(db);
    await decide(p, 'jeremy', 'Early');
    await db.begin(async tx => { // one transaction: identical now()
      for (const i of [1, 2, 3, 4, 5]) {
        await tx`insert into context_entries (project_id, author_id, kind, title, body) values (${p.project.id}, ${p.jaxon.id}, 'decision', ${'G' + i}, 'b')`;
      }
    });
    await decide(p, 'jeremy', 'Late');
    const seen: string[] = [];
    let before: Date | undefined;
    for (let page = 0; page < 10; page++) {
      const got = await activityLog(db, human(p.jeremy), p.project.id, { before, limit: 2 });
      if (!got.length) break;
      seen.push(...got.map(e => e.text));
      before = got[got.length - 1].at;
    }
    expect(seen).toHaveLength(7);
    expect(new Set(seen)).toEqual(new Set(['Early', 'Late', 'G1', 'G2', 'G3', 'G4', 'G5'].map(t => `decided: ${t}`)));
  });
});

describe('overviewNews', () => {
  it('latest 20, excludes mine and claimed/asked/answered/stuck/retried/finished', async () => {
    const p = await makeProject(db);
    await reach(p, 'stuck', 'Footer links'); // created(J) approved(K) claimed stuck
    await note(p, 'jaxon', 'Footer');
    await decide(p, 'jeremy', 'Mine');
    const news = await overviewNews(db, human(p.jeremy), p.project.id);
    expect(news.map(e => e.event)).toEqual(['work_update', 'approved']);
    expect(news.every(e => !e.mine)).toBe(true);
    for (let i = 1; i <= 25; i++) await spaced(await decide(p, 'jaxon', `D${i}`), 25 - i);
    const many = await overviewNews(db, human(p.jeremy), p.project.id);
    expect(many).toHaveLength(20);
    expect(many[0].text).toBe('decided: D25');
  });
});

describe('dashboardSeenAt', () => {
  it('null before markDashboardSeen, a Date after', async () => {
    const p = await makeProject(db);
    expect(await dashboardSeenAt(db, human(p.jaxon), p.project.id)).toBeNull();
    await markDashboardSeen(db, human(p.jaxon), p.project.id);
    expect(await dashboardSeenAt(db, human(p.jaxon), p.project.id)).toBeInstanceOf(Date);
  });
});

describe('empty project and access', () => {
  it('every list empty, counts 0', async () => {
    const p = await makeProject(db);
    expect(await keyContext(db, human(p.jaxon), p.project.id)).toEqual([]);
    expect(await activityLog(db, human(p.jaxon), p.project.id)).toEqual([]);
    expect(await overviewNews(db, human(p.jaxon), p.project.id)).toEqual([]);
    expect(await agentPanel(db, human(p.jaxon), p.project.id)).toEqual([]);
    expect(await boardColumns(db, human(p.jaxon), p.project.id)).toEqual({ waiting: [], inProgress: [], needsPerson: [], inReview: [], done: [] });
    expect(await badgeCounts(db, human(p.jaxon), p.project.id)).toEqual({ inbox: 0, attention: 0 });
  });

  it('non-member -> forbidden', async () => {
    const p = await makeProject(db);
    const other = await makeProject(db);
    const out = human(other.jeremy);
    expect(await code(agentPanel(db, out, p.project.id))).toBe('forbidden');
    expect(await code(boardColumns(db, out, p.project.id))).toBe('forbidden');
    expect(await code(badgeCounts(db, out, p.project.id))).toBe('forbidden');
    expect(await code(keyContext(db, out, p.project.id))).toBe('forbidden');
    expect(await code(activityLog(db, out, p.project.id))).toBe('forbidden');
    expect(await code(overviewNews(db, out, p.project.id))).toBe('forbidden');
    expect(await code(dashboardSeenAt(db, out, p.project.id))).toBe('forbidden');
  });
});
