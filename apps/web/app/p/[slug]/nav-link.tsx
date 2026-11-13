'use client';
import { usePathname } from 'next/navigation';

// Exact match for the Overview (`exact`), prefix match for everything else.
// The title and aria-label carry the page name (and count) for when the sidebar is collapsed to icons.
export function NavLink({ href, exact, label, icon, count, attention }: { href: string; exact?: boolean; label: string; icon: React.ReactNode; count?: number; attention?: boolean }) {
  const path = usePathname();
  const active = exact ? path === href : path === href || path.startsWith(`${href}/`);
  return (
    <a href={href} title={label} aria-label={count ? `${label}, ${count}` : label} className={active ? 'active' : undefined} aria-current={active ? 'page' : undefined}>
      {icon}
      <span className="lbltxt">{label}</span>
      {count ? <span className={`count${attention ? ' attention' : ''}`}>{count > 9 ? '9+' : count}</span> : null}
    </a>
  );
}
