import { humanSession, userByAuthId, type Actor } from '@junction/core';
import { redirect } from 'next/navigation';
import { db } from './db';
import { safeNext } from './next';
import { supabaseServer } from './supabase';

// Humans sign in with GitHub, whose amr method is 'oauth'. An agent's OAuth token could be turned into a password
// session (plus a second factor) through GoTrue's APIs, so only a provider login counts. Dev login signs in by password on purpose.
export const providerLogin = (amr: unknown, allowPassword: boolean): boolean =>
  Array.isArray(amr) && amr.some(a => {
    const m = a && typeof a === 'object' ? (a as { method?: unknown }).method : undefined;
    return m === 'oauth' || (allowPassword && m === 'password');
  });

// Dev login signs in by password with seeded users, so it never runs on Vercel.
export const devLoginEnabled = (): boolean => process.env.JUNCTION_DEV_LOGIN === '1' && !process.env.VERCEL;

// Only a dashboard login session counts: an OAuth client's token carries a session too, but humanSession rejects it.
export async function currentHuman(): Promise<Actor | null> {
  const { data } = await (await supabaseServer()).auth.getClaims();
  const claims = data?.claims;
  if (!claims || !providerLogin(claims.amr, devLoginEnabled())) return null;
  const user =
    claims.session_id && (await humanSession(db, claims.session_id)) ? await userByAuthId(db, claims.sub) : null;
  return user && { userId: user.id, type: 'human' };
}

export async function requireHuman(next?: string): Promise<Actor> {
  const actor = await currentHuman();
  if (!actor) redirect(next ? '/login?next=' + encodeURIComponent(safeNext(next)) : '/login');
  return actor;
}
