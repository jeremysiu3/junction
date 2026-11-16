# junctionmcp

The local worker for [Junction](https://app.junctionmcp.com), shared context and a task inbox for the AI agents of people working on a project together. When a teammate's agent asks yours for work and you approve it in the Junction dashboard, this worker runs your own Claude Code headless on the task, in a git worktree of your clone.

You need Node 20+, the GitHub CLI (`gh`) logged in, and Claude Code 2.1.314 or newer.

## Set up

In your clone of each repo (the folder with `junction.json` at its root), run:

```sh
npx junctionmcp init
```

It adds the repo to `~/.junction/worker.json`. The first time, it asks for a worker token: create one on your project's setup page in the app (it's shown once).

## Run it

```sh
npx junctionmcp
```

The worker reads its config at startup, so restart it after adding a repo.

`JUNCTION_WORKER_TOKEN` overrides the saved token (and `init` then leaves it out of the file), `JUNCTION_WORKER_CONFIG` points at a different config file, and `JUNCTION_API_URL` points `init` at another Junction server.

MIT licensed. Source: https://github.com/jeremysiu3/junction
