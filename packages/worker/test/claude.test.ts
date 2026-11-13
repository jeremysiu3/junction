import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { childEnv, runClaudeProcess, sandboxSettings } from '../src/claude.js';
import { RUN_TIMEOUT } from '../src/worker.js';

const settings = (): any =>
  sandboxSettings({
    worktree: '/wt', gitDir: '/r/.git', worktreeGitDir: '/r/.git/worktrees/wt', apiHost: 'junction.example', nodePrefix: '/usr/local', npmCache: '/run/npm-cache',
  });

it('sandboxSettings allowWrite is narrowed, and localhost binding stays off', () => {
  const s = settings();
  expect(s.sandbox.filesystem.allowWrite).toEqual([
    '/wt', '/r/.git/objects', '/r/.git/refs/heads/junction', '/r/.git/logs/refs/heads/junction', '/r/.git/worktrees/wt', '/run/npm-cache',
  ]);
  expect(s.sandbox.filesystem.allowWrite).not.toContain('/r/.git');
  expect(s.sandbox.filesystem.denyWrite).toEqual(['/r/.git/hooks', '/r/.git/config', '/r/.git/worktrees/wt/commondir', '/wt/.git']);
  // allowLocalBinding may also open outbound localhost (the local Postgres), defeating the host:port allowlist
  expect(s.sandbox.network).not.toHaveProperty('allowLocalBinding');
  expect(s.sandbox.network.allowedDomains).toEqual(['junction.example', 'registry.npmjs.org']);
});

it('childEnv sets GIT_TERMINAL_PROMPT=0 and does not pin GIT_DIR, GIT_COMMON_DIR or GIT_WORK_TREE', () => {
  const env = childEnv({ PATH: '/bin' }, '/c', {});
  expect(env.GIT_TERMINAL_PROMPT).toBe('0');
  expect(env).toMatchObject({ GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' });
  // Pinned vars would send every git call the agent makes, in any directory, into the task's worktree git dir.
  for (const k of ['GIT_DIR', 'GIT_COMMON_DIR', 'GIT_WORK_TREE']) expect(env).not.toHaveProperty(k);
});

describe.skipIf(process.platform === 'win32')('runClaudeProcess', () => {
  const saved = { PATH: process.env.PATH, HOME: process.env.HOME };
  let root: string;
  let repo: string;
  let wt: string;
  let logs: string[];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'junction-claude-test-'));
    repo = join(root, 'repo');
    mkdirSync(repo);
    execFileSync('git', ['init', '-q'], { cwd: repo });
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x.io', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: repo });
    wt = join(root, 'wt');
    execFileSync('git', ['worktree', 'add', '-q', '-b', 'junction/x', wt], { cwd: repo });
    mkdirSync(join(root, 'bin'));
    process.env.PATH = `${join(root, 'bin')}:${saved.PATH}`;
    process.env.HOME = join(root, 'home'); // runs/ lands here, not in the real ~/.junction
    logs = [];
  });
  afterEach(() => {
    Object.assign(process.env, saved);
    rmSync(root, { recursive: true, force: true });
  });

  const fakeClaude = (body: string) => {
    writeFileSync(join(root, 'bin', 'claude'), body);
    chmodSync(join(root, 'bin', 'claude'), 0o755);
  };
  const start = (runMs: number) =>
    runClaudeProcess({ apiUrl: 'http://localhost:3000', token: 'jw_fake', project: 'p', log: (l) => void logs.push(l), runMs })({
      cwd: wt, prompt: 'x', branch: 'junction/x', repoDir: repo, repo: 'r',
    });
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  it('kills the process group on timeout and settles once', async () => {
    fakeClaude(`#!/bin/sh\necho $$ > "${root}/parent.pid"\nsleep 300 &\necho $! > "${root}/child.pid"\nwait\n`);
    let settled = 0;
    const result = start(1500).then(() => 'ok', (e: Error) => e.message).finally(() => settled++);
    expect(await result).toBe(RUN_TIMEOUT);
    const pids = ['parent', 'child'].map((n) => Number(readFileSync(join(root, `${n}.pid`), 'utf8')));
    for (let i = 0; i < 40 && pids.some(alive); i++) await new Promise((r) => setTimeout(r, 50));
    expect(pids.map(alive)).toEqual([false, false]);
    await new Promise((r) => setTimeout(r, 100)); // let the late 'close' arrive
    expect(settled).toBe(1);
    expect(logs).toEqual([]);
    expect(existsSync(join(root, 'home', '.junction', 'runs'))).toBe(true);
  });

  it('a spawn error is reported once, with no extra "exited" log from the close that follows', async () => {
    symlinkSync(execFileSync('which', ['git'], { encoding: 'utf8' }).trim(), join(root, 'bin', 'git'));
    process.env.PATH = join(root, 'bin'); // git, but no claude
    await expect(start(60_000)).rejects.toThrow(/ENOENT/);
    await new Promise((r) => setTimeout(r, 200));
    expect(logs).toEqual([]);
  });

  it('a nonzero exit is logged once and resolves', async () => {
    fakeClaude('#!/bin/sh\necho oops >&2\nexit 3\n');
    await expect(start(60_000)).resolves.toBeUndefined();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('claude exited with code 3');
  });

  it('writes an http MCP config with the bearer and project headers', async () => {
    // the run dir is removed afterwards, so the fake claude copies the config it was given
    fakeClaude(`#!/bin/sh\nwhile [ $# -gt 0 ]; do [ "$1" = --mcp-config ] && cp "$2" "${root}/mcp.json"; shift; done\n`);
    await start(60_000);
    const j = JSON.parse(readFileSync(join(root, 'mcp.json'), 'utf8')).mcpServers.junction;
    expect(j.type).toBe('http');
    expect(j.url).toBe('http://localhost:3000/mcp');
    expect(Object.keys(j.headers).sort()).toEqual(['Authorization', 'X-Junction-Project', 'X-Junction-Repo']);
    expect(j.headers.Authorization).toMatch(/^Bearer jw_/);
    expect([j.headers['X-Junction-Project'], j.headers['X-Junction-Repo']]).toEqual(['p', 'r']);
    expect(j).not.toHaveProperty('command');
  });
});
