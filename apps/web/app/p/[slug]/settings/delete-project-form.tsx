'use client';
import { useActionState } from 'react';
import { deleteProjectAction } from '../actions';

export function DeleteProjectForm({ slug, name }: { slug: string; name: string }) {
  const [state, action, pending] = useActionState(deleteProjectAction, {});
  return (
    <>
      <form action={action} className="form">
        <input type="hidden" name="slug" value={slug} />
        <label><span>Type <b>{name}</b> to confirm</span><input name="name" autoComplete="off" required /></label>
        <div><button disabled={pending}>Delete project</button></div>
      </form>
      {state.error && <p className="error" role="alert">{state.error}</p>}
    </>
  );
}
