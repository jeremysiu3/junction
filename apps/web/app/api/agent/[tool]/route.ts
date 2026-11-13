import { JunctionError, userByWorkerToken } from '@junction/core';
import { STATUS_OF, runTool } from '../../../../lib/agent-tools';
import { db } from '../../../../lib/db';

export async function POST(req: Request, ctx: { params: Promise<{ tool: string }> }): Promise<Response> {
  try {
    const token = req.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
    const user = token ? await userByWorkerToken(db, token) : null;
    if (!user) throw new JunctionError('unauthorized', 'missing or invalid worker token');
    const { tool } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const args = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    const { result, project } = await runTool(db, { userId: user.id, via: 'worker' }, tool, args, {
      project: req.headers.get('x-junction-project'), repo: req.headers.get('x-junction-repo'),
    });
    return Response.json({ result, project });
  } catch (e) {
    if (e instanceof JunctionError) return Response.json({ error: { code: e.code, message: e.message } }, { status: STATUS_OF(e.code) });
    console.error(e);
    return Response.json({ error: { code: 'internal', message: 'Internal error' } }, { status: 500 });
  }
}
