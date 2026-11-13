import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { exec } from './exec.js';

// Paths come from the repo, never from files inside the worktree (the sandboxed agent can rewrite those).
// git names a worktree's admin dir after its folder but appends a number on a collision, so find it by the
// `gitdir` file in each admin dir, which holds the path of <worktree>/.git (relative with worktree.useRelativePaths).
function adminDirOf(gitDir: string, worktree: string): string | undefined {
  const real = realpathSync(worktree);
  let names: string[] = [];
  try {
    names = readdirSync(join(gitDir, 'worktrees'));
  } catch {} // no worktrees yet
  const candidates = names.map((n) => join(gitDir, 'worktrees', n)).filter((admin) => {
    try {
      const dotGit = resolve(admin, readFileSync(join(admin, 'gitdir'), 'utf8').trim());
      return basename(dotGit) === '.git' && realpathSync(dirname(dotGit)) === real;
    } catch {
      return false;
    }
  });
  // Another worktree's agent can rewrite its own admin dir's gitdir to claim this path; prefer the candidate the pointers confirm.
  return candidates.find((admin) => pointersOk(worktree, gitDir, admin)) ?? candidates[0];
}

export async function gitPaths(repoDir: string, worktree: string): Promise<{ gitDir: string; worktreeGitDir: string }> {
  const gitDir = realpathSync(resolve(repoDir, (await exec('git', ['rev-parse', '--git-common-dir'], { cwd: repoDir })).trim()));
  const worktreeGitDir = adminDirOf(gitDir, worktree);
  if (!worktreeGitDir) throw new Error(`no git worktree entry for ${worktree}`);
  return { gitDir, worktreeGitDir };
}

// True when both pointer files still lead where git put them. Reads files only: no git runs in the worktree.
export function pointersOk(worktree: string, gitDir: string, worktreeGitDir: string): boolean {
  try {
    const target = /^gitdir: (.+)\n?$/.exec(readFileSync(join(worktree, '.git'), 'utf8'))?.[1];
    const common = readFileSync(join(worktreeGitDir, 'commondir'), 'utf8').trim();
    return !!target && realpathSync(resolve(worktree, target)) === realpathSync(worktreeGitDir) && realpathSync(resolve(worktreeGitDir, common)) === gitDir;
  } catch {
    return false;
  }
}

export async function worktreeIntact(worktree: string, repoDir: string): Promise<boolean> {
  try {
    const { gitDir, worktreeGitDir } = await gitPaths(repoDir, worktree);
    return pointersOk(worktree, gitDir, worktreeGitDir);
  } catch {
    return false; // git doesn't know this worktree
  }
}
