'use server';
import { redirect } from 'next/navigation';
import { devLoginEnabled } from '../../lib/human';
import { safeNext } from '../../lib/next';
import { origin } from '../../lib/origin';
import { supabaseServer } from '../../lib/supabase';

export async function signInWithGitHub(formData: FormData) {
  const { data, error } = await (await supabaseServer()).auth.signInWithOAuth({
    provider: 'github',
    options: {
      redirectTo: (await origin()) + '/auth/callback?next=' + encodeURIComponent(safeNext(formData.get('next'))),
      skipBrowserRedirect: true,
    },
  });
  redirect(error ? '/login?error=1' : data.url);
}

// Dev-only: seeded password users for local testing and the test suite.
export async function signIn(formData: FormData) {
  if (!devLoginEnabled()) redirect('/login?error=1');
  const { error } = await (await supabaseServer()).auth.signInWithPassword({
    email: String(formData.get('email')),
    password: String(formData.get('password')),
  });
  redirect(error ? '/login?error=1' : safeNext(formData.get('next')));
}

export async function signOut() {
  await (await supabaseServer()).auth.signOut({ scope: 'local' }); // this browser only, not the user's other sessions
  redirect('/login');
}
