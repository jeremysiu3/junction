#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { claudeVersionOk, runClaudeProcess, runsRoot } from './claude.js';
import { exec } from './exec.js';
import { worktreeIntact } from './worktree.js';
import { acquireLock, cleanStaleRuns, projectWorktrees, releaseLock, validApiUrl, validProjects } from './startup.js';
import { clean, tick, type Deps } from './worker.js';

const POLL_MS = 15_000;
const configPath = process.env.JUNCTION_WORKER_CONFIG || join(homedir(), '.junction', 'worker.json');
let cfg: Record<string, unknown> = {};
try {
  cfg = JSON.parse(readFileSync(configPath, 'utf8'));
} catch {}
const { apiUrl, projects } = cfg;
const workerToken = process.env.JUNCTION_WORKER_TOKEN || cfg.token;
if (!validApiUrl(apiUrl) || typeof workerToken !== 'string' || !workerToken.startsWith('jw_') || !validProjects(projects)) {
  console.error(
    `The Junction worker needs ${configPath} with {"apiUrl": "https://...", "token": "jw_...", "projects": {"<project slug>": {"<junction repo>": "<local clone path>"}}}. JUNCTION_WORKER_TOKEN overrides token.`,
  );
  process.exit(1);
}

try {
  await exec('gh', ['--version']);
  await exec('gh', ['auth', 'status']);
} catch {
  console.error('The Junction worker needs the GitHub CLI (gh), logged in.');
  process.exit(1);
}

try {
  if (!claudeVersionOk(await exec('claude', ['--version']))) throw new Error('too old');
} catch {
  console.error('The Junction worker needs Claude Code 2.1.314 or newer.');
  process.exit(1);
}

const lockPath = join(homedir(), '.junction', 'worker.lock');
const other = acquireLock(lockPath);
if (other) {
  console.error(`Another Junction worker is already running (pid ${other}).`);
  process.exit(1);
}
process.on('exit', () => releaseLock(lockPath));
// A detached claude run doesn't see the terminal's Ctrl-C; exiting runs the handler that kills its group.
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(sig, () => process.exit(130));
cleanStaleRuns(runsRoot(homedir())); // the lock means no other worker's run is live

const log = (line: string) => console.log(`${new Date().toISOString()} ${line}`);

const depsFor = (project: string, repos: Record<string, string>): Deps => {
  const worktrees = projectWorktrees(join(homedir(), '.junction', 'worktrees'), project);
  const plog = (line: string) => log(`[${project}] ${line}`);
  return {
    async api(tool, args = {}) {
      const res = await fetch(`${apiUrl}/api/agent/${tool}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${workerToken}`, 'X-Junction-Project': project, 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(30_000),
      });
      const body: any = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(body?.error?.message ?? `${tool} failed with HTTP ${res.status}`), { code: body?.error?.code });
      return JSON.parse(body.result);
    },
    git: (cwd, args) => exec('git', args, { cwd }),
    gh: (cwd, args) => exec('gh', args, { cwd }),
    runClaude: runClaudeProcess({ apiUrl, token: workerToken, project, log: plog }),
    repos,
    worktreeDir: worktrees.dir,
    listWorktrees: worktrees.list,
    worktreeIntact,
    exists: existsSync,
    log: plog,
  };
};
const all = Object.entries(projects).map(([slug, repos]) => ({ slug, deps: depsFor(slug, repos) }));

log(`worker started for ${all.map((p) => p.slug).join(', ')}`);
for (;;) {
  for (const { slug, deps } of all) {
    try {
      await tick(deps);
    } catch (e) {
      log(`[${slug}] tick failed: ${clean(e instanceof Error ? e.message : String(e))}`);
    }
  }
  await sleep(POLL_MS);
}
