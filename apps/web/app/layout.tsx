import { Figtree } from 'next/font/google';
import './globals.css';

const sans = Figtree({ subsets: ['latin'], variable: '--font-sans' });

export const metadata = { title: 'Junction' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={sans.variable}>
      <body>{children}</body>
    </html>
  );
}
