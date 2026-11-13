import { afterAll, describe, expect, it } from 'vitest';
import {
  JunctionError, createDb, getSnapshot, getWorkItem, listWorkItems, markAbandoned, pathsOverlap, recordWork, saveArea, setStaleDays, startWork,
  type RecordWorkInput,
} from '../src';
import { agent, human, makeProject } from './fixtures';

const db = createDb();
afterAll(() => db.end());

const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: JunctionError) => e.code);
const fail = (p: Promise<unknown>) => p.then(() => { throw new Error('expected rejection'); }, (e: JunctionError) => e);

async function setup() {
  const p = await makeProject(db);
  await saveArea(db, human(p.jeremy), { projectId: p.project.id, name: 'Site', ownerId: p.jeremy.id });
  await saveArea(db, human(p.jeremy), { projectId: p.project.id, name: 'Reports API', ownerId: p.jaxon.id });
  const input = (over: Partial<RecordWorkInput> = {}): RecordWorkInput => ({
    projectId: p.project.id, repo: 'site', key: 'feat/site-ui', title: 'Site UI', summary: 'progress',
    done: [], notDone: ['write tests'], area: 'Site', ...over,
  });
  return { p, input };
}

const ageItem = (id: string, interval: string) =>
  db`update work_items set last_activity_at = now() - ${interval}::interval where id = ${id}`;

describe('recordWork', () => {
  it('caps one call at 64 KB of free text across all fields and list items', async () => {
    const { p, input } = await setup();
    const big = 'x'.repeat(2000);
    const over = (n: number) => input({ done: Array.from({ length: n }, () => ({ text: big })), notDone: [big] });
    const e = await fail(recordWork(db, agent(p.jaxon), over(32)));
    expect(e).toMatchObject({ code: 'validation', message: 'this update is too large; keep it under 64 KB' });
    expect(await code(recordWork(db, agent(p.jaxon), input({ done: Array.from({ length: 30 }, () => ({ text: big })), notDone: [big] })))).toBe('ok');
    expect(await code(recordWork(db, agent(p.jaxon), input({ done: Array.from({ length: 31 }, () => ({ text: big })), notDone: Array.from({ length: 2 }, () => big) })))).toBe('validation');
  });

  it("creates then updates Jaxon's item", async () => {
    const { p, input } = await setup();
    const a = await recordWork(db, agent(p.jaxon), input({ notDone: ['a', 'b'] }));
    const b = await recordWork(db, agent(p.jaxon), input({ notDone: ['c'] }));
    expect(a.id).toBe(b.id);
    expect(b).toMatchObject({ notDone: ['c'], ownerName: 'Jaxon', areaName: 'Site', status: 'in_progress', stale: false });
    const [{ n }] = await db`select count(*)::int as n from work_items where project_id = ${p.project.id}`;
    const [{ m }] = await db`select count(*)::int as m from work_updates where work_item_id = ${a.id}`;
    expect([n, m]).toEqual([1, 2]);
  });

  it("done without evidence is unconfirmed; with a PR URL, a 7-char SHA, or 'apps/site/pages' it is confirmed", async () => {
    const { p, input } = await setup();
    const w = await recordWork(db, agent(p.jaxon), input({
      done: [
        { text: 'a' },
        { text: 'b', evidence: 'https://github.com/o/r/pull/1' },
        { text: 'c', evidence: 'ABCDEF1' },
        { text: 'd', evidence: 'apps/site/pages' },
        { text: 'e', evidence: 'README.md' },
        { text: 'f', evidence: './Makefile' },
      ],
    }));
    expect(w.done.map(d => d.confirmed)).toEqual([false, true, true, true, true, true]);
    expect(w.done[0].evidence).toBeNull();
  });

  it.each(['done', 'done.', 'see notes', '/etc/passwd', '../secrets', 'C:\\x', '\\etc\\passwd.txt', '~/x'])('rejects evidence %s', async ev => {
    const { p, input } = await setup();
    expect(await code(recordWork(db, agent(p.jaxon), input({ done: [{ text: 'x', evidence: ev }] })))).toBe('validation');
  });

  it('unknown area → validation listing areas, and missing repo → JUNCTION_REPO message', async () => {
    const { p, input } = await setup();
    const err = await fail(recordWork(db, agent(p.jaxon), input({ area: 'Nope' })));
    expect(err.code).toBe('validation');
    expect(err.message).toContain('Reports API, Site');
    const repo = await fail(recordWork(db, agent(p.jaxon), input({ repo: null })));
    expect(repo.code).toBe('validation');
    expect(repo.message).toBe('repo is required: pass repo from junction.json at the repo root');
  });

  it('rejects blank key, title, summary and item text', async () => {
    const { p, input } = await setup();
    for (const over of [{ key: ' ' }, { title: '' }, { summary: ' ' }, { done: [{ text: ' ' }] }, { notDone: [''] }]) {
      expect(await code(recordWork(db, agent(p.jaxon), input(over)))).toBe('validation');
    }
  });

  it('caps list counts and element lengths, and repo length', async () => {
    const { p, input } = await setup();
    const msg = async (over: Partial<RecordWorkInput>) => (await fail(recordWork(db, agent(p.jaxon), input(over)))).message;
    expect(await msg({ notDone: Array(51).fill('x') })).toBe('not_done must have at most 50 items');
    expect(await msg({ done: Array(51).fill({ text: 'x' }) })).toBe('done must have at most 50 items');
    expect(await msg({ paths: Array(51).fill('a') })).toBe('paths must have at most 50 items');
    expect(await msg({ paths: ['a'.repeat(301)] })).toBe('paths items must be at most 300 characters');
    expect(await msg({ repo: 'r'.repeat(101) })).toBe('repo must be at most 100 characters');
    expect(await code(recordWork(db, agent(p.jaxon), input({ notDone: Array(50).fill('x'), paths: ['a'.repeat(300)], repo: 'r'.repeat(100) })))).toBe('ok');
  });

  it("Jeremy recording Jaxon's key creates Jeremy's own item; Jaxon's item unchanged", async () => {
    const { p, input } = await setup();
    const k = await recordWork(db, agent(p.jaxon), input({ notDone: ['jaxon todo'] }));
    const j = await recordWork(db, agent(p.jeremy), input({ notDone: ['jeremy todo'] }));
    expect(j.id).not.toBe(k.id);
    const [row] = await db`select not_done from work_items where id = ${k.id}`;
    expect(row.notDone).toEqual(['jaxon todo']);
  });

  it("same key in repos 'site' and 'backend' gives two items", async () => {
    const { p, input } = await setup();
    const a = await recordWork(db, agent(p.jaxon), input());
    const b = await recordWork(db, agent(p.jaxon), input({ repo: 'backend' }));
    expect(a.id).not.toBe(b.id);
  });
});

describe('work update limit', () => {
  it('allows 300 work updates per user per hour', async () => {
    const { p, input } = await setup();
    const item = await recordWork(db, agent(p.jaxon), input());
    const seed = (n: number, age: string) =>
      db`insert into work_updates (work_item_id, author_id, summary, status, done, not_done, created_at)
         select ${item.id}, ${p.jaxon.id}, 's', 'in_progress', '[]', '[]', now() - ${age}::interval from generate_series(1, ${n}) g`;
    await seed(300, '2 hours');
    await seed(298, '10 minutes'); // 299 with the first call
    expect(await code(recordWork(db, agent(p.jaxon), input({ key: 'other' })))).toBe('ok');
    const e = await fail(recordWork(db, agent(p.jaxon), input({ key: 'third' })));
    expect(e.code).toBe('limit');
    expect(e.message).toBe('you can record at most 300 work updates an hour; try again later');
    const [{ n }] = await db`select count(*)::int as n from work_items where project_id = ${p.project.id} and key = 'third'`;
    expect(n).toBe(0);
  });
});

describe('getSnapshot', () => {
  it('shows only in_progress items, area counts and notDone', async () => {
    const { p, input } = await setup();
    const site = await recordWork(db, agent(p.jaxon), input({ notDone: ['write tests'] }));
    await recordWork(db, agent(p.jaxon), input({ key: 'feat/api', area: 'Reports API', notDone: ['docs'] }));
    const merged = await recordWork(db, agent(p.jaxon), input({ key: 'feat/old', status: 'merged', notDone: ['ghost'] }));
    const snap = await getSnapshot(db, agent(p.jeremy), { projectId: p.project.id });
    expect(snap.workItems.map(w => w.key).sort()).toEqual(['feat/api', 'feat/site-ui']);
    const siteArea = snap.areas.find(a => a.name === 'Site')!;
    expect(siteArea).toMatchObject({ ownerName: 'Jeremy', inProgress: 1, stale: 0 });
    expect(siteArea.notDone).toEqual([{ workItemId: site.id, key: 'feat/site-ui', text: 'write tests' }]);
    const filtered = await getSnapshot(db, agent(p.jeremy), { projectId: p.project.id, area: 'reports api' });
    expect(filtered.workItems.map(w => w.key)).toEqual(['feat/api']);
    expect(filtered.areas).toHaveLength(2);
    const one = await getSnapshot(db, agent(p.jeremy), { projectId: p.project.id, workItemId: merged.id });
    expect(one.workItems).toMatchObject([{ id: merged.id, status: 'merged' }]);
    expect(await code(getSnapshot(db, agent(p.jeremy), { projectId: p.project.id, workItemId: 'nope' }))).toBe('not_found');
    const other = await makeProject(db);
    expect(await code(getSnapshot(db, agent(other.jeremy), { projectId: other.project.id, workItemId: site.id }))).toBe('not_found');
    expect(await code(getSnapshot(db, agent(other.jeremy), { projectId: p.project.id }))).toBe('forbidden');
  });

  it('stale boundary', async () => {
    const { p, input } = await setup();
    const w = await recordWork(db, agent(p.jaxon), input());
    const stale = async () => (await getSnapshot(db, agent(p.jaxon), { projectId: p.project.id, workItemId: w.id })).workItems[0];
    await ageItem(w.id, '14 days 1 minute');
    expect(await stale()).toMatchObject({ stale: true, daysSinceActivity: 14 });
    await ageItem(w.id, '13 days 23 hours');
    expect(await stale()).toMatchObject({ stale: false, daysSinceActivity: 13 });
    await setStaleDays(db, human(p.jeremy), p.project.id, 3);
    expect((await stale()).stale).toBe(true);
    const snap = await getSnapshot(db, agent(p.jaxon), { projectId: p.project.id });
    expect(snap.areas.find(a => a.name === 'Site')!.stale).toBe(1);
  });
});

describe('listWorkItems', () => {
  it('returns every status, newest activity first, members only', async () => {
    const { p, input } = await setup();
    await recordWork(db, agent(p.jaxon), input({ key: 'a' }));
    await recordWork(db, agent(p.jaxon), input({ key: 'b', status: 'merged' }));
    const list = await listWorkItems(db, human(p.jeremy), p.project.id);
    expect(list.map(w => [w.key, w.status])).toEqual([['b', 'merged'], ['a', 'in_progress']]);
    const other = await makeProject(db);
    expect(await code(listWorkItems(db, human(other.jeremy), p.project.id))).toBe('forbidden');
  });
});

describe('markAbandoned', () => {
  it('is human-only, stale-only, and Jaxon can reopen', async () => {
    const { p, input } = await setup();
    const w = await recordWork(db, agent(p.jaxon), input());
    const err = await fail(markAbandoned(db, human(p.jeremy), p.project.id, w.id));
    expect([err.code, err.message]).toEqual(['invalid_transition', 'only stale work can be marked abandoned']);
    await ageItem(w.id, '15 days');
    expect(await code(markAbandoned(db, agent(p.jeremy), p.project.id, w.id))).toBe('forbidden');
    expect((await markAbandoned(db, human(p.jeremy), p.project.id, w.id)).status).toBe('abandoned');
    expect(await code(markAbandoned(db, human(p.jeremy), p.project.id, w.id))).toBe('invalid_transition');
    const [latest] = (await getWorkItem(db, agent(p.jeremy), p.project.id, w.id)).updates;
    expect(latest).toMatchObject({ summary: 'Marked abandoned (no activity for 15 days)', authorName: 'Jeremy', status: 'abandoned', notDone: ['write tests'] });
    const back = await recordWork(db, agent(p.jaxon), input({ status: 'in_progress' }));
    expect(back).toMatchObject({ id: w.id, status: 'in_progress', stale: false });
  });
});

describe('getWorkItem', () => {
  it('returns updates newest first', async () => {
    const { p, input } = await setup();
    const w = await recordWork(db, agent(p.jaxon), input({ summary: 'first' }));
    await recordWork(db, agent(p.jaxon), input({ summary: 'second', done: [{ text: 'x', evidence: 'abc1234' }] }));
    const got = await getWorkItem(db, agent(p.jeremy), p.project.id, w.id);
    expect(got.updates.map(u => u.summary)).toEqual(['second', 'first']);
    expect(got.updates[0]).toMatchObject({ authorName: 'Jaxon', status: 'in_progress' });
    expect(got.updates[0].done[0].confirmed).toBe(true);
    expect(await code(getWorkItem(db, agent(p.jeremy), p.project.id, 'nope'))).toBe('not_found');
  });
});

describe('pathsOverlap', () => {
  it('matches equal and nested paths, ignoring trailing slashes', () => {
    expect(pathsOverlap('apps/site', 'apps/site/contact')).toBe(true);
    expect(pathsOverlap('apps/site/', 'apps/site')).toBe(true);
    expect(pathsOverlap('apps/site', 'apps/siteX')).toBe(false);
  });
});

describe('startWork', () => {
  const start = (p: Awaited<ReturnType<typeof setup>>['p'], over: Record<string, unknown> = {}) =>
    startWork(db, agent(p.jeremy), { projectId: p.project.id, repo: 'site', about: 'contact form', ...over });

  it("warns Jeremy about Jaxon's feat/site-ui on path apps/site/contact", async () => {
    const { p, input } = await setup();
    await recordWork(db, agent(p.jaxon), input({ paths: ['apps/site'] }));
    const r = await start(p, { paths: ['apps/site/contact', 'docs'] });
    expect(r.overlaps).toHaveLength(1);
    expect(r.overlaps[0]).toMatchObject({ reason: 'path', paths: ['apps/site/contact'], workItem: { key: 'feat/site-ui', ownerName: 'Jaxon' } });
  });

  it('normalises ./ and trailing slashes on record, and rejects non-repo-relative paths', async () => {
    const { p, input } = await setup();
    const w = await recordWork(db, agent(p.jaxon), input({ paths: ['./apps/site/', './/docs//api/', 'a/./b'] }));
    expect(w.paths).toEqual(['apps/site', 'docs/api', 'a/./b']);
    const r = await start(p, { paths: ['apps/site/contact'] });
    expect(r.overlaps).toHaveLength(1);
    const msg = 'paths must be repo-relative, e.g. apps/site';
    for (const bad of ['/Users/jaxon/x/apps/site', '\\x', '~/x', 'C:\\x', 'a/../b', '..', ' ', './', '']) {
      const e1 = await fail(recordWork(db, agent(p.jaxon), input({ paths: [bad] })));
      expect([bad, e1.code, e1.message]).toEqual([bad, 'validation', msg]);
      const e2 = await fail(start(p, { paths: [bad] }));
      expect([bad, e2.code, e2.message]).toEqual([bad, 'validation', msg]);
    }
  });

  it('no path overlap across repos', async () => {
    const { p, input } = await setup();
    await recordWork(db, agent(p.jaxon), input({ paths: ['apps/site'], area: undefined }));
    expect((await start(p, { repo: 'other', paths: ['apps/site'] })).overlaps).toEqual([]);
  });

  it("area overlap: no paths, area 'Site' gives reason area", async () => {
    const { p, input } = await setup();
    await recordWork(db, agent(p.jaxon), input({ paths: ['apps/site'] }));
    const r = await start(p, { area: 'Site' });
    expect(r.overlaps).toMatchObject([{ reason: 'area', paths: [] }]);
  });

  it('path wins when both path and area apply', async () => {
    const { p, input } = await setup();
    await recordWork(db, agent(p.jaxon), input({ paths: ['apps/site'] }));
    expect((await start(p, { area: 'Site', paths: ['apps/site'] })).overlaps[0].reason).toBe('path');
  });

  it('own items never overlap', async () => {
    const { p, input } = await setup();
    await recordWork(db, agent(p.jeremy), input({ paths: ['apps/site'] }));
    const r = await start(p, { area: 'Site', paths: ['apps/site'], about: 'site ui' });
    expect(r).toEqual({ overlaps: [], related: [] });
  });

  it('stale items still overlap with stale true', async () => {
    const { p, input } = await setup();
    const w = await recordWork(db, agent(p.jaxon), input({ paths: ['apps/site'] }));
    await ageItem(w.id, '30 days');
    expect((await start(p, { paths: ['apps/site'] })).overlaps).toMatchObject([{ reason: 'path', workItem: { stale: true } }]);
  });

  it("related finds Jaxon's merged feat/export by about 'csv export'", async () => {
    const { p, input } = await setup();
    await recordWork(db, agent(p.jaxon), input({ key: 'feat/export', title: 'CSV export', status: 'merged', area: undefined }));
    const r = await start(p, { about: 'csv export' });
    expect(r.overlaps).toEqual([]);
    expect(r.related.map(w => w.key)).toEqual(['feat/export']);
  });

  it('requires repo, about, and a known area', async () => {
    const { p } = await setup();
    const res = await fail(start(p, { repo: null }));
    expect([res.code, res.message]).toEqual(['validation', 'repo is required: pass repo from junction.json at the repo root']);
    expect(await code(start(p, { about: ' ' }))).toBe('validation');
    expect(await code(start(p, { area: 'Nope' }))).toBe('validation');
  });
});
