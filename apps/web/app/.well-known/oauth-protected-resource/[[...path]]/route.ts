import { requestOrigin } from '../../../../lib/agent-auth';

// Served at /.well-known/oauth-protected-resource and .../mcp. Supabase Auth is the authorization server (OIDC discovery under its issuer).
export const dynamic = 'force-dynamic';

export function GET(req: Request): Response {
  return Response.json({
    resource: `${requestOrigin(req)}/mcp`,
    authorization_servers: [`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1`],
    bearer_methods_supported: ['header'],
    resource_name: 'Junction',
  });
}
