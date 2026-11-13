import { ensureUser } from '@junction/core';
import { redirect } from 'next/navigation';
import { db } from '../../../lib/db';
import { safeNext } from '../../../lib/next';
import { supabaseServer } from '../../../lib/supabase';

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const code = params.get('code');
  const { data, error } = code
    ? await (await supabaseServer()).auth.exchangeCodeForSession(code)
    : { data: null, error: true };
  const user = data?.user;
  if (error || !user?.email) redirect('/login?error=1');
  const meta = user.user_metadata ?? {};
  try {
    await ensureUser(db, {
      authUserId: user.id,
      email: user.email,
      name: meta.full_name || meta.user_name || user.email.split('@')[0],
    });
  } catch (e) {
    if ((e as { code?: string }).code !== '23505') throw e;
    // The GitHub email belongs to another account: drop the session we just made.
    await (await supabaseServer()).auth.signOut({ scope: 'local' });
    redirect('/login?error=email_taken');
  }
  redirect(safeNext(params.get('next')));
}
