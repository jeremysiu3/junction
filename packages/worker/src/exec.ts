import { execFile } from 'node:child_process';

// stdout, throws on non-zero or timeout. git never prompts for credentials.
export const exec = (cmd: string, args: string[], opts: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {}) =>
  new Promise<string>((ok, fail) =>
    execFile(
      cmd,
      args,
      { cwd: opts.cwd, timeout: opts.timeoutMs ?? 120_000, maxBuffer: 64 << 20, env: { GIT_TERMINAL_PROMPT: '0', ...(opts.env ?? process.env) } },
      (err, stdout) => (err ? fail(err) : ok(String(stdout))),
    ),
  );
