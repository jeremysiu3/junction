import { afterAll, describe, expect, it } from 'vitest';
import { JunctionError, createDb, findOwner, saveArea, searchContext, writeContext } from '../src';
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
