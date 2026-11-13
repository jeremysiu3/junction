// Assumes a freshly reset DB: npm run db:reset && npm run seed
import { createClient } from '@supabase/supabase-js';
import { createDb, recordWork, saveArea } from '@junction/core';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

const ok = <T>(r: { data: T | null; error: { message: string } | null }): T => {
  if (r.error || r.data === null) throw new Error(r.error?.message ?? 'no data');
  return r.data;
};

const local = (url = '') => URL.canParse(url) && ['127.0.0.1', 'localhost'].includes(new URL(url).hostname);

async function main() {
  if (!local(process.env.DATABASE_URL) || !local(process.env.NEXT_PUBLIC_SUPABASE_URL)) {
    console.error('seed only runs against local Supabase');
    process.exit(1);
  }
  const people = [
    { name: 'Jeremy', email: 'jeremy@example.com' },
    { name: 'Jaxon', email: 'jaxon@example.com' },
    { name: 'Scott', email: 'scott@example.com' },
  ];

  const users: Record<string, { id: string; email: string }> = {};
  for (const p of people) {
    const { data, error } = await supabase.auth.admin.createUser({ email: p.email, password: 'password123', email_confirm: true });
    if (error) throw error;
    const row = ok(await supabase.from('users').insert({ name: p.name, email: p.email, auth_user_id: data.user.id }).select('id').single());
    users[p.name] = { id: row.id, email: p.email };
  }

  const project = ok(await supabase.from('projects').insert({ slug: 'demo', name: 'Demo' }).select('id').single());
  const pid = project.id;

  ok(await supabase.from('memberships').insert(Object.entries(users).map(([name, u]) => ({ project_id: pid, user_id: u.id, role: name === 'Jeremy' ? 'admin' : 'member' }))).select());

  const entry = (author: string, kind: string, title: string, body: string) => ({ project_id: pid, author_id: users[author].id, kind, title, body });
  ok(await supabase.from('context_entries').insert([
    entry('Jeremy', 'decision', 'Exports format', 'Exports are CSV, not XLSX'),
    entry('Jaxon', 'note', 'Reports API rate limit', 'Reports API rate-limits at 100/min'),
  ]).select());

  const db = createDb(process.env.DATABASE_URL);
  try {
    const human = { userId: users.Jeremy.id, type: 'human' as const };
    await saveArea(db, human, { projectId: pid, name: 'Site', ownerId: users.Jeremy.id });
    await saveArea(db, human, { projectId: pid, name: 'Reports API', ownerId: users.Jaxon.id });
    await recordWork(db, { userId: users.Jaxon.id, type: 'agent' }, {
      projectId: pid, repo: 'site', key: 'feat/site-ui', title: 'Site UI', area: 'Site', paths: ['apps/site'],
      done: [{ text: 'Landing and pricing pages', evidence: 'apps/site/pages' }, { text: 'Nav and footer' }],
      notDone: ['Contact form backend', 'Auth'], summary: 'UI pages done; nothing behind the forms yet',
    });
  } finally {
    await db.end();
  }

  for (const [name, u] of Object.entries(users)) {
    console.log(`\n${name}: ${u.email} / password123`);
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
