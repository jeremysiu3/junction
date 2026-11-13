import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { acquireLock, cleanStaleRuns, releaseLock, projectWorktrees, validApiUrl, validProjects, validRepos, validSlug } from '../src/startup.js';

let dir: string;
beforeEach(() => void (dir = mkdtempSync(join(tmpdir(), 'junction-startup-test-'))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('worker lock', () => {
  it('takes a free lock and releases it', () => {
    const p = join(dir, 'sub', 'worker.lock');
    expect(acquireLock(p)).toBeUndefined();
    expect(readFileSync(p, 'utf8')).toBe(String(process.pid));
    releaseLock(p);
    expect(existsSync(p)).toBe(false);
  });

  it('a live pid holding the lock is returned and the lock left alone', () => {
    const p = join(dir, 'worker.lock');
    writeFileSync(p, String(process.ppid)); // the parent process is alive
    expect(acquireLock(p)).toBe(process.ppid);
    expect(readFileSync(p, 'utf8')).toBe(String(process.ppid));
    releaseLock(p); // not ours: stays
    expect(existsSync(p)).toBe(true);
  });

  it('a stale pid is taken over', async () => {
    const child = spawn(process.execPath, ['-e', '']);
    await new Promise((r) => child.on('close', r));
    const p = join(dir, 'worker.lock');
    writeFileSync(p, String(child.pid));
    expect(acquireLock(p)).toBeUndefined();
    expect(readFileSync(p, 'utf8')).toBe(String(process.pid));
  });

  it('garbage in the lock file counts as stale', () => {
    const p = join(dir, 'worker.lock');
    writeFileSync(p, 'nope');
    expect(acquireLock(p)).toBeUndefined();
  });
});

it('cleanStaleRuns removes run-* folders only, and tolerates a missing root', () => {
  cleanStaleRuns(join(dir, 'missing'));
  mkdirSync(join(dir, 'run-abc', 'npm-cache'), { recursive: true });
  mkdirSync(join(dir, 'other'));
  cleanStaleRuns(dir);
  expect(existsSync(join(dir, 'run-abc'))).toBe(false);
  expect(existsSync(join(dir, 'other'))).toBe(true);
});

describe('config validation', () => {
  it('apiUrl must be https, or http only for localhost', () => {
    expect(validApiUrl('http://localhost:3000')).toBe(true);
    expect(validApiUrl('http://127.0.0.1:3000')).toBe(true);
    expect(validApiUrl('https://junction.example')).toBe(true);
    for (const bad of ['http://app.junctionmcp.com', 'http://localhost.evil.com', 'http://evil.com/localhost', 'http://127.0.0.1.evil.com']) expect(validApiUrl(bad), bad).toBe(false);
    for (const bad of ['localhost:3000', 'ftp://x.io', 'file:///etc/passwd', '', 'not a url', 5, undefined]) expect(validApiUrl(bad)).toBe(false);
  });

  it('repos must be a non-array object of string paths', () => {
    expect(validRepos({ junction: '/code/junction' })).toBe(true);
    expect(validRepos({})).toBe(true);
    for (const bad of [[], ['/a'], null, undefined, 'x', { a: 1 }, { a: null }]) expect(validRepos(bad)).toBe(false);
  });
});

it('projects must be a non-empty map of slug to non-empty repos map', () => {
  expect(validProjects({ demo: { site: '/x' } })).toBe(true);
  for (const bad of [{}, { 'Bad Slug': { site: '/x' } }, { demo: {} }, { demo: { site: 1 } }, null, [], 'x']) expect(validProjects(bad)).toBe(false);
});

describe('per-project, per-user worktrees', () => {
  const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const U1 = '11111111-1111-1111-1111-111111111111';
  const U2 = '22222222-2222-2222-2222-222222222222';

  it('validSlug', () => {
    expect(validSlug('my-project-2')).toBe(true);
    for (const bad of ['', 'A', '../x', 'a/b', 'a b', 'a_b', 5, undefined]) expect(validSlug(bad)).toBe(false);
  });

  it('dir is <root>/<project>/<user>/<id> and rejects non-UUIDs and bad slugs', () => {
    const w = projectWorktrees(dir, 'site');
    expect(w.dir(U1, A)).toBe(join(dir, 'site', U1, A));
    expect(() => w.dir(U1, '../x')).toThrow();
    expect(() => w.dir('../x', A)).toThrow();
    expect(() => w.list('u1')).toThrow();
    expect(() => projectWorktrees(dir, '../x')).toThrow();
  });

  it("list returns only this user's task folders; other users, projects and the older layouts are left out", () => {
    for (const p of [['site', U1, A], ['site', U2, B], ['other', U1, B], ['site', B]]) mkdirSync(join(dir, ...p), { recursive: true });
    mkdirSync(join(dir, 'site', U1, 'not-a-task'));
    const w = projectWorktrees(dir, 'site');
    expect(w.list(U1)).toEqual([A]);
    expect(w.list(U2)).toEqual([B]);
    expect(projectWorktrees(dir, 'empty').list(U1)).toEqual([]);
  });
});
