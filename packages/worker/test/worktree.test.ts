import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { gitPaths, worktreeIntact } from '../src/worktree.js';

let root: string;
let repo: string;
let wt: string;
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x.io', ...args], { cwd, stdio: 'pipe' });

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'junction-worktree-test-')));
  repo = join(root, 'repo');
  mkdirSync(repo);
  git(repo, 'init', '-q');
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'init');
  wt = join(root, 'wts', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  git(repo, 'worktree', 'add', '-q', '-b', 'junction/x', wt);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

it('a fresh worktree is intact; paths come from the repo and match git', async () => {
  const p = await gitPaths(repo, wt);
  expect(p.worktreeGitDir).toBe(join(repo, '.git', 'worktrees', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'));
  expect(await worktreeIntact(wt, repo)).toBe(true);
});

it('a rewritten .git file is detected', async () => {
  mkdirSync(join(wt, '.cache', 'g'), { recursive: true });
  writeFileSync(join(wt, '.git'), `gitdir: ${join(wt, '.cache', 'g')}\n`);
  expect(await worktreeIntact(wt, repo)).toBe(false);
});

it('a rewritten commondir is detected', async () => {
  const { worktreeGitDir } = await gitPaths(repo, wt);
  mkdirSync(join(wt, '.cache', 'common'), { recursive: true });
  writeFileSync(join(worktreeGitDir, 'commondir'), join(wt, '.cache', 'common'));
  expect(await worktreeIntact(wt, repo)).toBe(false);
});

it('a missing .git file is detected', async () => {
  rmSync(join(wt, '.git'));
  expect(await worktreeIntact(wt, repo)).toBe(false);
});

it('an admin dir git renamed after a name collision is found', async () => {
  const other = join(root, 'other-wts', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'); // same folder name, different parent
  git(repo, 'worktree', 'add', '-q', '-b', 'junction/y', other);
  const p = await gitPaths(repo, other);
  expect(p.worktreeGitDir).toBe(join(repo, '.git', 'worktrees', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa1'));
  expect((await gitPaths(repo, wt)).worktreeGitDir).toBe(join(repo, '.git', 'worktrees', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'));
  expect(await worktreeIntact(other, repo)).toBe(true);
  writeFileSync(join(other, '.git'), `gitdir: ${join(other, '.cache')}\n`);
  expect(await worktreeIntact(other, repo)).toBe(false);
  expect(await worktreeIntact(wt, repo)).toBe(true);
});

it('a directory git does not know is not intact', async () => {
  const stranger = join(root, 'stranger');
  mkdirSync(stranger);
  writeFileSync(join(stranger, '.git'), `gitdir: ${join(repo, '.git', 'worktrees', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')}\n`);
  expect(await worktreeIntact(stranger, repo)).toBe(false);
});

it('relative pointer paths (worktree.useRelativePaths) pass; tampered ones still fail', async (ctx) => {
  const rel = join(root, 'rel-wts', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
  try {
    git(repo, '-c', 'worktree.useRelativePaths=true', 'worktree', 'add', '-q', '-b', 'junction/rel', rel);
  } catch {
    return ctx.skip(); // git older than 2.48
  }
  if (!/^gitdir: \.\./.test(readFileSync(join(rel, '.git'), 'utf8'))) return ctx.skip();
  expect(await worktreeIntact(rel, repo)).toBe(true);
  writeFileSync(join(rel, '.git'), 'gitdir: ../../elsewhere\n');
  expect(await worktreeIntact(rel, repo)).toBe(false);
});

it("a sibling's rewritten admin gitdir cannot make this worktree look tampered", async () => {
  const b = join(root, 'wts', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
  git(repo, 'worktree', 'add', '-q', '-b', 'junction/b', b);
  writeFileSync(join(repo, '.git', 'worktrees', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'gitdir'), `${join(b, '.git')}\n`);
  expect(await worktreeIntact(b, repo)).toBe(true);
  writeFileSync(join(b, '.git'), `gitdir: ${join(b, '.cache')}\n`);
  expect(await worktreeIntact(b, repo)).toBe(false);
});
