export type Deps = {
  api: (tool: string, args?: object) => Promise<any>; // POST /api/agent/<tool>, returns parsed `result`
  git: (cwd: string, args: string[]) => Promise<string>; // stdout, throws on non-zero
  gh: (cwd: string, args: string[]) => Promise<string>;
  runClaude: (o: { cwd: string; prompt: string; branch: string; repoDir: string; repo: string }) => Promise<void>; // resolves when the run ends (any reason), rejects on timeout
  repos: Record<string, string>; // Junction repo -> local clone path
  worktreeDir: (userId: string, taskId: string) => string;
  listWorktrees: (userId: string) => string[]; // this user's task ids that have a worktree dir on disk
  worktreeIntact: (path: string, repoDir: string) => Promise<boolean>; // the worktree's pointer files still lead to its git dir
  exists: (path: string) => boolean;
  log: (line: string) => void;
  recovered?: boolean; // set by tick once recover has succeeded
};

export const RUN_MS = 30 * 60 * 1000;
export const RUN_TIMEOUT = `run timed out after ${RUN_MS / 60000} minutes`;

type Mine = { id: string; title: string; status: string; repo: string | null; branch: string | null; background: boolean };

// `repo` is raw requester text: only ever a lookup key into config.repos.
function repoDirOf(d: Deps, repo: string | null): string | undefined {
  return repo !== null && Object.hasOwn(d.repos, repo) ? d.repos[repo] : undefined;
}

// Titles, reasons and URLs come from other users' agents: no newlines or terminal escapes in log lines.
export const clean = (s: string) => s.replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');
const say = (d: Deps, line: string) => d.log(clean(line));

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// The API's error code rides on the thrown Error (see index.ts). These two will never succeed on retry.
const permanent = (e: unknown) => ['invalid_transition', 'not_found'].includes((e as { code?: string } | null)?.code ?? '');

// True when every mid-run task was handled; tick retries until then. A mark_stuck refused for good (the task moved on) counts as handled.
export async function recover(d: Deps): Promise<boolean> {
  let q;
  try {
    q = await d.api('worker_queue');
  } catch (e) {
    say(d, `recover failed: ${errText(e)}`);
    return false;
  }
  let ok = true;
  for (const t of q.mine as Mine[]) {
    if (!(t.background && t.status === 'in_progress')) continue;
    try {
      say(d, `recover: task ${t.id} was mid-run, marking stuck`);
      await d.api('mark_stuck', { task_id: t.id, reason: 'worker stopped mid-run' });
    } catch (e) {
      say(d, `recover failed for task ${t.id}: ${errText(e)}`);
      if (!permanent(e)) ok = false;
    }
  }
  return ok;
}

async function markStuck(d: Deps, t: { id: string; title: string }, reason: string) {
  await d.api('mark_stuck', { task_id: t.id, reason });
  say(d, `"${t.title}" is stuck: ${reason}`);
}

async function watch(d: Deps, t: Mine, repoDir: string) {
  const out = await d.gh(repoDir, ['pr', 'list', '--head', t.branch!, '--state', 'all', '--json', 'url,state,baseRefName', '--limit', '1']);
  const pr = (JSON.parse(out) as { url: string; state: string; baseRefName: string }[])[0];
  if (!pr) return;
  if (pr.state === 'MERGED') {
    const base = (await d.git(repoDir, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])).trim().replace(/^origin\//, '');
    if (pr.baseRefName !== base) return void say(d, `watch ${t.id}: PR merged into ${pr.baseRefName}, not ${base}; ignoring`);
  }
  const state =
    pr.state === 'MERGED' ? 'merged'
    : pr.state === 'OPEN' && t.status === 'ready_for_review' ? 'open'
    : pr.state === 'CLOSED' && t.status === 'in_review' ? 'closed'
    : null;
  if (!state) return;
  await d.api('report_pr', { task_id: t.id, pr_url: pr.url, state });
  if (state === 'open') say(d, `PR opened for "${t.title}": ${pr.url}`);
  if (state === 'merged') say(d, `"${t.title}" merged`);
}

export function buildPrompt(o: { id: string; name: string; branch: string; brief: string }): string {
  const { id, name, branch, brief } = o;
  return `You are working unattended on Junction task ${id} for ${name}. Nobody is watching this session, so don't ask questions in chat.
You are in a dedicated git worktree on branch ${branch}. Work only here. Commit your changes to this branch as you go. Never push and never switch branches.
Call record_work with key "${branch}" after each meaningful chunk.
If you can't continue without a decision only ${name} can make, call ask_question with task_id "${id}" and stop.
When the task is finished and committed, call complete_task with task_id "${id}", branch "${branch}" and an evidence_note saying what changed and the last commit SHA.

The task, as approved by ${name}:
${brief}`;
}

async function stuckOnError(d: Deps, t: { id: string; title: string }, e: unknown) {
  const { id } = t;
  const message = errText(e);
  say(d, `task ${id}: worker error: ${message}`);
  let status: string | undefined = 'in_progress'; // if we can't read it, assume the worst
  try {
    status = ((await d.api('worker_queue')).mine as Mine[]).find((t) => t.id === id)?.status;
  } catch (e2) {
    say(d, `task ${id}: could not read status: ${e2 instanceof Error ? e2.message : e2}`);
  }
  if (status !== 'in_progress') return;
  try {
    await markStuck(d, t, `worker error: ${message}`.slice(0, 300));
  } catch (e2) {
    say(d, `task ${id}: could not mark stuck: ${e2 instanceof Error ? e2.message : e2}`);
  }
}

export async function tick(d: Deps): Promise<void> {
  // A new claim before recover succeeds would be marked stuck by the late recover.
  if (!d.recovered) d.recovered = await recover(d);
  if (!d.recovered) return;
  const q = await d.api('worker_queue');

  // 1. Watch
  for (const t of q.mine as Mine[]) {
    const repoDir = repoDirOf(d, t.repo);
    if ((t.status !== 'ready_for_review' && t.status !== 'in_review') || !t.branch || !repoDir) continue;
    try {
      await watch(d, t, repoDir);
    } catch (e) {
      say(d, `watch ${t.id}: ${e instanceof Error ? e.message : e}`);
    }
  }

  // 2. Clean up worktrees of tasks that were cancelled or are gone. Only this user's folder is listed.
  // Their repo is unknown, so ask each configured clone: git refuses a path that isn't its worktree. Nothing runs inside the worktree.
  const listed = new Set([...(q.mine as Mine[]), ...(q.approved as { id: string }[])].map((t) => t.id));
  for (const id of d.listWorktrees(q.you.id)) {
    if (listed.has(id)) continue;
    const path = d.worktreeDir(q.you.id, id);
    let last: unknown = 'no repo is set up in the worker config';
    let removed = false;
    for (const repoDir of new Set(Object.values(d.repos))) {
      try {
        await d.git(repoDir, ['worktree', 'remove', '--force', path]);
        removed = true;
        break;
      } catch (e) {
        last = e;
      }
    }
    say(d, removed ? `removed worktree for task ${id}: no longer listed` : `could not remove worktree for task ${id}: ${errText(last)}`);
  }

  // 3. Run
  const task = (q.approved as { id: string; title: string; repo: string | null; branch: string | null; brief: string }[])[0];
  if (!task) return;
  const repoDir = repoDirOf(d, task.repo);
  if (!repoDir) {
    const reason = task.repo === null ? 'task has no repo' : `repo ${task.repo} is not set up in the worker config`;
    try {
      await markStuck(d, task, reason);
    } catch (e) {
      say(d, `task ${task.id}: could not mark stuck: ${errText(e)}`);
    }
    return;
  }
  const { branch } = await d.api('claim_task', { task_id: task.id });
  say(d, `claimed "${task.title}" on ${branch}`);
  // From here the task is in_progress: any worker-side failure must not strand it.
  try {
    const path = d.worktreeDir(q.you.id, task.id);
    await d.git(repoDir, ['fetch', 'origin']);
    const base = (await d.git(repoDir, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])).trim();
    if (!d.exists(path)) {
      const branchExists = await d.git(repoDir, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]).then(() => true, () => false);
      // Never build on a branch we didn't just create: with no worktree to reuse it's a leftover, on a fresh claim or a retry alike.
      if (branchExists) return void (await markStuck(d, task, `branch ${branch} exists in your clone without its Junction worktree; delete or rename the branch, then retry (run git worktree prune in your clone first if you removed the folder)`));
      await d.git(repoDir, ['worktree', 'add', '--no-track', '-b', branch, path, base]);
    } else if (!(await d.worktreeIntact(path, repoDir))) {
      // The agent can rewrite these files to redirect git to its own config; don't run git there.
      return void (await markStuck(d, task, `worktree pointer files were modified; remove ${path} by hand (run git worktree prune in your clone first if you removed the folder)`));
    }
    const prompt = buildPrompt({ id: task.id, name: q.you.name, branch, brief: task.brief });
    let rejected: unknown;
    try {
      say(d, `running "${task.title}"`);
      await d.runClaude({ cwd: path, prompt, branch, repoDir, repo: task.repo! });
    } catch (e) {
      rejected = e;
      say(d, `run for "${task.title}" ended: ${errText(e)}`);
    }

    // 4. After the run
    const after = await d.api('worker_queue');
    const now = (after.mine as Mine[]).find((t) => t.id === task.id);
    const stillApproved = (after.approved as { id: string }[]).some((t) => t.id === task.id);
    if (!now) {
      if (!stillApproved) await d.git(repoDir, ['worktree', 'remove', '--force', path]); // cancelled or done; branch kept
      return;
    }
    if (now.status === 'in_progress') {
      const timedOut = rejected instanceof Error && rejected.message === RUN_TIMEOUT;
      await markStuck(d, task, timedOut ? RUN_TIMEOUT : 'run ended without finishing');
    } else if (now.status === 'needs_input') {
      say(d, `"${task.title}" is waiting for your answer`);
    } else if (now.status === 'ready_for_review') {
      const n = (await d.git(repoDir, ['rev-list', '--count', `${base}..${branch}`])).trim();
      if (n === '0') await markStuck(d, task, 'finished without commits');
      else {
        say(d, `"${task.title}" is ready for review on ${branch}`);
        await d.git(repoDir, ['worktree', 'remove', '--force', path]); // untracked leftovers must not block Jaxon's checkout
      }
    }
  } catch (e) {
    await stuckOnError(d, task, e);
  }
}
