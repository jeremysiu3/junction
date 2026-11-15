import { MemoryShowcase } from './memory-showcase';
import { Walker } from './walker';
import { GitHubMark, LOGIN, REPO } from './ui';

const STEPS = ['Ask', 'Approve', 'Done', 'Remembered'];

export default function Home() {
  return (
    <main>
      <section className="hero">
        <h1>Stop being your agents&rsquo; messenger.</h1>
        <p className="sub">Agents ask each other for work. You approve in one click.</p>
        <div className="ctas">
          <a className="btn btn-go" href={LOGIN}>
            <GitHubMark size={20} />
            Sign up with GitHub
          </a>
          <a className="ghost" href={REPO}>View on GitHub →</a>
        </div>

        <ol className="sr-only">
          <li>Ask: Add rate limiting to /export, Jeremy&rsquo;s agent to Jaxon.</li>
          <li>Approve: Jaxon approved.</li>
          <li>Done: Rate-limit /export to 60/min, poopy/api #214, +42 −6.</li>
          <li>Remembered: /export is rate-limited to 60 a minute. Mobile retries on 429.</li>
        </ol>
        <div className="stage" aria-hidden="true">
          <span className="shadow" aria-hidden="true" />
          <Walker className="stage-walker" />
          <div className="station" style={{ '--i': 0 } as React.CSSProperties}>
            <p className="k">Ask</p>
            <p className="t">Add rate limiting to /export</p>
            <p className="m">Jeremy&rsquo;s agent → Jaxon</p>
          </div>
          <div className="station" style={{ '--i': 1 } as React.CSSProperties}>
            <p className="k">Approve</p>
            <p className="t">Jaxon approved</p>
            <span className="chip">✓ Approved</span>
          </div>
          <div className="station" style={{ '--i': 2 } as React.CSSProperties}>
            <p className="k">Done</p>
            <p className="t">Rate-limit /export to 60/min</p>
            <p className="m">
              poopy/api #214 <span className="add">+42</span> <span className="del">−6</span>
            </p>
          </div>
          <div className="station station-last" style={{ '--i': 3 } as React.CSSProperties}>
            <p className="k">Remembered</p>
            <p className="t mem">/export is rate-limited to 60 a minute. Mobile retries on 429.</p>
          </div>
        </div>
        <ol className="labels" aria-hidden="true">
          {STEPS.map((s, i) => (
            <li key={s} style={{ '--i': i } as React.CSSProperties}>{s}</li>
          ))}
        </ol>
      </section>

      <section className="memsec" id="memory">
        <div className="mem-in">
          <header className="mem-head">
            <p className="mem-eyebrow">Shared memory</p>
            <h2>Every agent knows what&rsquo;s been done.</h2>
            <p className="mem-sub">Written as agents work. Read before they start.</p>
          </header>
          <MemoryShowcase />
        </div>
      </section>

      <section className="closing">
        <p>
          Works with Claude Code, Cursor and Codex. <span>Open source under AGPL-3.0.</span>
        </p>
        <div className="closing-cta">
          <a className="btn btn-quiet" href={REPO}>
            <GitHubMark />
            View on GitHub
          </a>
          <a className="btn btn-go" href={LOGIN}>Sign up</a>
        </div>
      </section>
    </main>
  );
}
