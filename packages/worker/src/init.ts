import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { exec } from './exec.js';
import { validApiUrl, validRepos, validSlug } from './startup.js';

export const DEFAULT_API_URL = 'https://app.junctionmcp.com';
export const validToken = (t: unknown): t is string => typeof t === 'string' && /^jw_[A-Za-z0-9_-]{43}$/.test(t);

// junction.json at the repo root names the project and this repo.
export function readRepoFile(root: string): { project: string; repo: string } {
  let j: { project?: unknown; repo?: unknown } | undefined;
  try {
    j = JSON.parse(readFileSync(join(root, 'junction.json'), 'utf8'));
  } catch {
    throw new Error(`No junction.json in ${root}. Commit the one from your project's settings page, then run this again.`);
  }
  if (!validSlug(j?.project) || typeof j?.repo !== 'string' || !j.repo.trim()) {
    throw new Error('junction.json needs {"project": "<project slug>", "repo": "<repo name>"}.');
  }
  return { project: j.project, repo: j.repo.trim() };
}

// Adds or moves one repo; every other project and repo is kept.
export function mergeConfig(
  existing: Record<string, unknown>,
  add: { apiUrl: string; token: unknown; project: string; repo: string; path: string },
): Record<string, unknown> {
  const raw = existing.projects && typeof existing.projects === 'object' && !Array.isArray(existing.projects) ? existing.projects : {};
  const projects = Object.fromEntries(Object.entries(raw).filter(([slug, repos]) => validSlug(slug) && validRepos(repos))) as Record<string, Record<string, string>>;
  return {
    ...existing,
    apiUrl: add.apiUrl,
    token: add.token,
    projects: { ...projects, [add.project]: { ...projects[add.project], [add.repo]: add.path } },
  };
}

function askHidden(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  let muted = false;
  (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s) => void (muted || process.stdout.write(s));
  const answer = new Promise<string>((ok) => {
    rl.on('close', () => ok('')); // input ended without an answer
    rl.question(question, (a) => (ok(a.trim()), rl.close(), process.stdout.write('\n')));
  });
  muted = true;
  return answer;
}

// 'ok', or why the server refused: a bad token (401) or not a member of the project (403/404).
async function check(apiUrl: string, token: string, project: string): Promise<'ok' | 'token' | string> {
  const res = await fetch(`${apiUrl}/api/agent/worker_queue`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'X-Junction-Project': project, 'Content-Type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(30_000),
  });
  if (res.ok) return 'ok';
  if (res.status === 401) return 'token';
  const body: any = await res.json().catch(() => ({}));
  return body?.error?.message ?? `HTTP ${res.status}`;
}

// `npx junctionmcp init`, run inside a clone: maps this repo in the worker config, asking for the token only when it has none that works.
export async function runInit(configPath: string): Promise<void> {
  let root: string;
  try {
    root = (await exec('git', ['rev-parse', '--show-toplevel'])).trim();
  } catch {
    throw new Error('Run this inside your clone of the repo (a git folder with junction.json at its root).');
  }
  const { project, repo } = readRepoFile(root);
  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch {}
  const apiUrl = process.env.JUNCTION_API_URL || (validApiUrl(existing.apiUrl) ? existing.apiUrl : DEFAULT_API_URL);
  if (!validApiUrl(apiUrl)) throw new Error('JUNCTION_API_URL must be https (or http on localhost).');

  let token = process.env.JUNCTION_WORKER_TOKEN || existing.token;
  let typed = false;
  for (;;) {
    if (!validToken(token)) {
      token = await askHidden('Worker token (create one on Agent setup in the Junction dashboard): ');
      typed = true;
      if (!validToken(token)) throw new Error("That isn't a worker token. It starts with jw_.");
    }
    const result = await check(apiUrl, token, project);
    if (result === 'ok') break;
    if (result === 'token' && !typed) {
      console.log('The saved worker token was revoked or is invalid.');
      token = undefined;
      continue;
    }
    throw new Error(result === 'token' ? "That token isn't valid or was revoked. Create a new one on Agent setup." : `Junction refused project ${project}: ${result}`);
  }

  mkdirSync(dirname(configPath), { recursive: true, mode: 0o700 });
  // A token from JUNCTION_WORKER_TOKEN stays out of the file, as the user chose.
  const saved = process.env.JUNCTION_WORKER_TOKEN ? existing.token : token;
  writeFileSync(configPath, JSON.stringify(mergeConfig(existing, { apiUrl, token: saved, project, repo, path: root }), null, 2) + '\n', { mode: 0o600 });
  chmodSync(configPath, 0o600); // an older file keeps its mode on overwrite
  console.log(`Added ${repo} (${root}) to ${project} in ${configPath}.`);
  console.log('Start the worker with: npx junctionmcp (restart it if it is already running)');
}
