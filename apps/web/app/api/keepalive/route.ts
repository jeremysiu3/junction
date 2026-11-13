import { db } from '../../../lib/db';

// Vercel Cron calls this daily (vercel.json) so a free Supabase project never sits idle long enough to pause.
// Vercel sends CRON_SECRET as a bearer token; anyone else gets a 401 without touching the database.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return new Response(null, { status: 401 });
  await db`select 1 from projects limit 1`;
  return new Response(null, { status: 204 });
}
