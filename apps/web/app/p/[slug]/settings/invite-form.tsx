'use client';
import { useActionState } from 'react';
import { inviteAction } from '../actions';

export function InviteForm({ slug }: { slug: string }) {
  const [state, action, pending] = useActionState(inviteAction, null);
  return (
    <>
      <form action={action} className="form">
        <input type="hidden" name="slug" value={slug} />
        <label>Invite by email<input type="email" name="email" required placeholder="name@example.com" /></label>
        <div><button className="primary" disabled={pending}>Send invite</button></div>
      </form>
      {state && 'error' in state && <p className="error" role="alert">{state.error}</p>}
      {state && 'sent' in state && (state.sent
        ? <p className="muted" role="status">Invite sent to {state.email}</p>
        : <p className="muted" role="status">Email failed — copy this link: <code>{state.link}</code></p>)}
    </>
  );
}
