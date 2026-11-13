import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'; // exists, but not ours
  }
};

// Returns the pid of another live worker holding the lock, or undefined once we hold it.
// ponytail: a recycled pid after a reboot reads as live, and two workers racing on a stale lock can both win; delete the file by hand.
export function acquireLock(path: string, pid = process.pid): number | undefined {
  mkdirSync(dirname(path), { recursive: true });
  try {
    writeFileSync(path, String(pid), { flag: 'wx' });
    return;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
  }
  const other = Number(readFileSync(path, 'utf8'));
  if (other > 0 && other !== pid && alive(other)) return other;
  writeFileSync(path, String(pid));
}

export function releaseLock(path: string, pid = process.pid) {
  try {
    if (Number(readFileSync(path, 'utf8')) === pid) rmSync(path);
  } catch {}
}

// Run folders hold the worker credential; a SIGKILLed worker leaves them behind. Only call with the lock held.
export function cleanStaleRuns(runsRoot: string) {
  let names: string[] = [];
  try {
    names = readdirSync(runsRoot);
  } catch {}
  for (const n of names) if (n.startsWith('run-')) rmSync(join(runsRoot, n), { recursive: true, force: true });
}

// https anywhere; plain http only for the local dev server, so the worker token never crosses the network in clear.
export const validApiUrl = (u: unknown): u is string => {
  try {
    if (typeof u !== 'string') return false;
    const { protocol, hostname } = new URL(u);
    return protocol === 'https:' || (protocol === 'http:' && (hostname === '127.0.0.1' || hostname === 'localhost'));
  } catch {
    return false;
  }
};

export const validRepos = (r: unknown): r is Record<string, string> =>
  !!r && typeof r === 'object' && !Array.isArray(r) && Object.values(r).every((v) => typeof v === 'string');

export const validSlug = (s: unknown): s is string => typeof s === 'string' && /^[a-z0-9-]+$/.test(s);

// { "<project slug>": { "<junction repo>": "<local clone path>" } }, at least one project with at least one repo each.
export const validProjects = (v: unknown): v is Record<string, Record<string, string>> =>
  !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 0 &&
  Object.entries(v).every(([slug, repos]) => validSlug(slug) && validRepos(repos) && Object.keys(repos).length > 0);

const UUID = /^[0-9a-f-]{36}$/i;

// Worktrees live under <root>/<project slug>/<user id>/<task id>: two users on one machine never clean up each other's.
export function projectWorktrees(root: string, project: string) {
  if (!validSlug(project)) throw new Error('project is not a slug');
  const userDir = (userId: string) => {
    if (!UUID.test(userId)) throw new Error('user id is not a UUID');
    return join(root, project, userId);
  };
  return {
    dir(userId: string, id: string) {
      if (!UUID.test(id)) throw new Error('task id is not a UUID');
      return join(userDir(userId), id);
    },
    list(userId: string) {
      const base = userDir(userId);
      return existsSync(base) ? readdirSync(base).filter((n) => UUID.test(n)) : [];
    },
  };
}
