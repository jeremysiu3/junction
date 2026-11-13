'use client';
import { useActionState } from 'react';
import { deleteAccountAction } from '../actions';

export function DeleteAccountForm() {
  const [state, action, pending] = useActionState(deleteAccountAction, {});
  return (
    <>
      <form action={action} className="form">
        <label>Your email<input name="email" type="email" autoComplete="off" required /></label>
        <div><button disabled={pending}>Delete account</button></div>
      </form>
      {state.error && <p className="error" role="alert">{state.error}</p>}
    </>
  );
}
