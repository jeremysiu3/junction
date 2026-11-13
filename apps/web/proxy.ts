import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { cookieOptions } from './lib/supabase';

// Refreshes the dashboard session cookie before pages render. Bearer-token routes (/mcp, /api, /.well-known) are skipped.
export async function proxy(req: NextRequest) {
  let res = NextResponse.next({ request: req });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookieOptions: cookieOptions(),
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list, headers) => {
        list.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: req });
        list.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
        // No-store headers, so a CDN never caches one user's session cookie for another.
        Object.entries(headers).forEach(([k, v]) => res.headers.set(k, v));
      },
    },
  });
  await supabase.auth.getClaims();
  return res;
}

export const config = {
  matcher: ['/((?!mcp|api|.well-known|_next/static|_next/image|favicon.ico).*)'],
};
