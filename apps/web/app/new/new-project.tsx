'use client';
import { useActionState } from 'react';
import { createProjectAction } from './actions';

export function NewProject({ first }: { first?: boolean }) {
  const [state, action, pending] = useActionState(createProjectAction, null);
  return (
    <>
      <h1>{first ? 'Create your first project' : 'New project'}</h1>
      {state && <p className="error" role="alert" style={{ marginTop: 'var(--space-4)', marginBottom: 0 }}>{state.error}</p>}
      <form action={action}>
        <input name="name" placeholder="Project name" aria-label="Project name" required maxLength={60} />
        <button className="primary" disabled={pending}>Create project</button>
      </form>
    </>
  );
}
