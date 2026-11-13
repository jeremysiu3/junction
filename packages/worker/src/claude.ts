import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { exec } from './exec.js';
import { gitPaths } from './worktree.js';
import { clean, RUN_MS, RUN_TIMEOUT, type Deps } from './worker.js';

// Needs Claude Code 2.1.314 for permissions.blockWritesOutsideWorkingDirectories.
const MIN_CLAUDE = [2, 1, 314];

export function claudeVersionOk(out: string): boolean {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(out.trim());
  if (!m) return false;
  for (let i = 0; i < 3; i++) if (+m[i + 1] !== MIN_CLAUDE[i]) return +m[i + 1] > MIN_CLAUDE[i];
  return true;
}

export function sandboxSettings(o: { worktree: string; gitDir: string; worktreeGitDir: string; apiHost: string; nodePrefix: string; npmCache: string }): object {
  return {
    permissions: {
      // The sandbox's filesystem lists only cover Bash; these keep Read/Edit/Write inside the worktree.
      blockReadsOutsideWorkingDirectories: true,
      blockWritesOutsideWorkingDirectories: true,
      allow: ['mcp__junction__*', 'Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash'],
      deny: [
        'Bash(git push:*)', 'WebFetch', 'WebSearch', 'Read(./.env*)', 'Read(**/.env*)',
        `Edit(/${join(o.gitDir, 'hooks')}/**)`, `Edit(/${join(o.gitDir, 'config')})`, // '//' + abs path = absolute rule
        `Edit(/${join(o.worktreeGitDir, 'commondir')})`, `Edit(/${join(o.worktree, '.git')})`,
      ],
    },
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
      network: {
        allowedDomains: [o.apiHost, 'registry.npmjs.org'],
        deniedDomains: ['github.com', '*.github.com'], // user settings are still merged and may allow it
        strictAllowlist: true,
      },
      filesystem: {
        // Not the whole git dir: sandboxed Bash must not move other refs. Branches are all under junction/.
        allowWrite: [
          o.worktree,
          join(o.gitDir, 'objects'),
          join(o.gitDir, 'refs/heads/junction'),
          join(o.gitDir, 'logs/refs/heads/junction'),
          o.worktreeGitDir,
          o.npmCache,
        ],
        // Hooks and config run outside the sandbox (core.fsmonitor); the two pointer files could redirect git to a config of the agent's own.
        denyWrite: [join(o.gitDir, 'hooks'), join(o.gitDir, 'config'), join(o.worktreeGitDir, 'commondir'), join(o.worktree, '.git')],
        denyRead: ['~/'],
        allowRead: [o.worktree, o.gitDir, o.nodePrefix, o.npmCache],
      },
    },
  };
}

export function claudeArgs(o: { prompt: string; settingsPath: string; mcpConfigPath: string }): string[] {
  return [
    '-p', o.prompt,
    '--output-format', 'json',
    '--setting-sources', 'user',
    '--settings', o.settingsPath,
    '--mcp-config', o.mcpConfigPath,
    '--strict-mcp-config',
    '--permission-mode', 'acceptEdits',
    '--max-budget-usd', '5',
  ];
}

export function childEnv(
  base: Record<string, string | undefined>,
  npmCache: string,
  id: { name?: string; email?: string },
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const k of ['PATH', 'HOME', 'USER', 'SHELL', 'LANG', 'TERM', 'ANTHROPIC_API_KEY']) {
    if (base[k]) env[k] = base[k]!;
  }
  env.npm_config_cache = npmCache; // ~/ is unreadable in the sandbox
  env.GIT_TERMINAL_PROMPT = '0'; // git must fail, not prompt, in a headless run
  // git fails hard on an unreadable ~/.gitconfig (EPERM under the sandbox); identity comes from the vars below
  Object.assign(env, { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' });
  if (id.name) Object.assign(env, { GIT_AUTHOR_NAME: id.name, GIT_COMMITTER_NAME: id.name });
  if (id.email) Object.assign(env, { GIT_AUTHOR_EMAIL: id.email, GIT_COMMITTER_EMAIL: id.email });
  return env;
}

// Per-run files (they hold the worker credential) live under ~/.junction/runs: inside the sandbox's
// denyRead of ~/ and never re-allowed. The OS temp dir is not covered by that deny.
export const runsRoot = (home: string) => join(home, '.junction', 'runs');

export function runClaudeProcess(cfg: {
  apiUrl: string;
  token: string;
  project: string;
  log: (line: string) => void;
  runMs?: number; // tests only
}): Deps['runClaude'] {
  return async ({ cwd, prompt, repoDir, repo }) => {
    const { gitDir, worktreeGitDir } = await gitPaths(repoDir, cwd); // from the repo: no git runs inside the worktree
    // The sandbox hides ~/, including the user's git config, so pass the identity in the env.
    const gitConfig = (key: string) => exec('git', ['config', key], { cwd: repoDir }).then((v) => v.trim(), () => undefined);
    const identity = { name: await gitConfig('user.name'), email: await gitConfig('user.email') };
    await mkdir(runsRoot(homedir()), { recursive: true, mode: 0o700 });
    const dir = await mkdtemp(join(runsRoot(homedir()), 'run-'));
    try {
      const settingsPath = join(dir, 'settings.json');
      const mcpConfigPath = join(dir, 'mcp.json');
      const npmCache = join(dir, 'npm-cache');
      await mkdir(npmCache);
      await writeFile(
        settingsPath,
        JSON.stringify(
          sandboxSettings({
            worktree: cwd,
            gitDir,
            worktreeGitDir,
            apiHost: new URL(cfg.apiUrl).host, // host:port, so other localhost ports stay closed
            nodePrefix: dirname(dirname(process.execPath)),
            npmCache,
          }),
        ),
      );
      await writeFile(
        mcpConfigPath,
        JSON.stringify({
          mcpServers: {
            junction: {
              type: 'http',
              url: `${cfg.apiUrl}/mcp`,
              headers: { Authorization: `Bearer ${cfg.token}`, 'X-Junction-Project': cfg.project, 'X-Junction-Repo': repo },
            },
          },
        }),
      );
      const env = childEnv(process.env, npmCache, identity);
      await new Promise<void>((ok, fail) => {
        const child = spawn('claude', claudeArgs({ prompt, settingsPath, mcpConfigPath }), {
          cwd,
          env,
          detached: true, // own process group, so a timeout can kill grandchildren too
          stdio: ['ignore', 'pipe', 'pipe'], // stdin closed so `claude -p` never waits on it
        });
        const killGroup = () => {
          try {
            process.kill(-child.pid!, 'SIGKILL');
          } catch {} // already gone (or never started)
        };
        process.once('exit', killGroup); // detached children don't get the terminal's Ctrl-C
        let tail = '';
        let settled = false;
        const settle = (f: () => void) => {
          if (settled) return; // a spawn error is followed by a close; a timeout by a late close
          settled = true;
          clearTimeout(timer);
          process.off('exit', killGroup);
          f();
        };
        child.stdout.resume();
        child.stderr.on('data', (c) => (tail = (tail + c).slice(-500)));
        const timer = setTimeout(() => {
          killGroup();
          settle(() => fail(new Error(RUN_TIMEOUT)));
        }, cfg.runMs ?? RUN_MS);
        child.on('error', (e) => settle(() => fail(e)));
        child.on('close', (code) =>
          settle(() => {
            if (code) cfg.log(`claude exited with code ${code}\n${clean(tail)}`);
            ok(); // any other ending is judged from the task's status
          }),
        );
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };
}
