import { JunctionError, type Db } from '@junction/core';
import { STATUS_OF, WORKER_BLOCKED, runTool } from '../lib/agent-tools';
import { POST } from '../app/api/agent/[tool]/route';

// A tool call as an OAuth (interactive) agent: runTool directly, in the /api/agent response shape.
export async function oauthCall(db: Db, user: { id: string }, tool: string, body: unknown, project: string | null, repo?: string): Promise<Response> {
  try {
    const out = await runTool(db, { userId: user.id, via: 'oauth' }, tool, body as Record<string, unknown>, { project, repo });
    return Response.json(out);
  } catch (e) {
    if (e instanceof JunctionError) return Response.json({ error: { code: e.code, message: e.message } }, { status: STATUS_OF(e.code) });
    throw e;
  }
}

// A tool call as the worker: through /api/agent with the user's worker token.
export const workerCall = (user: { token: string }, tool: string, body: unknown, project: string, repo?: string): Promise<Response> =>
  POST(
    new Request(`http://localhost/api/agent/${tool}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${user.token}`, 'x-junction-project': project, ...(repo ? { 'x-junction-repo': repo } : {}) },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ tool }) },
  );

// Worker-blocked tools go through oauthCall, the rest through the worker route.
export const userCall = (db: Db, user: { id: string; token: string }, tool: string, body: unknown, project: string, repo?: string) =>
  WORKER_BLOCKED.includes(tool) ? oauthCall(db, user, tool, body, project, repo) : workerCall(user, tool, body, project, repo);
