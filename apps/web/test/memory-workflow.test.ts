import { afterAll, describe, expect, it } from 'vitest';
import { createDb, pendingApprovals } from '@junction/core';
import { human, makeProject } from '@junction/core/test/fixtures';
import { userCall } from './helpers';

const db = createDb();
afterAll(() => db.end());

const unwrap = (s: string) => JSON.parse(s.split('\n').slice(1, -1).join('\n'));

describe('shared memory workflow', () => {
  it("Jaxon's work reaches Jeremy's inbox, overlap check, and a task to Jaxon", async () => {
    const p = await makeProject(db);
    const call = async (u: { id: string; token: string }, tool: string, body: unknown = {}, repo = 'site') => {
      const res = await userCall(db, u, tool, body, p.project.slug, repo);
      const json = await res.json();
      expect(res.status, JSON.stringify(json)).toBe(200);
      return json.result as string;
    };

    await call(p.jaxon, 'record_work', {
      key: 'feat/site-ui', title: 'Site UI', summary: 'UI pages done; nothing behind the forms yet',
      done: [{ text: 'Landing and pricing pages', evidence: 'apps/site/pages' }, { text: 'Nav and footer' }],
      not_done: ['Contact form backend', 'Auth'], paths: ['apps/site'],
    });

    const inbox = unwrap(await call(p.jeremy, 'check_inbox'));
    expect(inbox.workUpdates.map((w: { key: string }) => w.key)).toEqual(['feat/site-ui']);

    const started = await call(p.jeremy, 'start_work', { about: 'contact form', paths: ['apps/site/contact'] });
    const { overlaps } = unwrap(started);
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0].reason).toBe('path');
    expect(started).toContain('Contact form backend');

    const sent = JSON.parse(await call(p.jeremy, 'send_task', {
      assignee: 'Jaxon', title: 'Build contact form backend', description: 'Needed for the site contact page', blocking_reason: 'Blocked on backend', changes: ['Change one thing'],
      work_item_id: overlaps[0].workItem.id, not_done_item: 'Contact form backend',
    }));
    expect(sent.status).toBe('pending_approval');

    const pending = await pendingApprovals(db, human(p.jaxon));
    expect(pending).toMatchObject([{ id: sent.id, fromItem: 'Contact form backend' }]);
  });
});
