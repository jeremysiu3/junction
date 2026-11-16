'use client';
import { useActionState } from 'react';
import { createWorkerCredentialAction } from './actions';

const repos = { 'your-repo': '/path/to/your/clone' };

export function WorkerCredentialForm({ slug, origin }: { slug: string; origin: string }) {
  const [state, action, pending] = useActionState(createWorkerCredentialAction, {});
  const config = state.token && JSON.stringify({ apiUrl: origin, token: state.token, projects: { [slug]: repos } }, null, 2);
  return (
    <>
      <form action={action} className="form">
        <label>Name<input name="name" defaultValue="My laptop" required maxLength={60} /></label>
        <div><button className="primary" disabled={pending}>Create worker credential</button></div>
      </form>
      {state.error && <p className="error" role="alert">{state.error}</p>}
      {config && (
        <>
          <p className="muted" style={{ margin: 'var(--space-4) 0 var(--space-2)' }}>Save this as <code>~/.junction/worker.json</code>. The token is shown only now. Then run <code>npx junctionmcp</code>.</p>
          <pre className="snippet">{config}</pre>
        </>
      )}
    </>
  );
}

export function WorkerStep({ slug, origin, seen }: { slug: string; origin: string; seen: boolean }) {
  return (
    <>
      <h2 className="lbl">Step 2 · Start your background worker {seen && <span className="p-ok">✓ A worker has checked in. Make sure this project is in its worker.json.</span>}</h2>
      <p className="muted">The worker runs approved tasks with your own Claude Code on your machine. One worker per machine serves all your projects.</p>
      <p className="muted">Add this under <code>projects</code> in your existing <code>~/.junction/worker.json</code>, then restart the worker (it reads the file at startup).</p>
      <pre className="snippet">{`"${slug}": ${JSON.stringify(repos)}`}</pre>
      <h4>Only if this machine has no worker yet</h4>
      <WorkerCredentialForm slug={slug} origin={origin} />
    </>
  );
}
