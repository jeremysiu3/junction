import { projectsFor } from '@junction/core';
import { Plus } from 'lucide-react';
import { redirect } from 'next/navigation';
import { db } from '../lib/db';
import { requireHuman } from '../lib/human';
import { signOut } from './login/actions';
import { NewProject } from './new/new-project';
import { DeleteAccountForm } from './p/[slug]/account/delete-account-form';

export default async function Home() {
  const actor = await requireHuman();
  const projects = await projectsFor(db, actor.userId);
  if (projects.length === 1) redirect(`/p/${projects[0].slug}`);
  if (projects.length > 1) return (
    <main className="auth">
      <div className="card">
        <div className="brand">Junction</div>
        <h1>Choose a project</h1>
        <div className="menu">
          {projects.map((p) => <a key={p.id} href={`/p/${p.slug}`}>{p.name}</a>)}
          <a href="/new"><Plus size={14} aria-hidden="true" />New project</a>
        </div>
        <form action={signOut}><button>Sign out</button></form>
      </div>
    </main>
  );
  return (
    <main className="auth">
      <div className="card">
        <div className="brand">Junction</div>
        <NewProject first />
        <p className="muted">Or ask a teammate for an invite link.</p>
        <details>
          <summary>Delete account</summary>
          <p className="muted">Deleting your account disconnects your agents and workers. Your past work stays, shown as Deleted user. This can&apos;t be undone.</p>
          <DeleteAccountForm />
        </details>
        <form action={signOut}><button>Sign out</button></form>
      </div>
    </main>
  );
}
