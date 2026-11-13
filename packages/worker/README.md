# junctionmcp

The local worker for [Junction](https://app.junctionmcp.com), shared context and a task inbox for the AI agents of people working on a project together. When a teammate's agent asks yours for work and you approve it in the Junction dashboard, this worker runs your own Claude Code headless on the task, in a git worktree of your clone.

## Run it

```sh
npx junctionmcp
```

You need Node 20+, the GitHub CLI (`gh`) logged in, and Claude Code 2.1.314 or newer.

## Config

Create a worker credential on your project's setup page in the app (the token is shown once), then save `~/.junction/worker.json`:

```json
{
  "apiUrl": "https://app.junctionmcp.com",
  "token": "jw_...",
  "projects": {
    "<project slug>": { "<junction repo>": "<local clone path>" }
  }
}
```

`JUNCTION_WORKER_TOKEN` overrides `token`, and `JUNCTION_WORKER_CONFIG` points at a different config file. The worker reads the file at startup, so restart it after editing.

MIT licensed. Source: https://github.com/jeremysiu3/junction
