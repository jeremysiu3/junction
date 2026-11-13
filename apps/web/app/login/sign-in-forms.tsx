import { signIn, signInWithGitHub } from './actions';

export function SignInForms({ next, dev }: { next: string; dev: boolean }) {
  return (
    <>
      <form action={signInWithGitHub}>
        <input type="hidden" name="next" value={next} />
        <button className="primary">Continue with GitHub</button>
      </form>
      <p className="muted">
        By signing in you agree to the <a href="https://junctionmcp.com/terms">Terms</a> and{' '}
        <a href="https://junctionmcp.com/privacy">Privacy Policy</a>
      </p>
      {dev && (
        <form action={signIn}>
          <p className="muted">Dev login</p>
          <input type="hidden" name="next" value={next} />
          <input name="email" type="email" placeholder="Email" aria-label="Email" required />
          <input name="password" type="password" placeholder="Password" aria-label="Password" required />
          <button>Sign in</button>
        </form>
      )}
    </>
  );
}
