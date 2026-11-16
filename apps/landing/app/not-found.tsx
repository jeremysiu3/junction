import { LedHand } from './led-hand';
import { LOGIN } from './ui';

export default function NotFound() {
  return (
    <main className="nf">
      <div className="sig">
        <div className="lp on"><LedHand size={72} /></div>
        <div className="lp off"><img src="/brand/figure.png" alt="" /></div>
      </div>
      <h1>Wrong turn.</h1>
      <p>This page doesn&rsquo;t exist, or you don&rsquo;t have access to it.</p>
      <div className="acts">
        <a className="btn btn-go" href="/">Back to Junction</a>
        <a className="btn btn-quiet" href={LOGIN}>Sign in</a>
      </div>
    </main>
  );
}
