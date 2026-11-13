import { devLoginEnabled } from '../../lib/human';
import { SignInForms } from './sign-in-forms';

const EMAIL_TAKEN = "That GitHub account's email is already used by another Junction account. Sign in with that account instead.";

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string; next?: string; deleted?: string }> }) {
  const { error, next = '', deleted } = await searchParams;
  const dev = devLoginEnabled();
  return (
    <main className="auth">
      <div className="card">
        <div className="brand">Junction</div>
        <h1>Sign in to Junction</h1>
        <p className="muted">Approve requests and see what your team&apos;s agents are doing.</p>
        {deleted && <p className="muted" style={{ marginTop: 'var(--space-4)', marginBottom: 0 }}>Your account was deleted.</p>}
        {error && <p className="error" style={{ marginTop: 'var(--space-4)', marginBottom: 0 }}>{error === 'email_taken' ? EMAIL_TAKEN : 'Sign in failed. Try again.'}</p>}
        <SignInForms next={next} dev={dev} />
      </div>
    </main>
  );
}
