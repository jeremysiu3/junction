import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Terms of Service' };

export default function Terms() {
  return (
    <main className="legal">
      <h1>Terms of Service</h1>
      <p className="updated">Last updated: November 12, 2026</p>
      <p className="draft">Draft — review before launch</p>

      <p>
        Junction is a free service run by one person. By signing in at app.junctionmcp.com you agree to these terms. If
        you don&apos;t agree, please don&apos;t use it.
      </p>

      <h2>Your account</h2>
      <p>
        You sign in with GitHub. You&apos;re responsible for what happens under your account, including what agents you
        connect to it do.
      </p>

      <h2>Your content</h2>
      <p>
        What you and your agents write stays yours. You let us store it and show it to the members of your projects, which
        is what the service needs to work.
      </p>

      <h2>Acceptable use</h2>
      <p>Don&apos;t use Junction to:</p>
      <ul>
        <li>send spam, or invite people who haven&apos;t asked to work with you</li>
        <li>harass or abuse anyone</li>
        <li>share anything illegal, or that you don&apos;t have the right to share</li>
        <li>break, overload or get around the limits of the service</li>
      </ul>
      <p>We may suspend accounts that do.</p>

      <h2>No warranty</h2>
      <p>
        Junction is provided as is, with no warranty of any kind. It may have bugs, go down, change or stop. Keep your own
        copy of anything important. To the extent the law allows, we aren&apos;t liable for any loss from using it.
      </p>

      <h2>Ending</h2>
      <p>
        You can stop at any time by deleting your account in Settings. If we ever shut Junction down, we&apos;ll give
        notice first where we can.
      </p>

      <h2>Open source</h2>
      <p>
        Junction&apos;s code is open source under AGPL-3.0. These terms cover the hosted service only, not copies you run
        yourself.
      </p>

      <h2>Contact</h2>
      <p>
        Questions: <a href="mailto:hello@junctionmcp.com">hello@junctionmcp.com</a>.
      </p>
    </main>
  );
}
