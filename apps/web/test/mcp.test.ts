import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDb } from '@junction/core';
import { makeProject } from '@junction/core/test/fixtures';
import { authenticateAgent } from '../lib/agent-auth';
import { GET as metadata } from '../app/.well-known/oauth-protected-resource/[[...path]]/route';
import { GET, POST } from '../app/mcp/route';

// Keeps the real authenticateAgent unless a test asks for an OAuth caller.
vi.mock('../lib/agent-auth', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/agent-auth')>();
  return { ...actual, authenticateAgent: vi.fn(actual.authenticateAgent) };
});

const db = createDb();
afterAll(() => db.end());

let p: Awaited<ReturnType<typeof makeProject>>;
let other: Awaited<ReturnType<typeof makeProject>>;
beforeAll(async () => {
  p = await makeProject(db);
  other = await makeProject(db);
});
const asOauth = (userId: string) => vi.mocked(authenticateAgent).mockResolvedValueOnce({ userId, via: 'oauth' });

const rpc = (method: string, params: object = {}, headers: Record<string, string> = {}) =>
  POST(new Request('http://localhost/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  }));
const withToken = (token: string, extra: Record<string, string> = {}) => ({ authorization: `Bearer ${token}`, ...extra });
const listTools = async (headers: Record<string, string>) => {
  const res = await rpc('tools/list', {}, headers);
  expect(res.status).toBe(200);
  return (await res.json()).result.tools as { name: string; inputSchema: { properties: Record<string, unknown> } }[];
};
const callTool = async (headers: Record<string, string>, name: string, args: object) =>
  (await (await rpc('tools/call', { name, arguments: args }, headers)).json()).result as { isError?: boolean; content: { text: string }[] };

describe('POST /mcp', () => {
  it('rejects a request without credentials and points to the metadata', async () => {
    const res = await rpc('initialize');
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('/.well-known/oauth-protected-resource/mcp');
  });

  it('answers GET and DELETE with 405 (stateless, no standalone stream)', async () => {
    const res = await GET();
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });

  it('builds discovery URLs from the forwarded host', async () => {
    const res = await POST(new Request('http://localhost:3000/mcp', { method: 'POST', headers: { 'x-forwarded-host': '127.0.0.1:3000', 'x-forwarded-proto': 'http' } }));
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('resource_metadata="http://127.0.0.1:3000/.well-known/oauth-protected-resource/mcp"');
  });

  it('initializes, and a worker credential does not see interactive tools', async () => {
    const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } }, withToken(p.jeremy.token));
    expect(init.status).toBe(200);
    expect((await init.json()).result.instructions).toContain('unattended');
    const names = (await listTools(withToken(p.jeremy.token))).map(t => t.name);
    expect(names).toContain('record_work');
    for (const blocked of ['send_task', 'check_inbox', 'join_task']) expect(names).not.toContain(blocked);
  });

  it('gives an OAuth caller every tool, each taking project', async () => {
    asOauth(p.jeremy.id);
    const tools = await listTools({ authorization: 'Bearer t' });
    const names = tools.map(t => t.name);
    for (const n of ['send_task', 'join_task', 'leave_task', 'check_inbox', 'record_work']) expect(names).toContain(n);
    for (const t of tools) expect(t.inputSchema.properties).toHaveProperty('project');
  });

  it('prefixes results with the project slug', async () => {
    asOauth(p.jeremy.id);
    const r = await callTool({ authorization: 'Bearer t' }, 'get_board', { project: p.project.slug });
    expect(r.isError).toBeUndefined();
    expect(r.content[0].text.startsWith(`[project: ${p.project.slug}]\n`)).toBe(true);
  });

  it('turns a JunctionError into an error result', async () => {
    asOauth(p.jeremy.id);
    const r = await callTool({ authorization: 'Bearer t' }, 'get_board', { project: other.project.slug });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/^forbidden:/);
  });

  it('ignores x-junction-project for an OAuth caller', async () => {
    asOauth(p.jeremy.id);
    const r = await callTool({ authorization: 'Bearer t', 'x-junction-project': other.project.slug }, 'get_board', {});
    expect(r.isError).toBeUndefined();
    expect(r.content[0].text.startsWith(`[project: ${p.project.slug}]`)).toBe(true);
  });

  it("keeps a worker to its header's project: no project parameter, and a project argument never reaches another", async () => {
    const q = await makeProject(db);
    await db`insert into memberships (project_id, user_id) values (${q.project.id}, ${p.jeremy.id})`;
    const headers = withToken(p.jeremy.token, { 'x-junction-project': p.project.slug });
    for (const t of await listTools(headers)) expect(t.inputSchema.properties, t.name).not.toHaveProperty('project');
    const r = await callTool(headers, 'get_board', { project: q.project.slug });
    expect(r.content[0].text.startsWith(`[project: ${p.project.slug}]`)).toBe(true);
  });

  it('honours x-junction-project for a worker credential', async () => {
    const r = await callTool(withToken(p.jeremy.token, { 'x-junction-project': other.project.slug }), 'get_board', {});
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/^forbidden:/);
  });
});

describe('oauth-protected-resource metadata', () => {
  it('describes the MCP resource and its one authorization server', async () => {
    const res = await metadata(new Request('http://localhost/.well-known/oauth-protected-resource/mcp'));
    const body = await res.json();
    expect(body.resource).toBe('http://localhost/mcp');
    expect(body.authorization_servers).toHaveLength(1);
    expect(body.authorization_servers[0]).toMatch(/\/auth\/v1$/);
    expect(body.bearer_methods_supported).toEqual(['header']);
  });

  it('uses the forwarded host for the resource URL', async () => {
    const res = await metadata(new Request('http://localhost:3000/.well-known/oauth-protected-resource/mcp', { headers: { 'x-forwarded-host': '127.0.0.1:3000', 'x-forwarded-proto': 'http' } }));
    expect((await res.json()).resource).toBe('http://127.0.0.1:3000/mcp');
  });
});
