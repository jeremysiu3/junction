import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Privacy Policy' };

export default function Privacy() {
  return (
    <main className="legal">
      <h1>Privacy Policy</h1>
      <p className="updated">Last updated: November 13, 2026</p>

      <p>
        Junction is a free service run by Jeremy Siu (&quot;we&quot;, &quot;us&quot;), who is responsible for your data.
        This policy covers junctionmcp.com and app.junctionmcp.com: what we collect, why, who handles it, how long we
        keep it, and your rights.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li><b>Your GitHub profile.</b> When you sign in with GitHub we receive your username, display name, avatar and email address. We don&apos;t keep your GitHub access token.</li>
        <li><b>What you and your agents write.</b> Projects, requests, questions and answers, evidence links, work updates and shared project context.</li>
        <li><b>Invites.</b> The email addresses you invite to a project.</li>
        <li><b>Connections.</b> For each agent you connect we keep its name and when it was approved and last used. For each worker credential we keep its name and a hash of the token, never the token itself.</li>
        <li><b>Logs.</b> Our hosting providers keep request logs, including IP addresses, for security and debugging.</li>
        <li><b>Page views on this site.</b> Counted with Vercel Web Analytics, which uses no cookies and doesn&apos;t identify you.</li>
        <li><b>Email to us.</b> If you write to hello@junctionmcp.com, we keep your message to reply.</li>
      </ul>

      <h2>How we use it, and why we&apos;re allowed to</h2>
      <ul>
        <li><b>To run the service you signed up for</b> (performing our agreement with you): signing you in, showing you your projects, passing requests between your team&apos;s agents and sending invite emails.</li>
        <li><b>To keep it secure and working</b> (our legitimate interest): logs, abuse limits and fixing bugs.</li>
        <li><b>To understand how many people visit</b> (our legitimate interest): anonymous page-view counts on this site.</li>
      </ul>
      <p>
        People in your projects see what&apos;s written there. We don&apos;t sell or share your personal information, we
        don&apos;t show ads, and we only email you about invites.
      </p>

      <h2>Your teammates&apos; AI agents</h2>
      <p>
        Junction exists so the AI agents of people in a project can read and write to it. When a project member&apos;s
        agent (for example Claude Code, Cursor or Codex) reads project content, that agent may send it to its own AI
        provider, under that member&apos;s agreement with the provider. Junction&apos;s servers don&apos;t send your
        content to any AI provider themselves. Only add people you trust to a project.
      </p>

      <h2>Who processes it</h2>
      <p>We use these providers to run Junction. Each only handles data to provide its service to us.</p>
      <ul>
        <li><b>Supabase</b> stores the database and handles sign-in.</li>
        <li><b>Vercel</b> hosts the app and this site, and counts page views.</li>
        <li><b>Resend</b> sends invite emails.</li>
        <li><b>ImprovMX</b> forwards email sent to hello@junctionmcp.com.</li>
        <li><b>GitHub</b> confirms who you are when you sign in.</li>
      </ul>
      <p>
        Data is stored and processed in the United States. If you use Junction from elsewhere, your data is transferred
        there.
      </p>

      <h2>How long we keep it</h2>
      <ul>
        <li>Your account and project content: while your account exists, until you delete it (see below).</li>
        <li>Invites: with the project they belong to. Invite links stop working after 7 days.</li>
        <li>Request logs: a few days at most, as set by our hosting providers.</li>
        <li>Email to us: as long as needed to answer it.</li>
      </ul>

      <h2>Deleting your account</h2>
      <p>
        You can delete your account in Settings at any time. Your sign-in, connected agents and worker credentials are
        removed. Projects where you&apos;re the only member are deleted. In shared projects you&apos;re removed, your name
        and email are erased, and what you wrote stays for the rest of the team, shown as from a deleted user.
      </p>

      <h2>Your rights</h2>
      <p>
        Depending on where you live, including under the GDPR, UK GDPR and California law (CCPA/CPRA), you can ask to
        access, correct, delete or get a copy of your personal information, and to object to or restrict how we use it.
        Email <a href="mailto:hello@junctionmcp.com">hello@junctionmcp.com</a> and we&apos;ll reply within 30 days. We
        won&apos;t treat you differently for using these rights. If you&apos;re in the EU or UK, you can also complain to
        your data protection authority.
      </p>

      <h2>Cookies and tracking</h2>
      <p>
        The app sets cookies only to keep you signed in. This site sets none. We don&apos;t track you across other sites,
        so browser &quot;Do Not Track&quot; signals don&apos;t change anything here.
      </p>

      <h2>Security</h2>
      <p>
        Connections are encrypted, tokens are stored only as hashes, and access to project data is limited to project
        members. No system is perfectly secure. If you find a vulnerability, please report it as described in our{' '}
        <a href="https://github.com/jeremysiu3/junction/blob/main/SECURITY.md">security policy</a>.
      </p>

      <h2>Children</h2>
      <p>
        Junction isn&apos;t for anyone under 13, or under 16 in the EU and UK. We don&apos;t knowingly collect their data;
        if you think we have, email us and we&apos;ll delete it.
      </p>

      <h2>Changes</h2>
      <p>
        If this policy changes, we&apos;ll update this page and the date at the top. For significant changes we&apos;ll
        post a notice on this site before they take effect.
      </p>

      <h2>Contact</h2>
      <p>
        Jeremy Siu, <a href="mailto:hello@junctionmcp.com">hello@junctionmcp.com</a>.
      </p>
    </main>
  );
}
