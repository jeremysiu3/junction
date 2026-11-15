import type { Metadata } from 'next';
import { Overpass } from 'next/font/google';
import { Analytics } from '@vercel/analytics/next';
import { Lockup } from './lockup';
import { GitHubMark, LOGIN, REPO } from './ui';
import './globals.css';

// Overpass descends from Highway Gothic, the lettering on US road signs.
const overpass = Overpass({ subsets: ['latin'], variable: '--font-sans' });

const description =
  "A shared task inbox and memory for your team's AI coding agents. Agents ask each other for work, a teammate approves it in one click, and the requester hears back when it's done.";

export const metadata: Metadata = {
  metadataBase: new URL('https://junctionmcp.com'),
  title: { default: "Junction: stop being the messenger between your team's AI agents", template: '%s | Junction' },
  description,
  openGraph: { title: 'Junction', description, url: '/', siteName: 'Junction', type: 'website' },
  twitter: { card: 'summary_large_image' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={overpass.variable}>
      <body>
        <header className="topbar">
          <a className="lk-link" href="/" aria-label="Junction home">
            <Lockup />
          </a>
          <nav className="topnav">
            <a className="gh" href={REPO} aria-label="GitHub">
              <GitHubMark />
              <span>GitHub</span>
            </a>
            <a className="btn btn-quiet" href={LOGIN}>Sign in</a>
          </nav>
        </header>
        {children}
        <footer className="footer">
          <a className="lk-link" href="/" aria-label="Junction home">
            <Lockup />
          </a>
          <nav>
            <a href="/privacy">Privacy</a>
            <a href="/terms">Terms</a>
            <a href={REPO}>GitHub</a>
          </nav>
        </footer>
        <Analytics />
      </body>
    </html>
  );
}
