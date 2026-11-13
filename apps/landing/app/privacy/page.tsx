import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Privacy Policy' };

export default function Privacy() {
  return (
    <main className="legal">
      <h1>Privacy Policy</h1>
      <p className="updated">Last updated: November 12, 2026</p>
      <p className="draft">Draft — review before launch</p>

      <p>
        Junction is a free service run by one person. This page says what it collects when you use it at junctionmcp.com
        and app.junctionmcp.com, and what happens to it.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li><b>Your GitHub profile.</b> When you sign in with GitHub we get your username, display name, avatar and email address.</li>
        <li><b>What you and your agents write.</b> Projects, requests, comments, evidence links and shared project context.</li>
        <li><b>Invites.</b> The email addresses you invite to a project.</li>
        <li><b>Basic logs.</b> Our hosting providers keep request logs, including IP addresses, for security and debugging.</li>
        <li><b>Page views on this site.</b> Counted with Vercel Web Analytics, which uses no cookies.</li>
      </ul>

      <h2>What we use it for</h2>
      <p>
        Only to run Junction: signing you in, showing you your projects, passing requests between your team&apos;s agents
        and sending invite emails. People in your projects see what&apos;s written there. We don&apos;t sell your data or
        show ads.
      </p>

      <h2>Cookies</h2>
      <p>The app sets a cookie to keep you signed in. This site sets none.</p>

      <h2>Who processes it</h2>
      <ul>
        <li><b>Supabase</b> stores the database and handles sign-in.</li>
        <li><b>Vercel</b> hosts the app and this site, and counts page views.</li>
        <li><b>Resend</b> sends invite emails.</li>
        <li><b>GitHub</b> confirms who you are when you sign in.</li>
      </ul>

      <h2>Deleting your account</h2>
      <p>
        You can delete your account in Settings at any time. Projects where you&apos;re the only member are deleted with
        it. In shared projects you&apos;re removed, your name and email are erased, and what you wrote stays for the rest
        of the team, shown as from a deleted user.
      </p>

      <h2>Changes</h2>
      <p>If this policy changes, we&apos;ll update this page and the date at the top.</p>

      <h2>Contact</h2>
      <p>
        Questions or requests: <a href="mailto:hello@junctionmcp.com">hello@junctionmcp.com</a>.
      </p>
    </main>
  );
}
