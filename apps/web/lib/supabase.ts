import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { configuredOrigin } from './origin';

// Nothing in the browser reads the session (there is no browser client), so scripts can't either; secure once served over https.
export const cookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: Boolean(process.env.VERCEL) || Boolean(configuredOrigin()?.startsWith('https:')),
});

export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookieOptions: cookieOptions(),
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // Server components can't set cookies; server actions can.
        }
      },
    },
  });
}
