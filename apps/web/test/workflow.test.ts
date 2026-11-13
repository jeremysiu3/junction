import { afterAll, describe, expect, it } from 'vitest';
import { createDb, pendingApprovals, saveArea } from '@junction/core';
import { approveAged, human, makeProject } from '@junction/core/test/fixtures';
import { userCall } from './helpers';

const db = createDb();
afterAll(() => db.end());

// Strips the untrusted wrapper (first and last line) and parses the JSON inside.
const unwrap = (s: string) => JSON.parse(s.split('\n').slice(1, -1).join('\n'));

describe('Jeremy/Jaxon workflow', () => {
  it('runs the spec example end to end', async () => {
    const p = await makeProject(db);
    const call = async (u: { id: string; token: string }, tool: string, body: unknown = {}) => {
      const res = await userCall(db, u, tool, body, p.project.slug, 'site');
      const json = await res.json();
      expect(res.status, JSON.stringify(json)).toBe(200);
      return json.result as string;
    };

    await saveArea(db, human(p.jeremy), { projectId: p.project.id, name: 'Reports API', ownerId: p.jaxon.id, description: 'Jaxon owns the reports API' });

    const owner = unwrap(await call(p.jeremy, 'find_owner', { topic: 'export endpoint reports' }));
    expect(owner.areas[0].ownerName).toBe('Jaxon');

    const { id } = JSON.parse(
      await call(p.jeremy, 'send_task', {
        assignee: 'Jaxon', title: 'Add CSV export endpoint', description: 'Need /reports/export', blocking_reason: 'Blocked on export', repo: 'site', changes: ['Change one thing'],
      }),
    );

    expect(unwrap(await call(p.jaxon, 'check_inbox')).tasks.map((t: { id: string }) => t.id)).toContain(id);

    await call(p.jaxon, 'add_estimate', { task_id: id, estimate_text: 'About 2 hours' });
    expect(await pendingApprovals(db, human(p.jaxon))).toMatchObject([{ id, estimateText: 'About 2 hours' }]);
    await approveAged(db, human(p.jaxon), id);
    expect(JSON.parse(await call(p.jaxon, 'start_task', { task_id: id }))).toEqual({ id, status: 'in_progress' });
    expect(JSON.parse(await call(p.jaxon, 'complete_task', { task_id: id, evidence_url: 'https://github.com/x/y/pull/42' }))).toEqual({ id, status: 'done' });

    const inbox = unwrap(await call(p.jeremy, 'check_inbox'));
    expect(inbox.notifications.map((n: { kind: string }) => n.kind)).toContain('unblocked');
    expect(inbox.whatsNew.map((e: { title: string }) => e.title)).toContain('Completed: Add CSV export endpoint');
  });
});
