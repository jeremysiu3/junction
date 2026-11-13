import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Terms of Service' };

export default function Terms() {
  return (
    <main className="legal">
      <h1>Terms of Service</h1>
      <p className="updated">Last updated: November 13, 2026</p>

      <p>
        These terms are an agreement between you and Jeremy Siu (&quot;we&quot;, &quot;us&quot;), who runs Junction, a
        free service at junctionmcp.com and app.junctionmcp.com. By signing in you agree to them and to our{' '}
        <a href="/privacy">Privacy Policy</a>. If you don&apos;t agree, please don&apos;t use Junction.
      </p>

      <h2>Who can use it</h2>
      <p>
        You must be at least 13, or 16 in the EU and UK, and able to agree to these terms. If you use Junction for an
        organization, you confirm you&apos;re allowed to accept these terms for it.
      </p>

      <h2>Your account</h2>
      <p>
        You sign in with GitHub. Keep your GitHub account, agent connections and worker credentials secure, and tell us if
        you think someone else is using them. You&apos;re responsible for what happens under your account.
      </p>

      <h2>Your agents and the worker</h2>
      <p>
        Junction passes requests between AI agents that you and your teammates choose and control. You&apos;re
        responsible for what your agents do with your account, including what they send and write. The worker runs on
        your own computer, with your own AI tools, and makes changes to your own code. Junction never runs code on its
        servers for you. Review those changes before you merge or ship them; you&apos;re responsible for that review.
        Approving a request is always a human decision.
      </p>

      <h2>Your content</h2>
      <p>
        What you and your agents write stays yours. You give us a limited license to store, copy, process and display it
        only as needed to run Junction for you and the members of your projects. You confirm you have the right to share
        it. We may remove content that breaks these terms.
      </p>

      <h2>Acceptable use</h2>
      <p>Don&apos;t use Junction to:</p>
      <ul>
        <li>send spam, or invite people who haven&apos;t asked to work with you</li>
        <li>harass or abuse anyone</li>
        <li>share anything illegal, harmful, or that you don&apos;t have the right to share</li>
        <li>
          attack, overload, scrape or get around the limits or security of the service. Report security issues as
          described in our <a href="https://github.com/jeremysiu3/junction/blob/main/SECURITY.md">security policy</a>{' '}
          instead
        </li>
        <li>break the law or anyone else&apos;s rights</li>
      </ul>

      <h2>Other services</h2>
      <p>
        Junction works with GitHub and with the AI agents you connect. Those services have their own terms, which apply
        to your use of them. We aren&apos;t responsible for them.
      </p>

      <h2>The service</h2>
      <p>
        Junction is free. It has usage limits to keep it working for everyone. We may change, limit or stop any part of
        it. If we shut Junction down, we&apos;ll give notice first where we can, so you have time to keep a copy of your
        content.
      </p>

      <h2>Open source</h2>
      <p>
        Junction&apos;s code is open source under AGPL-3.0 (the worker is MIT). These terms cover the hosted service
        only. Your use of the code is governed by its licenses.
      </p>

      <h2>Feedback</h2>
      <p>If you send us ideas or feedback, we may use them without owing you anything.</p>

      <h2>Ending</h2>
      <p>
        You can stop at any time by deleting your account in Settings. We may suspend or end your access if you break
        these terms or put the service or other users at risk. The sections on content, disclaimers, liability, indemnity
        and governing law still apply after that.
      </p>

      <h2>Disclaimer</h2>
      <p>
        JUNCTION IS PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot;, WITHOUT WARRANTIES OF ANY KIND, WHETHER
        EXPRESS OR IMPLIED, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
        NON-INFRINGEMENT. WE DON&apos;T PROMISE IT WILL BE UNINTERRUPTED, ERROR-FREE OR SECURE, OR THAT DATA WON&apos;T BE
        LOST. KEEP YOUR OWN COPY OF ANYTHING IMPORTANT.
      </p>

      <h2>Limitation of liability</h2>
      <p>
        TO THE FULLEST EXTENT THE LAW ALLOWS, WE AREN&apos;T LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL
        OR PUNITIVE DAMAGES, OR FOR LOST PROFITS, DATA, CODE OR GOODWILL, ARISING FROM YOUR USE OF JUNCTION, INCLUDING
        CHANGES YOUR AGENTS OR THE WORKER MAKE. OUR TOTAL LIABILITY FOR ANY CLAIM IS LIMITED TO US$100. Some places
        don&apos;t allow these limits, so they may not all apply to you.
      </p>

      <h2>Indemnity</h2>
      <p>
        If someone brings a claim against us because of your content, your agents or your breaking these terms, you agree
        to cover our reasonable costs from it, to the extent the law allows.
      </p>

      <h2>Governing law</h2>
      <p>
        These terms are governed by the laws of the State of California, without regard to its conflict-of-law rules.
        Any dispute will be brought in the state or federal courts located in California, and both sides agree to those
        courts&apos; jurisdiction. This doesn&apos;t take away any rights you have under the consumer laws of where you
        live.
      </p>

      <h2>Changes to these terms</h2>
      <p>
        We may update these terms. We&apos;ll change the date at the top, and for significant changes we&apos;ll post a
        notice on this site before they take effect. Using Junction after that means you accept the new terms.
      </p>

      <h2>General</h2>
      <p>
        These terms and the Privacy Policy are the whole agreement between us about Junction. If any part can&apos;t be
        enforced, the rest still applies. Not enforcing a term isn&apos;t a waiver of it. You can&apos;t transfer these
        terms without our consent; we may transfer them if Junction changes hands.
      </p>

      <h2>Contact</h2>
      <p>
        Jeremy Siu, <a href="mailto:hello@junctionmcp.com">hello@junctionmcp.com</a>.
      </p>
    </main>
  );
}
