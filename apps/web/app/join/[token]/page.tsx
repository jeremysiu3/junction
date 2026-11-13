import { inviteByToken } from '@junction/core';
import { db } from '../../../lib/db';
import { currentHuman, devLoginEnabled } from '../../../lib/human';
import { SignInForms } from '../../login/sign-in-forms';
import { acceptInviteAction } from './actions';

const WHY = { used: 'has already been used', expired: 'has expired', cancelled: 'was cancelled' } as const;

export default async function Join({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await inviteByToken(db, token);
  const actor = invite?.status === 'open' ? await currentHuman() : null;
  return (
    <main className="auth">
      <div className="card">
        <div className="brand">Junction</div>
        {!invite ? (
          <h1>This invite link isn&apos;t valid</h1>
        ) : invite.status !== 'open' ? (
          <>
            <h1>This invite link {WHY[invite.status]}</h1>
            <p className="muted">Ask an admin of {invite.projectName} for a new invite.</p>
          </>
        ) : (
          <>
            <h1>Join {invite.projectName}</h1>
            <p className="muted">{invite.inviterName} invited you.</p>
            {actor ? (
              <form action={acceptInviteAction}>
                <input type="hidden" name="token" value={token} />
                <button className="primary">Join {invite.projectName}</button>
              </form>
            ) : (
              <SignInForms next={`/join/${token}`} dev={devLoginEnabled()} />
            )}
          </>
        )}
      </div>
    </main>
  );
}
