'use client';
import { useActionState } from 'react';
import { createWorkerCredentialAction } from './actions';

export function WorkerCredentialForm() {
  const [state, action, pending] = useActionState(createWorkerCredentialAction, {});
  return (
    <>
      <form action={action} className="form">
        <label>Name<input name="name" defaultValue="My laptop" required maxLength={60} /></label>
        <div><button className="primary" disabled={pending}>Create worker credential</button></div>
      </form>
      {state.error && <p className="error" role="alert">{state.error}</p>}
      {state.token && (
        <>
          <p className="muted" style={{ margin: 'var(--space-4) 0 var(--space-2)' }}>Copy this token for step 2. It&apos;s shown only now.</p>
          <pre className="snippet">{state.token}</pre>
        </>
      )}
    </>
  );
}

export function WorkerStep({ seen }: { seen: boolean }) {
  return (
    <>
      <h2 className="lbl">Step 2 · Start your background worker {seen && <span className="p-ok">✓ A worker has checked in</span>}</h2>
      <p className="muted">The worker runs approved tasks with your own Claude Code on your machine. One worker per machine serves all your projects. It needs Node 20+, the GitHub CLI (<code>gh</code>) logged in, and Claude Code.</p>
      <h4>1. Create a worker credential <span className="muted">(first time on this machine)</span></h4>
      <WorkerCredentialForm />
      <h4>2. In your clone of each repo in this project, run</h4>
      <pre className="snippet">npx junctionmcp init</pre>
      <p className="muted">It reads the repo&apos;s <code>junction.json</code> and adds the repo to your worker. The first time, it asks for the token from step 1; it stays hidden as you paste, so press Enter when done.</p>
      <h4>3. Start the worker</h4>
      <pre className="snippet">npx junctionmcp</pre>
      <p className="muted">Restart it after adding a repo; it reads its config at startup.</p>
    </>
  );
}
