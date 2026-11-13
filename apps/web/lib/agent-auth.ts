import { createClient } from '@supabase/supabase-js';
import { agentSession, userByWorkerToken } from '@junction/core';
import { db } from './db';
import type { AgentCaller } from './agent-tools';
import { configuredOrigin } from './origin';

export type VerifyJwt = (token: string) => Promise<{ sessionId: string; clientId: string } | null>;

// Created once, on first use: vitest doesn't load the Supabase env, and tests inject `verify` instead.
let client: ReturnType<typeof createClient> | undefined;
const supabase = () =>
  (client ??= createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  }));

export const verifySupabaseJwt: VerifyJwt = async token => {
  try {
    const { data } = await supabase().auth.getClaims(token);
    const sessionId = data?.claims.session_id;
    const clientId = data?.claims.client_id;
    return typeof sessionId === 'string' && typeof clientId === 'string' ? { sessionId, clientId } : null;
  } catch {
    return null;
  }
};

// A jw_ token is a worker credential. Anything else must be an OAuth access token for a live agent session.
export async function authenticateAgent(req: Request, verify: VerifyJwt = verifySupabaseJwt): Promise<AgentCaller | null> {
  const token = /^bearer\s+(.+)$/i.exec(req.headers.get('authorization')?.trim() ?? '')?.[1].trim();
  if (!token) return null;
  if (token.startsWith('jw_')) {
    const user = await userByWorkerToken(db, token);
    return user ? { userId: user.id, via: 'worker' } : null;
  }
  const claims = await verify(token);
  if (!claims) return null;
  const session = await agentSession(db, claims.sessionId);
  return session && session.clientId === claims.clientId ? { userId: session.id, via: 'oauth' } : null;
}

// The origin the client used to reach us: next dev reports localhost even for a 127.0.0.1 request, so prefer the forwarded/Host headers.
export function requestOrigin(req: Request): string {
  const fixed = configuredOrigin();
  if (fixed) return fixed;
  const url = new URL(req.url);
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? url.host;
  const proto = req.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '');
  return `${proto}://${host}`;
}

export const unauthorized = (origin: string) =>
  Response.json(
    { error: { code: 'unauthorized', message: 'sign in: connect this agent to Junction' } },
    { status: 401, headers: { 'WWW-Authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"` } },
  );
