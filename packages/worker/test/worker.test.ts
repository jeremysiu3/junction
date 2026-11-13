import { afterEach, describe, expect, it } from 'vitest';
import { recover, tick, RUN_TIMEOUT, type Deps } from '../src/worker.js';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { childEnv, claudeArgs, claudeVersionOk, runsRoot, sandboxSettings } from '../src/claude.js';

type T = { status: string; repo: string | null; branch?: string; background?: boolean; brief?: string; title?: string };

// An expect() inside the fake runClaude would be swallowed by tick's catch, so collect and assert afterwards.
let runErrors: unknown[] = [];
afterEach(() => {
  expect(runErrors).toEqual([]);
});

function setup(
  tasks: Record<string, T>,
  o: {
    run?: (state: Map<string, T>) => void;
    rejectWith?: Error;
    commits?: number;
    existing?: string[];
    branchExists?: boolean;
    pr?: Record<string, { url: string; state: string; baseRefName: string }[]>;
    failGit?: string; // git subcommand that throws
    queueFailsFrom?: number; // worker_queue calls numbered from this one throw
    worktrees?: string[]; // task ids with a worktree dir on disk
    intact?: boolean; // worktree pointer files check (default true)
    repos?: Record<string, string>;
  } = {},
) {
  const calls: string[] = [];
  const state = new Map(Object.entries(tasks));
  let prompt = '';
  let queueCalls = 0;
  const logs: string[] = [];
  runErrors = [];
  const d: Deps = {
    api: async (tool, args: any = {}) => {
      calls.push(`api:${tool} ${JSON.stringify(args)}`);
      if (tool === 'worker_queue') {
        if (o.queueFailsFrom && ++queueCalls >= o.queueFailsFrom) throw new Error('queue down');
        const all = [...state.entries()];
        return {
          you: { id: 'u1', name: 'Jaxon' },
          approved: all
            .filter(([, t]) => t.status === 'approved')
            .map(([id, t]) => ({ id, title: t.title ?? 'Do thing', repo: t.repo, branch: t.branch ?? null, brief: t.brief ?? '[UNTRUSTED]x[END]' })),
          mine: all
            .filter(([, t]) => t.status !== 'approved' && t.status !== 'done' && t.status !== 'cancelled')
            .map(([id, t]) => ({ id, title: t.title ?? 'Do thing', status: t.status, repo: t.repo, branch: t.branch ?? null, background: !!t.background })),
        };
      }
      const t = state.get(args.task_id)!;
      if (tool === 'claim_task') {
        t.status = 'in_progress';
        t.background = true;
        t.branch = 'junction/do-thing-' + args.task_id.slice(0, 8);
        return { id: args.task_id, status: t.status, branch: t.branch };
      }
      if (tool === 'mark_stuck') t.status = 'stuck';
      return { id: args.task_id, status: t.status };
    },
    git: async (cwd, args) => {
      calls.push(`git ${args.join(' ')}`);
      if (args[0] === o.failGit) throw new Error(`git ${args[0]} failed`);
      if (args[0] === 'symbolic-ref') return 'origin/main\n';
      if (args[0] === 'show-ref') {
        if (o.branchExists) return '';
        throw new Error('no such branch');
      }
      if (args[0] === 'rev-list') return `${o.commits ?? 1}\n`;
      return '';
    },
    gh: async (cwd, args) => {
      calls.push(`gh ${cwd} ${args.join(' ')}`);
      return JSON.stringify(o.pr?.[args[3]] ?? []);
    },
    runClaude: async (r) => {
      calls.push('runClaude');
      prompt = r.prompt;
      try {
        expect(r.cwd).toBe('/wt/' + 'aaaaaaaa-1');
        expect(r.repoDir).toBe('/repos/junction');
        expect(r.repo).toBe('junction');
      } catch (e) {
        runErrors.push(e);
      }
      if (o.rejectWith) throw o.rejectWith;
      o.run?.(state);
    },
    repos: o.repos ?? { junction: '/repos/junction' },
    worktreeDir: (user, id) => (user === 'u1' ? '/wt/' + id : '/wrong-user/' + id),
    listWorktrees: (user) => (user === 'u1' ? (o.worktrees ?? []) : []),
    worktreeIntact: async (path, repoDir) => {
      calls.push(`intact ${path} ${repoDir}`);
      return o.intact ?? true;
    },
    exists: (p) => (o.existing ?? []).includes(p),
    log: (l) => void logs.push(l),
  };
  return { d, calls, state, logs, prompt: () => prompt };
}

const ID = 'aaaaaaaa-1';
const BRANCH = 'junction/do-thing-aaaaaaaa';
const stuckCalls = (calls: string[]) => calls.filter((c) => c.startsWith('api:mark_stuck'));

describe('recover', () => {
  it('marks a background in_progress task stuck and leaves a hand-done one alone', async () => {
    const { d, calls } = setup({
      bg: { status: 'in_progress', repo: 'junction', background: true },
      hand: { status: 'in_progress', repo: 'junction', background: false },
      waiting: { status: 'needs_input', repo: 'junction', background: true },
    });
    await recover(d);
    expect(stuckCalls(calls)).toEqual(['api:mark_stuck {"task_id":"bg","reason":"worker stopped mid-run"}']);
  });
});

describe('recover errors', () => {
  it('recover failure is logged, not thrown, and reported as false', async () => {
    const { d, logs } = setup({}, { queueFailsFrom: 1 });
    await expect(recover(d)).resolves.toBe(false);
    expect(logs).toEqual(['recover failed: queue down']);
  });

  it('tick retries a failed recover before claiming anything', async () => {
    const { d, calls } = setup({ [ID]: { status: 'approved', repo: 'junction' } });
    const api = d.api;
    let failures = 1;
    d.api = async (tool, args) => {
      if (tool === 'worker_queue' && failures-- > 0) throw new Error('queue down');
      return api(tool, args);
    };
    await tick(d);
    expect(calls.some((c) => c.startsWith('api:claim_task'))).toBe(false);
    await tick(d);
    expect(calls.some((c) => c.startsWith('api:claim_task'))).toBe(true);
    expect(calls.filter((c) => c.startsWith('api:worker_queue')).length).toBeGreaterThan(2);
  });

  it('one failing mark_stuck does not stop the others, and recover reports false', async () => {
    const { d, state, logs } = setup({
      a: { status: 'in_progress', repo: 'junction', background: true },
      b: { status: 'in_progress', repo: 'junction', background: true },
    });
    const api = d.api;
    d.api = async (tool, args: any) => {
      if (tool === 'mark_stuck' && args.task_id === 'a') throw new Error('api down');
      return api(tool, args);
    };
    await expect(recover(d)).resolves.toBe(false);
    expect(state.get('b')!.status).toBe('stuck');
    expect(logs.some((l) => l.includes('task a') && l.includes('api down'))).toBe(true);
  });
});

describe('recover: permanent vs transient mark_stuck failures', () => {
  const failWith = (d: Deps, err: Error) => {
    const api = d.api;
    d.api = async (tool, args: any) => {
      if (tool === 'mark_stuck') throw err;
      return api(tool, args);
    };
  };
  const apiError = (code: string) => Object.assign(new Error(`api said ${code}`), { code });

  it.each(['invalid_transition', 'not_found'])('a %s refusal counts as handled', async (code) => {
    const { d, logs } = setup({ a: { status: 'in_progress', repo: 'junction', background: true } });
    failWith(d, apiError(code));
    await expect(recover(d)).resolves.toBe(true);
    expect(logs.some((l) => l.includes('api said'))).toBe(true);
  });

  it.each([new Error('fetch failed'), apiError('internal'), apiError('forbidden')])('a transient failure (%s) is retried', async (err) => {
    const { d } = setup({ a: { status: 'in_progress', repo: 'junction', background: true } });
    failWith(d, err);
    await expect(recover(d)).resolves.toBe(false);
  });

  it('tick goes on to claim after a permanent mark_stuck refusal', async () => {
    const { d, calls } = setup({
      a: { status: 'in_progress', repo: 'junction', background: true },
      [ID]: { status: 'approved', repo: 'junction' },
    });
    failWith(d, apiError('invalid_transition'));
    await tick(d);
    expect(calls.some((c) => c.startsWith('api:claim_task'))).toBe(true);
  });
});

describe('tick: run', () => {
  it('an unmapped repo → mark_stuck with the config reason, and no claim', async () => {
    const { d, calls } = setup({ [ID]: { status: 'approved', repo: 'other/thing' } });
    await tick(d);
    expect(stuckCalls(calls)).toEqual([
      `api:mark_stuck {"task_id":"${ID}","reason":"repo other/thing is not set up in the worker config"}`,
    ]);
    expect(calls.some((c) => c.startsWith('api:claim_task'))).toBe(false);
    expect(calls).not.toContain('runClaude');
  });

  it('a repo named like an Object.prototype key is not mapped', async () => {
    const { d, calls } = setup({ [ID]: { status: 'approved', repo: 'constructor' } });
    await tick(d);
    expect(stuckCalls(calls)[0]).toContain('repo constructor is not set up');
  });

  it('a task with no repo → mark_stuck "task has no repo"', async () => {
    const { d, calls } = setup({ [ID]: { status: 'approved', repo: null } });
    await tick(d);
    expect(stuckCalls(calls)[0]).toContain('"reason":"task has no repo"');
  });

  it('happy path: claim, worktree add --no-track -b off origin/main, exact prompt, 2 commits → worktree removed', async () => {
    const { d, calls, prompt } = setup(
      { [ID]: { status: 'approved', repo: 'junction', brief: '[UNTRUSTED]do the thing[END]' } },
      { commits: 2, run: (st) => void (st.get(ID)!.status = 'ready_for_review') },
    );
    await tick(d);
    expect(calls).toContain(`git worktree add --no-track -b ${BRANCH} /wt/${ID} origin/main`);
    expect(prompt()).toBe(
      `You are working unattended on Junction task ${ID} for Jaxon. Nobody is watching this session, so don't ask questions in chat.
You are in a dedicated git worktree on branch ${BRANCH}. Work only here. Commit your changes to this branch as you go. Never push and never switch branches.
Call record_work with key "${BRANCH}" after each meaningful chunk.
If you can't continue without a decision only Jaxon can make, call ask_question with task_id "${ID}" and stop.
When the task is finished and committed, call complete_task with task_id "${ID}", branch "${BRANCH}" and an evidence_note saying what changed and the last commit SHA.

The task, as approved by Jaxon:
[UNTRUSTED]do the thing[END]`,
    );
    expect(calls).toContain(`git rev-list --count origin/main..${BRANCH}`);
    expect(calls).toContain(`git worktree remove --force /wt/${ID}`);
    expect(stuckCalls(calls)).toEqual([]);
  });
});

describe('tick: after the run', () => {
  const approved = () => ({ [ID]: { status: 'approved', repo: 'junction' } });

  it('still approved after the run (answered or retried meanwhile) → worktree kept, not stuck', async () => {
    const { d, calls } = setup(approved(), { run: (st) => void (st.get(ID)!.status = 'approved') });
    await tick(d);
    expect(stuckCalls(calls)).toEqual([]);
    expect(calls.some((c) => c.includes('worktree remove'))).toBe(false);
  });

  it('removes a worktree whose task is no longer listed', async () => {
    const GONE = 'bbbbbbbb-2';
    const { d, calls, logs } = setup({ [ID]: { status: 'needs_input', repo: 'junction', branch: BRANCH, background: true } }, { worktrees: [GONE, ID] });
    await tick(d);
    expect(calls).toContain(`git worktree remove --force /wt/${GONE}`);
    expect(calls.some((c) => c === `git worktree remove --force /wt/${ID}`)).toBe(false);
    expect(logs.some((l) => l.includes(GONE))).toBe(true);
  });

  it('cleanup removes from a configured clone, never with git run inside the worktree; tries each clone', async () => {
    const GONE = 'bbbbbbbb-2';
    const { d, calls } = setup({}, { worktrees: [GONE], repos: { a: '/repos/a', b: '/repos/b' } });
    const git = d.git;
    d.git = async (cwd, args) => {
      if (args[0] === 'worktree' && cwd === '/repos/a') throw new Error('not a working tree');
      return git(cwd, args);
    };
    await tick(d);
    expect(calls).toEqual(expect.arrayContaining([`git worktree remove --force /wt/${GONE}`]));
    expect(calls.filter((c) => c.startsWith('git worktree remove'))).toHaveLength(1); // second clone succeeded
  });

  it('cleanup with no clone configured logs and skips', async () => {
    const GONE = 'bbbbbbbb-2';
    const { d, calls, logs } = setup({}, { worktrees: [GONE], repos: {} });
    await tick(d);
    expect(calls.some((c) => c.includes('worktree remove'))).toBe(false);
    expect(logs.some((l) => l.includes(GONE) && l.includes('could not remove'))).toBe(true);
  });

  it('a worktree for a task that is still approved is kept', async () => {
    const { d, calls } = setup(approved(), { worktrees: [ID], existing: [`/wt/${ID}`], run: (st) => void (st.get(ID)!.status = 'needs_input') });
    await tick(d);
    expect(calls.some((c) => c.includes('worktree remove'))).toBe(false);
  });

  it('a failing worktree removal is logged, not thrown', async () => {
    const { d, logs } = setup({}, { worktrees: ['bbbbbbbb-2'], failGit: 'worktree' });
    await expect(tick(d)).resolves.toBeUndefined();
    expect(logs.some((l) => l.includes('bbbbbbbb-2') && l.includes('git worktree failed'))).toBe(true);
  });

  it('a failing mark_stuck for an unmapped repo is logged, not thrown', async () => {
    const { d, logs } = setup({ [ID]: { status: 'approved', repo: 'other/thing' } });
    d.api = async (tool) => {
      if (tool === 'mark_stuck') throw new Error('api down');
      return { you: { id: 'u1', name: 'Jaxon' }, approved: [{ id: ID, title: 'Do thing', repo: 'other/thing', brief: 'x' }], mine: [] };
    };
    await expect(tick(d)).resolves.toBeUndefined();
    expect(logs.some((l) => l.includes('api down'))).toBe(true);
  });

  it('log lines carry no control characters from the title', async () => {
    const title = 'Evil\nforged line \x1b[31mred\x07';
    const { d, logs } = setup({ [ID]: { status: 'approved', repo: 'junction', title } });
    await tick(d);
    expect(logs).toContain(`claimed "Evil forged line  [31mred " on ${BRANCH}`);
    expect(logs.length).toBeGreaterThan(2);
    for (const l of logs) expect(l).not.toMatch(/[\x00-\x1f\x7f-\x9f]/);
  });

  it('logs each step with the task title', async () => {
    const title = 'Fix the login bug';
    const task = { status: 'approved', repo: 'junction', title };
    const logsFor = async (o: Parameters<typeof setup>[1]) => {
      const { d, logs } = setup({ [ID]: { ...task } }, o);
      await tick(d);
      return logs;
    };
    expect(await logsFor({ run: (st) => void (st.get(ID)!.status = 'ready_for_review') })).toEqual([
      `claimed "${title}" on ${BRANCH}`,
      `running "${title}"`,
      `"${title}" is ready for review on ${BRANCH}`,
    ]);
    expect(await logsFor({ run: (st) => void (st.get(ID)!.status = 'needs_input') })).toContain(`"${title}" is waiting for your answer`);
    expect(await logsFor({})).toContain(`"${title}" is stuck: run ended without finishing`);
    expect(await logsFor({ rejectWith: new Error(RUN_TIMEOUT) })).toEqual(
      expect.arrayContaining([`run for "${title}" ended: ${RUN_TIMEOUT}`, `"${title}" is stuck: ${RUN_TIMEOUT}`]),
    );
  });

  it("ready_for_review with 0 commits → mark_stuck 'finished without commits', worktree kept", async () => {
    const { d, calls } = setup(approved(), { commits: 0, run: (st) => void (st.get(ID)!.status = 'ready_for_review') });
    await tick(d);
    expect(stuckCalls(calls)).toEqual([`api:mark_stuck {"task_id":"${ID}","reason":"finished without commits"}`]);
    expect(calls.some((c) => c.includes('worktree remove'))).toBe(false);
  });

  it("runClaude rejects (timeout) → mark_stuck 'run timed out after 30 minutes'", async () => {
    const { d, calls } = setup(approved(), { rejectWith: new Error(RUN_TIMEOUT) });
    await tick(d);
    expect(stuckCalls(calls)).toEqual([`api:mark_stuck {"task_id":"${ID}","reason":"run timed out after 30 minutes"}`]);
    expect(calls.some((c) => c.includes('worktree remove'))).toBe(false);
  });

  it("run ends with the task still in_progress → mark_stuck 'run ended without finishing'", async () => {
    const { d, calls } = setup(approved());
    await tick(d);
    expect(stuckCalls(calls)).toEqual([`api:mark_stuck {"task_id":"${ID}","reason":"run ended without finishing"}`]);
  });

  it('needs_input keeps the worktree and does not mark stuck', async () => {
    const { d, calls } = setup(approved(), { run: (st) => void (st.get(ID)!.status = 'needs_input') });
    await tick(d);
    expect(stuckCalls(calls)).toEqual([]);
    expect(calls.some((c) => c.includes('worktree remove'))).toBe(false);
  });

  it('task cancelled during the run → worktree removed with --force, no mark_stuck', async () => {
    const { d, calls } = setup(approved(), { run: (st) => void (st.get(ID)!.status = 'cancelled') });
    await tick(d);
    expect(calls).toContain(`git worktree remove --force /wt/${ID}`);
    expect(stuckCalls(calls)).toEqual([]);
  });

  it('an existing worktree is reused on resume after answer', async () => {
    const { d, calls } = setup(approved(), { existing: [`/wt/${ID}`], run: (st) => void (st.get(ID)!.status = 'needs_input') });
    await tick(d);
    expect(calls.some((c) => c.startsWith('git worktree add'))).toBe(false);
    expect(calls).toContain('runClaude');
  });

  const leftover = `api:mark_stuck {"task_id":"${ID}","reason":"branch ${BRANCH} exists in your clone without its Junction worktree; delete or rename the branch, then retry (run git worktree prune in your clone first if you removed the folder)"}`;

  it('a fresh claim finding a leftover local branch → stuck, no worktree add, no run, nothing removed', async () => {
    const { d, calls, logs } = setup(approved(), { branchExists: true });
    await tick(d);
    expect(stuckCalls(calls)).toEqual([leftover]);
    expect(calls.some((c) => c.startsWith('git worktree') || c.startsWith('git branch'))).toBe(false);
    expect(calls).not.toContain('runClaude');
    expect(logs.some((l) => l.includes('exists in your clone without its Junction worktree'))).toBe(true);
  });

  it('a retried task (branch stored) with no worktree and an existing branch → stuck again, no worktree add', async () => {
    const { d, calls } = setup({ [ID]: { status: 'approved', repo: 'junction', branch: BRANCH } }, { branchExists: true });
    await tick(d);
    expect(stuckCalls(calls)).toEqual([leftover]);
    expect(calls.some((c) => c.startsWith('git worktree'))).toBe(false);
    expect(calls).not.toContain('runClaude');
  });

  it('a retried task whose branch is gone too gets both recreated with -b', async () => {
    const { d, calls } = setup({ [ID]: { status: 'approved', repo: 'junction', branch: BRANCH } }, { run: (st) => void (st.get(ID)!.status = 'needs_input') });
    await tick(d);
    expect(calls).toContain(`git worktree add --no-track -b ${BRANCH} /wt/${ID} origin/main`);
  });

  it('an existing worktree whose pointer files changed → stuck, no run, no git run there', async () => {
    const { d, calls, logs } = setup({ [ID]: { status: 'approved', repo: 'junction', branch: BRANCH } }, { existing: [`/wt/${ID}`], intact: false });
    await tick(d);
    expect(calls).toContain(`intact /wt/${ID} /repos/junction`);
    expect(stuckCalls(calls)).toEqual([`api:mark_stuck {"task_id":"${ID}","reason":"worktree pointer files were modified; remove /wt/${ID} by hand (run git worktree prune in your clone first if you removed the folder)"}`]);
    expect(calls).not.toContain('runClaude');
    expect(calls.filter((c) => c.startsWith('git ')).every((c) => !c.includes(`/wt/${ID}`))).toBe(true);
    expect(logs.some((l) => l.includes('pointer files were modified'))).toBe(true);
  });

  it('an intact existing worktree is checked, then reused', async () => {
    const { d, calls } = setup({ [ID]: { status: 'approved', repo: 'junction', branch: BRANCH } }, { existing: [`/wt/${ID}`], run: (st) => void (st.get(ID)!.status = 'needs_input') });
    await tick(d);
    expect(calls).toContain(`intact /wt/${ID} /repos/junction`);
    expect(calls).toContain('runClaude');
  });
});

describe('tick: worker errors after the claim', () => {
  const approved = () => ({ [ID]: { status: 'approved', repo: 'junction' } });

  it("git fetch fails after claim → mark_stuck 'worker error: …', no run", async () => {
    const { d, calls, state } = setup(approved(), { failGit: 'fetch' });
    await tick(d);
    expect(stuckCalls(calls)).toEqual([`api:mark_stuck {"task_id":"${ID}","reason":"worker error: git fetch failed"}`]);
    expect(calls).not.toContain('runClaude');
    expect(state.get(ID)!.status).toBe('stuck');
  });

  it('post-run worker_queue failure → mark_stuck even though the status is unreadable', async () => {
    const { d, calls } = setup(approved(), { queueFailsFrom: 3, run: (st) => void (st.get(ID)!.status = 'needs_input') });
    await tick(d);
    expect(stuckCalls(calls)).toEqual([`api:mark_stuck {"task_id":"${ID}","reason":"worker error: queue down"}`]);
  });

  it('does not mark stuck when the task has already moved on (e.g. needs_input)', async () => {
    const { d, calls } = setup(approved(), { failGit: 'rev-list', run: (st) => void (st.get(ID)!.status = 'ready_for_review') });
    await tick(d);
    expect(stuckCalls(calls)).toEqual([]);
  });

  it('a failing mark_stuck is logged, not thrown', async () => {
    const { d, state } = setup(approved(), { failGit: 'fetch' });
    const api = d.api;
    d.api = async (tool, args) => {
      if (tool === 'mark_stuck') throw new Error('api down');
      return api(tool, args);
    };
    await expect(tick(d)).resolves.toBeUndefined();
    expect(state.get(ID)!.status).toBe('in_progress');
  });
});

describe('tick: watch', () => {
  const mine = (status: string) => ({ [ID]: { status, repo: 'junction', branch: BRANCH, background: true } });
  const reports = (calls: string[]) => calls.filter((c) => c.startsWith('api:report_pr'));
  const pr = (state: string, baseRefName = 'main') => ({ [BRANCH]: [{ url: 'https://gh/pr/1', state, baseRefName }] });

  it('OPEN while ready_for_review → report_pr open', async () => {
    const { d, calls } = setup(mine('ready_for_review'), { pr: pr('OPEN') });
    await tick(d);
    expect(reports(calls)).toEqual([`api:report_pr {"task_id":"${ID}","pr_url":"https://gh/pr/1","state":"open"}`]);
    expect(calls).toContain(
      `gh /repos/junction pr list --head ${BRANCH} --state all --json url,state,baseRefName --limit 1`,
    );
  });

  it('MERGED → report_pr merged', async () => {
    const { d, calls, logs } = setup(mine('in_review'), { pr: pr('MERGED') });
    await tick(d);
    expect(reports(calls)[0]).toContain('"state":"merged"');
    expect(logs).toContain('"Do thing" merged');
  });

  it('OPEN logs the PR url with the title', async () => {
    const { d, logs } = setup(mine('ready_for_review'), { pr: pr('OPEN') });
    await tick(d);
    expect(logs).toContain('PR opened for "Do thing": https://gh/pr/1');
  });

  it('MERGED into a base other than the default branch is ignored, with a log line', async () => {
    const { d, calls, logs } = setup(mine('in_review'), { pr: pr('MERGED', 'release') });
    await tick(d);
    expect(reports(calls)).toEqual([]);
    expect(logs.some((l) => l.includes('release') && l.includes(ID))).toBe(true);
  });

  it('CLOSED while in_review → report_pr closed', async () => {
    const { d, calls } = setup(mine('in_review'), { pr: pr('CLOSED') });
    await tick(d);
    expect(reports(calls)[0]).toContain('"state":"closed"');
  });

  it('nothing for CLOSED while ready_for_review, OPEN while in_review, or no PR', async () => {
    for (const [status, p] of [
      ['ready_for_review', pr('CLOSED')],
      ['in_review', pr('OPEN')],
      ['in_review', {}],
    ] as const) {
      const { d, calls } = setup(mine(status), { pr: p });
      await tick(d);
      expect(reports(calls)).toEqual([]);
    }
  });

  it('skips a task whose repo is unmapped (no gh call)', async () => {
    const { d, calls } = setup({ [ID]: { status: 'in_review', repo: 'toString', branch: BRANCH } });
    await tick(d);
    expect(calls.some((c) => c.startsWith('gh '))).toBe(false);
  });
});

describe('claude.ts', () => {
  it('claudeArgs includes --setting-sources user and --strict-mcp-config', () => {
    const a = claudeArgs({ prompt: 'P', settingsPath: '/s.json', mcpConfigPath: '/m.json' });
    expect(a).toEqual([
      '-p', 'P', '--output-format', 'json', '--setting-sources', 'user', '--settings', '/s.json',
      '--mcp-config', '/m.json', '--strict-mcp-config', '--permission-mode', 'acceptEdits', '--max-budget-usd', '5',
    ]);
  });

  it('sandboxSettings: allowlist excludes github.com, denies git push, write allow is narrowed (no whole git dir)', () => {
    const s: any = sandboxSettings({ worktree: '/wt', gitDir: '/r/.git', worktreeGitDir: '/r/.git/worktrees/wt', apiHost: 'junction.example', nodePrefix: '/usr/local', npmCache: '/run/npm-cache' });
    expect(s.sandbox.network.allowedDomains).toEqual(['junction.example', 'registry.npmjs.org']);
    expect(s.sandbox.network.allowedDomains.some((x: string) => x.includes('github.com'))).toBe(false);
    expect(s.sandbox.network.deniedDomains).toEqual(['github.com', '*.github.com']);
    expect(s.permissions.blockReadsOutsideWorkingDirectories).toBe(true);
    expect(s.permissions.blockWritesOutsideWorkingDirectories).toBe(true);
    expect(s.permissions.deny).toContain('Edit(//r/.git/hooks/**)');
    expect(s.permissions.deny).toContain('Edit(//r/.git/config)');
    expect(s.sandbox.filesystem.allowRead).toEqual(['/wt', '/r/.git', '/usr/local', '/run/npm-cache']);
    expect(s.sandbox.network.strictAllowlist).toBe(true);
    expect(s.permissions.deny).toContain('Bash(git push:*)');
    expect(s.sandbox.filesystem.allowWrite).toEqual([
      '/wt', '/r/.git/objects', '/r/.git/refs/heads/junction', '/r/.git/logs/refs/heads/junction', '/r/.git/worktrees/wt', '/run/npm-cache',
    ]);
    expect(s.sandbox.filesystem.denyWrite).toEqual(['/r/.git/hooks', '/r/.git/config', '/r/.git/worktrees/wt/commondir', '/wt/.git']);
    expect(s.sandbox.enabled).toBe(true);
    expect(s.sandbox.failIfUnavailable).toBe(true);
    expect(s.sandbox.allowUnsandboxedCommands).toBe(false);
  });

  it('allowedDomains uses host:port so localhost services on other ports stay closed', () => {
    const s: any = sandboxSettings({ worktree: '/wt', gitDir: '/r/.git', worktreeGitDir: '/r/.git/worktrees/wt', apiHost: new URL('http://localhost:3000').host, nodePrefix: '/n', npmCache: '/c' });
    expect(s.sandbox.network.allowedDomains).toContain('localhost:3000');
    expect(s.sandbox.network.allowedDomains).not.toContain('localhost');
  });

  it('claudeVersionOk: 2.1.314 or newer', () => {
    expect(claudeVersionOk('2.1.322 (Claude Code)')).toBe(true);
    expect(claudeVersionOk('2.1.314 (Claude Code)')).toBe(true);
    expect(claudeVersionOk('2.1.313 (Claude Code)')).toBe(false);
    expect(claudeVersionOk('2.2.0 (Claude Code)')).toBe(true);
    expect(claudeVersionOk('3.0.0')).toBe(true);
    expect(claudeVersionOk('1.9.99')).toBe(false);
    expect(claudeVersionOk('garbage')).toBe(false);
    expect(claudeVersionOk('')).toBe(false);
  });

  it('childEnv: passes the allowlisted vars, the npm cache, and git identity only when set', () => {
    const base = { PATH: '/bin', HOME: '/h', AWS_SECRET: 'x', GH_TOKEN: 't' };
    expect(childEnv(base, '/c', { name: 'Jaxon', email: 'k@x.io' })).toEqual({
      PATH: '/bin', HOME: '/h', npm_config_cache: '/c', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0',
      GIT_AUTHOR_NAME: 'Jaxon', GIT_COMMITTER_NAME: 'Jaxon', GIT_AUTHOR_EMAIL: 'k@x.io', GIT_COMMITTER_EMAIL: 'k@x.io',
    });
    expect(childEnv(base, '/c', {})).toEqual({ PATH: '/bin', HOME: '/h', npm_config_cache: '/c', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' });
  });

  it('the per-run dir (holds the agent key) is under ~/.junction/runs and not covered by any allowRead entry', () => {
    const home = homedir();
    const root = runsRoot(home);
    expect(root).toBe(join(home, '.junction', 'runs'));
    const s: any = sandboxSettings({
      worktree: join(home, '.junction', 'worktrees', ID),
      gitDir: join(home, 'code', 'junction', '.git'),
      worktreeGitDir: join(home, 'code', 'junction', '.git', 'worktrees', ID),
      apiHost: 'junction.example',
      nodePrefix: dirname(dirname(process.execPath)),
      npmCache: join(root, 'run-abc', 'npm-cache'),
    });
    const covers = (allowed: string, p: string) => {
      const a = allowed.replace(/^~(?=\/|$)/, home);
      return p === a || p.startsWith(a.endsWith('/') ? a : a + '/');
    };
    expect(s.sandbox.filesystem.denyRead).toEqual(['~/']);
    expect(root.startsWith(home + '/')).toBe(true);
    for (const a of s.sandbox.filesystem.allowRead) expect(covers(a, join(root, 'run-abc', 'mcp.json'))).toBe(false);
  });
});
