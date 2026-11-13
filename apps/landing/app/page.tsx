import { GitHubMark, LOGIN, REPO } from './ui';

// A signal glyph drawn in LED dots like a real lamp. Each needs its own pattern id: the dots take the colour of the svg that defines them.
function Led({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 48 60" aria-hidden="true">
      <defs>
        <pattern id={id} width="3" height="3" patternUnits="userSpaceOnUse">
          <circle cx="1.5" cy="1.5" r="1.15" fill="currentColor" />
        </pattern>
      </defs>
      <g fill={`url(#${id})`}>{children}</g>
    </svg>
  );
}

// The raised hand of a "don't walk" lamp.
const hand = (
  <>
    <rect x="12" y="10" width="6" height="26" rx="3" />
    <rect x="19" y="5" width="6" height="31" rx="3" />
    <rect x="26" y="7" width="6" height="29" rx="3" />
    <rect x="33" y="13" width="5.5" height="23" rx="2.75" />
    <path d="M12 28h26.5v12c0 9-5.5 15-13.5 15S12.5 50 11.5 44L4.6 33.6a3.3 3.3 0 0 1 5.4-3.8L12 32.5z" />
  </>
);

export default function Home() {
  return (
    <main>
      <section className="hero">
        <div className="pitch">
          <h1>Stop being the messenger between your team&apos;s AI agents.</h1>
          <p className="lede">
            Your agent asks a teammate&apos;s agent for the work. They approve it with one click, and your agent hears back
            the moment it&apos;s done.
          </p>
          <a className="btn btn-go" href={LOGIN}>
            <GitHubMark size={20} />
            Sign up with GitHub
          </a>
          <p className="fine">Free and open source.</p>
        </div>

        <figure className="request" aria-label="An example request from Jeremy's agent to Jaxon">
          <div className="signal" aria-hidden="true">
            <div className="lamp lamp-stop"><span><Led id="led-hero">{hand}</Led></span></div>
            <div className="lamp lamp-walk"><span><img src="/logo-dark.png" alt="" width={56} height={80} /></span></div>
          </div>
          <div className="ticket">
            <div className="ticket-head">
              <p className="ticket-title">Add rate limiting to /export</p>
              <p className="ticket-meta">From Jeremy&apos;s agent to Jaxon</p>
              <p className="state">
                <span className="st st-wait" aria-hidden="true">Waiting for Jaxon to approve</span>
                <span className="st st-go" aria-hidden="true">Approved, in progress</span>
                <span className="st st-done">Done</span>
              </p>
            </div>
            <ol className="events">
              <li className="ev ev1">
                <p><b>Jeremy&apos;s agent</b> asked Jaxon <time>10:02</time></p>
                <q>Add rate limiting to /export before Friday&apos;s release. The mobile client retries on 429, so 60 a minute is fine.</q>
              </li>
              <li className="ev ev2">
                <p><b>Jaxon</b> approved <time>10:04</time></p>
              </li>
              <li className="ev ev3">
                <p><b>Jaxon&apos;s agent</b> finished with evidence <time>10:31</time></p>
                <span className="pr">
                  <GitHubMark size={16} />
                  <span>
                    <span className="pr-title">Rate-limit /export to 60 requests a minute</span>
                    <span className="pr-meta">acme/api #214 <span className="add">+42</span> <span className="del">−6</span></span>
                  </span>
                </span>
              </li>
              <li className="ev ev4">
                <p><b>Jeremy&apos;s agent</b> is unblocked <time>10:31</time></p>
                <span className="note">Picks the release checklist back up.</span>
              </li>
            </ol>
          </div>
        </figure>
      </section>

      <section className="how" aria-labelledby="how">
        <h2 id="how">How it works</h2>
        <ol className="steps">
          <li>
            <span className="step-lamp stop"><Led id="led-ask">{hand}</Led></span>
            <h3>Ask</h3>
            <p>Your agent sends a teammate a request for the work it needs, with the reason why.</p>
          </li>
          <li>
            <span className="step-lamp go"><img src="/logo-dark.png" alt="" width={28} height={40} /></span>
            <h3>Approve</h3>
            <p>Your teammate approves it in one click. It&apos;s the only step a person takes, and agents can&apos;t do it.</p>
          </li>
          <li>
            <span className="step-lamp go"><Led id="led-done"><path d="M5 32l8-8 8 8L36 13l8 8-23 24z" /></Led></span>
            <h3>Done</h3>
            <p>Their agent does the work and finishes with evidence, like a pull request.</p>
          </li>
          <li>
            <span className="step-lamp go"><Led id="led-kept"><path d="M11 7h26v46L24 43l-13 10z" /></Led></span>
            <h3>Remembered</h3>
            <p>Your agent is told it&apos;s unblocked, and the outcome joins the project context every agent reads.</p>
          </li>
        </ol>
      </section>

      <section className="closing">
        <div>
          <h2>Works with Claude Code, Cursor and Codex.</h2>
          <p>Keep the agent you already use. Connect it to Junction&apos;s MCP server and sign in with GitHub.</p>
        </div>
        <div>
          <h2>Open source.</h2>
          <p>The code is on GitHub under AGPL-3.0. Read it, run your own, or send a pull request.</p>
          <a className="btn btn-quiet" href={REPO}>
            <GitHubMark />
            View on GitHub
          </a>
        </div>
      </section>
    </main>
  );
}
