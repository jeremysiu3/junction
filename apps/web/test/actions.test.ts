import { afterAll, describe, expect, it, vi } from 'vitest';
import { createDb, sendTask, writeContext } from '@junction/core';
import { agent, makeProject } from '@junction/core/test/fixtures';

// The dashboard actions as Jaxon's human, with Next's redirect surfaced as a throw.
const me = vi.hoisted(() => ({ userId: '' }));
vi.mock('../lib/human', () => ({ requireHuman: async () => ({ userId: me.userId, type: 'human' }) }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`redirect ${to}`); } }));

import { decline, defer, deleteContextAction, deleteProjectAction } from '../app/p/[slug]/actions';

const db = createDb();
afterAll(() => db.end());

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

describe('defer and decline', () => {
  it("refuse a task from another project than the slug's", async () => {
    const p = await makeProject(db);
    const q = await makeProject(db);
    await db`insert into memberships (project_id, user_id) values (${q.project.id}, ${p.jaxon.id})`;
    me.userId = p.jaxon.id;
    const t = await sendTask(db, agent(p.jeremy), {
      projectId: p.project.id, assignee: 'Jaxon', title: 'Add export endpoint', description: 'd', blockingReason: 'b', repo: 'site', changes: ['c'],
    });
    for (const action of [defer, decline])
      await expect(action(form({ slug: q.project.slug, id: t.id }))).rejects.toThrow(`redirect /p/${q.project.slug}/inbox?error=not_found`);
    const [r] = await db`select status, deferred_at from tasks where id = ${t.id}`;
    expect(r).toMatchObject({ status: 'pending_approval', deferredAt: null });
    await decline(form({ slug: p.project.slug, id: t.id }));
    expect((await db`select status from tasks where id = ${t.id}`)[0].status).toBe('declined');
  });
});

describe('deleteProjectAction', () => {
  it('needs the exact project name, then deletes and goes home', async () => {
    const p = await makeProject(db);
    me.userId = p.jeremy.id;
    const [{ name }] = await db`select name from projects where id = ${p.project.id}`;
    for (const typed of ['', 'wrong', ` ${name.toUpperCase()}x`])
      expect(await deleteProjectAction({}, form({ slug: p.project.slug, name: typed }))).toEqual({ error: 'Type the project name to confirm' });
    expect(await db`select 1 from projects where id = ${p.project.id}`).toHaveLength(1);
    await expect(deleteProjectAction({}, form({ slug: p.project.slug, name: ` ${name} ` }))).rejects.toThrow('redirect /');
    expect(await db`select 1 from projects where id = ${p.project.id}`).toHaveLength(0);
  });

  it("returns core's error for a member who isn't an admin", async () => {
    const p = await makeProject(db);
    me.userId = p.jaxon.id;
    const [{ name }] = await db`select name from projects where id = ${p.project.id}`;
    expect(await deleteProjectAction({}, form({ slug: p.project.slug, name }))).toEqual({ error: 'only a project admin can do this' });
  });
});

describe('deleteContextAction', () => {
  it("deletes the author's entry; another member's attempt returns to the page it came from with forbidden", async () => {
    const p = await makeProject(db);
    const e = await writeContext(db, agent(p.scott), { projectId: p.project.id, kind: 'note', title: 'Oops', body: 'pasted by mistake' });
    me.userId = p.jaxon.id;
    await expect(deleteContextAction(form({ slug: p.project.slug, id: e.id, back: 'entries' }))).rejects.toThrow(`redirect /p/${p.project.slug}/memory/entries?error=forbidden`);
    await expect(deleteContextAction(form({ slug: p.project.slug, id: e.id }))).rejects.toThrow(`redirect /p/${p.project.slug}/memory?error=forbidden`);
    me.userId = p.scott.id;
    await deleteContextAction(form({ slug: p.project.slug, id: e.id }));
    expect(await db`select 1 from context_entries where id = ${e.id}`).toHaveLength(0);
  });
});
