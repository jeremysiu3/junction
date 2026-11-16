import { afterAll, describe, expect, it } from 'vitest';
import { JunctionError, contextCounts, createDb, deleteContext, findOwner, listContext, saveArea, searchContext, writeContext } from '../src';
import { agent, human, makeProject } from './fixtures';

const db = createDb();
afterAll(() => db.end());

const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: JunctionError) => e.code);

describe('writeContext', () => {
  it("rejects kind 'update'", async () => {
    const p = await makeProject(db);
    const input = { projectId: p.project.id, kind: 'update' as never, title: 't', body: 'b' };
    expect(await code(writeContext(db, agent(p.jaxon), input))).toBe('validation');
  });
});

describe('writeContext size caps', () => {
  const msg = (p: Promise<unknown>) => p.then(() => 'ok', (e: JunctionError) => e.message);
  it('caps title at 200 and body at 10000 characters', async () => {
    const p = await makeProject(db);
    const w = (over: object) => writeContext(db, agent(p.jaxon), { projectId: p.project.id, kind: 'note', title: 't', body: 'b', ...over });
    expect(await msg(w({ body: 'a'.repeat(10001) }))).toBe('body must be at most 10000 characters');
    expect(await msg(w({ title: 'a'.repeat(201) }))).toBe('title must be at most 200 characters');
    expect(await msg(w({ body: 'a'.repeat(10000) }))).toBe('ok');
  });

  it('caps tags at 20 items of 50 characters', async () => {
    const p = await makeProject(db);
    const w = (tags: string[]) => writeContext(db, agent(p.jaxon), { projectId: p.project.id, kind: 'note', title: 't', body: 'b', tags });
    expect(await msg(w(Array(21).fill('t')))).toBe('tags must have at most 20 items');
    expect(await msg(w(['t'.repeat(51)]))).toBe('tags items must be at most 50 characters');
    expect(await msg(w([...Array(19).fill('t'), 't'.repeat(50)]))).toBe('ok');
  });
});

describe('memory write limit', () => {
  const seed = (p: Awaited<ReturnType<typeof makeProject>>, n: number, age: string) =>
    db`insert into context_entries (project_id, author_id, kind, title, body, created_at)
       select ${p.project.id}, ${p.jaxon.id}, 'note', 'N' || g, 'b', now() - ${age}::interval from generate_series(1, ${n}) g`;

  it('allows 100 memory entries per user per hour', async () => {
    const p = await makeProject(db);
    const w = () => writeContext(db, agent(p.jaxon), { projectId: p.project.id, kind: 'note', title: 't', body: 'b' });
    await seed(p, 100, '2 hours');
    expect(await code(w())).toBe('ok');
    await seed(p, 99, '10 minutes');
    const e = await w().then(() => null, (x: JunctionError) => x);
    expect(e?.code).toBe('limit');
    expect(e?.message).toBe('you can write at most 100 memory entries an hour; try again later');
    expect(await code(writeContext(db, agent(p.scott), { projectId: p.project.id, kind: 'note', title: 't', body: 'b' }))).toBe('ok');
  });
});

describe('replaceable decisions', () => {
  const decide = (p: Awaited<ReturnType<typeof makeProject>>, who: 'jeremy' | 'jaxon' | 'scott', title: string, over: object = {}) =>
    writeContext(db, agent(p[who]), { projectId: p.project.id, kind: 'decision', title, body: 'body of ' + title, ...over });

  it("Jaxon's agent replaces Jeremy's decision: search returns only the new one, with replaces inline", async () => {
    const p = await makeProject(db);
    const old = await decide(p, 'jeremy', 'Use mango queue');
    const next = await decide(p, 'jaxon', 'Use mango stream', { replaces: old.id });
    const r = await searchContext(db, agent(p.scott), { projectId: p.project.id, query: 'mango' });
    expect(r.map(e => e.id)).toEqual([next.id]);
    expect(r[0].replaces).toEqual({ id: old.id, title: 'Use mango queue', body: 'body of Use mango queue' });
    const plain = await decide(p, 'scott', 'Plain mango');
    const again = await searchContext(db, agent(p.scott), { projectId: p.project.id, query: 'plain' });
    expect(again.map(e => e.id)).toEqual([plain.id]);
    expect(again[0].replaces).toBeNull();
  });

  it("replacing twice gives validation 'already replaced'", async () => {
    const p = await makeProject(db);
    const old = await decide(p, 'jeremy', 'First');
    await decide(p, 'jaxon', 'Second', { replaces: old.id });
    const err = await decide(p, 'scott', 'Third', { replaces: old.id }).catch((e: JunctionError) => e);
    expect(err).toMatchObject({ code: 'validation', message: 'already replaced' });
  });

  it('concurrent replacements: the unique index backstop maps to the same error', async () => {
    const p = await makeProject(db);
    const old = await decide(p, 'jeremy', 'Race');
    const results = await Promise.all([
      decide(p, 'jaxon', 'A', { replaces: old.id }).catch((e: JunctionError) => e),
      decide(p, 'scott', 'B', { replaces: old.id }).catch((e: JunctionError) => e),
    ]);
    const errs = results.filter(r => r instanceof JunctionError);
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatchObject({ code: 'validation', message: 'already replaced' });
  });

  it('a private decision cannot replace a shared one; the old decision stays visible', async () => {
    const p = await makeProject(db);
    const old = await decide(p, 'jeremy', 'Keep papaya');
    expect(await code(decide(p, 'jaxon', 'Drop papaya', { replaces: old.id, visibility: 'private' }))).toBe('validation');
    const r = await searchContext(db, agent(p.scott), { projectId: p.project.id, query: 'papaya' });
    expect(r.map(e => e.id)).toEqual([old.id]);
  });

  it("rejects replaces on a note, a note target, a private decision, and another project's decision", async () => {
    const p = await makeProject(db);
    const other = await makeProject(db);
    const old = await decide(p, 'jeremy', 'Old');
    const note = await writeContext(db, agent(p.jeremy), { projectId: p.project.id, kind: 'note', title: 'N', body: 'b' });
    const priv = await decide(p, 'jeremy', 'Secret', { visibility: 'private' });
    const foreign = await decide(other, 'jeremy', 'Foreign');
    const nonDecision = { projectId: p.project.id, kind: 'note' as const, title: 'x', body: 'y', replaces: old.id };
    expect(await code(writeContext(db, agent(p.jaxon), nonDecision))).toBe('validation');
    expect(await code(decide(p, 'jaxon', 'x', { replaces: note.id }))).toBe('validation');
    expect(await code(decide(p, 'jaxon', 'x', { replaces: priv.id }))).toBe('validation');
    expect(await code(decide(p, 'jaxon', 'x', { replaces: foreign.id }))).toBe('validation');
    expect(await code(decide(p, 'jaxon', 'x', { replaces: 'not-a-uuid' }))).toBe('validation');
  });
});

describe('searchContext', () => {
  it("finds 'export' and ORs terms", async () => {
    const p = await makeProject(db);
    await writeContext(db, agent(p.jaxon), {
      projectId: p.project.id, kind: 'note', title: 'Reports', body: 'Jaxon owns the reports API; export lives here',
    });
    const a = await searchContext(db, agent(p.jeremy), { projectId: p.project.id, query: 'export' });
    expect(a).toHaveLength(1);
    expect(a[0].authorName).toBe('Jaxon');
    const b = await searchContext(db, agent(p.jeremy), { projectId: p.project.id, query: 'reports csv' });
    expect(b).toHaveLength(1);
  });

  it("hides another user's private entry but shows my own; blank query is invalid", async () => {
    const p = await makeProject(db);
    await writeContext(db, agent(p.jaxon), { projectId: p.project.id, kind: 'note', title: 'secret zebra', body: 'x', visibility: 'private' });
    const q = { projectId: p.project.id, query: 'zebra' };
    expect(await searchContext(db, agent(p.jeremy), q)).toHaveLength(0);
    expect(await searchContext(db, agent(p.jaxon), q)).toHaveLength(1);
    expect(await code(searchContext(db, agent(p.jeremy), { ...q, query: '  ' }))).toBe('validation');
  });
});

describe('ownership', () => {
  it('writeContext rejects kind ownership', async () => {
    const p = await makeProject(db);
    const e = await writeContext(db, agent(p.jaxon), { projectId: p.project.id, kind: 'ownership' as never, title: 'Billing owner', body: 'Jaxon owns billing' })
      .catch((x: JunctionError) => x);
    expect([(e as JunctionError).code, (e as JunctionError).message]).toEqual(['validation', 'ownership comes from Responsibilities in Project settings; ask a project admin to set the owner']);
  });
});

describe('findOwner', () => {
  it('returns areas and all members, with no entries', async () => {
    const p = await makeProject(db);
    const r = await findOwner(db, agent(p.jeremy), { projectId: p.project.id, topic: 'billing' });
    expect(r).not.toHaveProperty('entries');
    expect(r.areas).toEqual([]);
    expect(r.members.map(m => m.name).sort()).toEqual(['Jaxon', 'Jeremy', 'Scott']);
  });

  it('returns the Reports API area', async () => {
    const p = await makeProject(db);
    await saveArea(db, human(p.jeremy), { projectId: p.project.id, name: 'Reports API', ownerId: p.jaxon.id, description: 'CSV export and reports endpoints' });
    const r = await findOwner(db, agent(p.jeremy), { projectId: p.project.id, topic: 'reports export' });
    expect(r.areas[0]).toMatchObject({ name: 'Reports API', ownerName: 'Jaxon', ownerEmail: p.jaxon.email });
  });
});

describe('deleteContext and listContext', () => {
  type P = Awaited<ReturnType<typeof makeProject>>;
  const write = (p: P, who: 'jeremy' | 'jaxon' | 'scott', title: string, over: object = {}) =>
    writeContext(db, agent(p[who]), { projectId: p.project.id, kind: 'note', title, body: 'body of ' + title, ...over });
  const gone = async (id: string) => (await db`select 1 from context_entries where id = ${id}`).length === 0;

  it('the author or an admin deletes; other members, agents and other projects cannot', async () => {
    const p = await makeProject(db);
    const mine = await write(p, 'jaxon', 'Jaxon note');
    const theirs = await write(p, 'scott', 'Scott note');
    const other = await makeProject(db);
    expect(await code(deleteContext(db, agent(p.jaxon), p.project.id, mine.id))).toBe('forbidden');
    expect(await code(deleteContext(db, human(p.jaxon), p.project.id, theirs.id))).toBe('forbidden');
    expect(await code(deleteContext(db, human(other.jeremy), other.project.id, mine.id))).toBe('not_found');
    expect(await code(deleteContext(db, human(p.jaxon), p.project.id, 'not-a-uuid'))).toBe('not_found');
    await deleteContext(db, human(p.jaxon), p.project.id, mine.id);
    await deleteContext(db, human(p.jeremy), p.project.id, theirs.id); // admin
    expect(await gone(mine.id)).toBe(true);
    expect(await gone(theirs.id)).toBe(true);
  });

  it("someone else's private entry is not found, even for an admin", async () => {
    const p = await makeProject(db);
    const secret = await write(p, 'jaxon', 'Private note', { visibility: 'private' });
    expect(await code(deleteContext(db, human(p.jeremy), p.project.id, secret.id))).toBe('not_found');
    await deleteContext(db, human(p.jaxon), p.project.id, secret.id);
    expect(await gone(secret.id)).toBe(true);
  });

  it('deleting a replacement makes the old decision current again; a replaced decision can be deleted', async () => {
    const p = await makeProject(db);
    const old = await write(p, 'jeremy', 'Use kiwi queue', { kind: 'decision' });
    const next = await write(p, 'jaxon', 'Use kiwi stream', { kind: 'decision', replaces: old.id });
    await deleteContext(db, human(p.jaxon), p.project.id, next.id);
    expect((await searchContext(db, agent(p.scott), { projectId: p.project.id, query: 'kiwi' })).map(e => e.id)).toEqual([old.id]);
    const again = await write(p, 'jaxon', 'Use kiwi bus', { kind: 'decision', replaces: old.id });
    await deleteContext(db, human(p.jeremy), p.project.id, old.id);
    const [r] = await db`select replaces_id from context_entries where id = ${again.id}`;
    expect(r.replacesId).toBeNull();
  });

  it('filters by kind and tag; counts per kind follow the tag and visibility', async () => {
    const p = await makeProject(db);
    await write(p, 'jaxon', 'Auth note', { tags: ['auth', 'web'] });
    await write(p, 'scott', 'Auth decision', { kind: 'decision', tags: ['auth'] });
    await write(p, 'scott', 'Billing decision', { kind: 'decision', tags: ['billing'] });
    await write(p, 'scott', 'Scott private auth', { tags: ['auth'], visibility: 'private' });
    const titles = async (o: object) => (await listContext(db, human(p.jaxon), p.project.id, { limit: 50, ...o })).map(x => x.title).sort();
    expect(await titles({ kind: 'decision' })).toEqual(['Auth decision', 'Billing decision']);
    expect(await titles({ tag: 'auth' })).toEqual(['Auth decision', 'Auth note']);
    expect(await titles({ kind: 'decision', tag: 'auth' })).toEqual(['Auth decision']);
    expect(await contextCounts(db, human(p.jaxon), p.project.id)).toEqual({ all: 3, decision: 2, note: 1, update: 0, ownership: 0 });
    expect(await contextCounts(db, human(p.jaxon), p.project.id, { tag: 'auth' })).toEqual({ all: 2, decision: 1, note: 1, update: 0, ownership: 0 });
    expect(await contextCounts(db, human(p.scott), p.project.id, { tag: 'auth' })).toEqual({ all: 3, decision: 1, note: 2, update: 0, ownership: 0 });
  });

  it('search matches part of a title, body or tag, case-insensitively, treats % and _ literally, and narrows counts', async () => {
    const p = await makeProject(db);
    await write(p, 'jaxon', 'Session cookies are httpOnly', { tags: ['web'] });
    await write(p, 'scott', 'Retry policy', { kind: 'decision', body: 'Back off on 429 COOKIE errors' });
    await write(p, 'scott', 'Billing', { tags: ['cookiejar'] });
    await write(p, 'scott', '100% uptime target', { body: 'snake_case names' });
    const titles = async (o: object) => (await listContext(db, human(p.jaxon), p.project.id, { limit: 50, ...o })).map(x => x.title).sort();
    expect(await titles({ q: 'cook' })).toEqual(['Billing', 'Retry policy', 'Session cookies are httpOnly']);
    expect(await titles({ q: 'cook', kind: 'decision' })).toEqual(['Retry policy']);
    expect(await titles({ q: '100%' })).toEqual(['100% uptime target']);
    expect(await titles({ q: '%' })).toEqual(['100% uptime target']);
    expect(await titles({ q: 'e_c' })).toEqual(['100% uptime target']);
    expect(await contextCounts(db, human(p.jaxon), p.project.id, { q: 'cook' })).toEqual({ all: 3, decision: 1, note: 2, update: 0, ownership: 0 });
  });

  it('lists project entries plus your own private ones, newest first, with canDelete and replaced, paged by before', async () => {
    const p = await makeProject(db);
    const a = await write(p, 'jaxon', 'A');
    const b = await write(p, 'scott', 'B', { kind: 'decision' });
    const c = await write(p, 'jaxon', 'C', { visibility: 'private' });
    await write(p, 'scott', 'D', { visibility: 'private' });
    const e = await write(p, 'scott', 'E', { kind: 'decision', replaces: b.id });
    const list = await listContext(db, human(p.jaxon), p.project.id, { limit: 50 });
    expect(list.map(x => x.title)).toEqual(['E', 'C', 'B', 'A']);
    expect(list.map(x => [x.title, x.canDelete, x.replaced])).toEqual([['E', false, false], ['C', true, false], ['B', false, true], ['A', true, false]]);
    expect((await listContext(db, human(p.jeremy), p.project.id, { limit: 50 })).every(x => x.canDelete)).toBe(true);
    const page = await listContext(db, human(p.jaxon), p.project.id, { limit: 2 });
    expect(page.map(x => x.id)).toEqual([e.id, c.id]);
    const next = await listContext(db, human(p.jaxon), p.project.id, { limit: 2, before: page[1].createdAt });
    expect(next.map(x => x.id)).toEqual([b.id, a.id]);
    expect(await code(listContext(db, human((await makeProject(db)).jeremy), p.project.id, { limit: 5 }))).toBe('forbidden');
  });
});
