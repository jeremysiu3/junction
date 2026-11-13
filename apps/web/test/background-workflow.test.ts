import { afterAll, describe, expect, it } from 'vitest';
import { createDb } from '@junction/core';
import { approveAged, human, makeProject } from '@junction/core/test/fixtures';
import { userCall } from './helpers';

const db = createDb();
afterAll(() => db.end());

// Strips the untrusted wrapper (first and last line) and parses the JSON inside.
const unwrap = (s: string) => JSON.parse(s.split('\n').slice(1, -1).join('\n'));

describe('background task workflow', () => {
  it('runs send, approve, claim, ask, answer, finish, PR open, merge', async () => {
    const p = await makeProject(db);
    const call = async (u: { id: string; token: string }, tool: string, body: unknown = {}, repo?: string) => {
      const res = await userCall(db, u, tool, body, p.project.slug, repo);
      const json = await res.json();
      expect(res.status, JSON.stringify(json)).toBe(200);
      return json.result as string;
    };
    const parse = (s: string) => JSON.parse(s);

    const { id } = parse(await call(p.jeremy, 'send_task', {
      assignee: 'Jaxon', title: 'Add CSV export endpoint', description: 'Need /reports/export', blocking_reason: 'Blocked on export', repo: 'site', changes: ['Change one thing'],
    }));
    await approveAged(db, human(p.jaxon), id);

    const queue = parse(await call(p.jaxon, 'worker_queue'));
    expect(queue.approved.map((t: { id: string }) => t.id)).toEqual([id]);

    const claimed = parse(await call(p.jaxon, 'claim_task', { task_id: id }));
    expect(claimed).toMatchObject({ id, status: 'in_progress' });
    expect(claimed.branch).toMatch(/^junction\//);
    const branch = claimed.branch as string;

    await call(p.jaxon, 'record_work', {
      key: branch, title: 'CSV export', summary: 'Working on it', done: [], not_done: ['tests'],
    }, 'site');

    expect(parse(await call(p.jaxon, 'ask_question', { task_id: id, question: 'Which columns?' }))).toEqual({ id, status: 'needs_input' });
    const inbox = unwrap(await call(p.jaxon, 'check_inbox'));
    expect(inbox.tasks.find((t: { id: string }) => t.id === id).openQuestion).toBe('Which columns?');

    expect(parse(await call(p.jaxon, 'answer_question', { task_id: id, answer: 'All of them' }))).toEqual({ id, status: 'approved' });
    expect(parse(await call(p.jaxon, 'claim_task', { task_id: id })).status).toBe('in_progress');
    expect(parse(await call(p.jaxon, 'complete_task', { task_id: id, branch, evidence_note: 'Pushed the branch' })))
      .toEqual({ id, status: 'ready_for_review' });
    const kinds = async (u: { id: string; token: string }) => unwrap(await call(u, 'check_inbox')).notifications.map((n: { kind: string }) => n.kind);
    expect(await kinds(p.jeremy)).not.toContain('unblocked');

    const prUrl = 'https://github.com/x/y/pull/7';
    expect(parse(await call(p.jaxon, 'report_pr', { task_id: id, pr_url: prUrl, state: 'open' }))).toEqual({ id, status: 'in_review' });
    expect(await kinds(p.jeremy)).toContain('preview');

    expect(parse(await call(p.jaxon, 'report_pr', { task_id: id, pr_url: prUrl, state: 'merged' }))).toEqual({ id, status: 'done' });
    expect(await kinds(p.jeremy)).toContain('unblocked');
    const [w] = await db`select status from work_items where owner_id = ${p.jaxon.id} and repo = 'site' and key = ${branch}`;
    expect(w.status).toBe('merged');
  });
});
