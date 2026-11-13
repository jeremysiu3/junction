import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { authenticateAgent, requestOrigin, unauthorized } from '../../lib/agent-auth';
import { buildMcpServer } from '../../lib/mcp-tools';

// Stateless: a fresh server and transport per request. The project headers are the worker's; OAuth callers pass project per call.
export async function POST(req: Request): Promise<Response> {
  const caller = await authenticateAgent(req);
  if (!caller) return unauthorized(requestOrigin(req));
  const worker = caller.via === 'worker';
  const server = buildMcpServer(caller, {
    project: worker ? req.headers.get('x-junction-project') : null,
    repo: worker ? req.headers.get('x-junction-repo') : null,
  });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(req);
}

// Stateless: there is no standalone SSE stream or session to close.
const notAllowed = () => new Response(null, { status: 405, headers: { Allow: 'POST' } });
export { notAllowed as GET, notAllowed as DELETE };
