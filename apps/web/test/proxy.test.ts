import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

// A client whose token refresh writes a cookie, as @supabase/ssr does. The last options passed are kept for the cookie test.
let lastOptions: { cookieOptions?: unknown } = {};
vi.mock('@supabase/ssr', () => ({
  createServerClient: (_u: string, _k: string, o: { cookieOptions?: unknown; cookies: { setAll: (l: unknown[], h: Record<string, string>) => void } }) => (lastOptions = o, {
    auth: {
      getClaims: async () =>
        o.cookies.setAll([{ name: 'sb-x', value: 'v', options: {} }], { 'Cache-Control': 'private, no-store', Pragma: 'no-cache' }),
    },
  }),
}));

import { config, proxy } from '../proxy';

// Next anchors a matcher regex to the whole path.
const runs = (path: string) => new RegExp('^' + config.matcher[0] + '$').test(path);

describe('proxy matcher', () => {
  it('skips bearer-token routes and static files', () => {
    for (const p of ['/mcp', '/api/agent/check_inbox', '/.well-known/oauth-protected-resource/mcp', '/_next/static/x.js', '/favicon.ico'])
      expect(runs(p), p).toBe(false);
  });

  it('covers dashboard pages', () => {
    for (const p of ['/', '/login', '/p/demo/inbox', '/oauth/consent']) expect(runs(p), p).toBe(true);
  });
});

describe('proxy', () => {
  it('passes the no-store headers through with refreshed cookies', async () => {
    const res = await proxy(new NextRequest('http://localhost/login'));
    expect(res.cookies.get('sb-x')?.value).toBe('v');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('pragma')).toBe('no-cache');
  });
});

describe('session cookies', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('are httpOnly and lax, and secure only when the app is served over https', async () => {
    vi.stubEnv('VERCEL', '');
    vi.stubEnv('JUNCTION_APP_URL', '');
    await proxy(new NextRequest('http://localhost/login'));
    expect(lastOptions.cookieOptions).toEqual({ httpOnly: true, sameSite: 'lax', secure: false });
    vi.stubEnv('JUNCTION_APP_URL', 'https://app.junctionmcp.com');
    await proxy(new NextRequest('http://localhost/login'));
    expect(lastOptions.cookieOptions).toEqual({ httpOnly: true, sameSite: 'lax', secure: true });
    vi.stubEnv('JUNCTION_APP_URL', '');
    vi.stubEnv('VERCEL', '1');
    await proxy(new NextRequest('http://localhost/login'));
    expect(lastOptions.cookieOptions).toEqual({ httpOnly: true, sameSite: 'lax', secure: true });
  });
});
