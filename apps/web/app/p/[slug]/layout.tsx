import { badgeCounts, projectsFor, userProfile } from '@junction/core';
import { Brain, Check, ChevronDown, ChevronUp, House, Inbox, Plus, Settings, SquareKanban } from 'lucide-react';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { db } from '../../../lib/db';
import { projectFromSlug } from '../../../lib/project';
import { signOut } from '../../login/actions';
import { Lockup } from '../../lockup';
import { Avatar } from './avatar';
import { NavLink } from './nav-link';
import { SidebarToggle } from './sidebar-toggle';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { actor, project } = await projectFromSlug((await params).slug);
  const { inbox, attention } = await badgeCounts(db, actor, project.id);
  const n = inbox + attention;
  return { title: n > 0 ? `(${n}) Junction` : 'Junction' };
}

export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { actor, project } = await projectFromSlug(slug);
  const [projects, counts, jar, me] = await Promise.all([projectsFor(db, actor.userId), badgeCounts(db, actor, project.id), cookies(), userProfile(db, actor.userId)]);
  const mini = jar.get('junction_sidebar')?.value === 'mini';
  const base = `/p/${project.slug}`;
  const icon = { size: 18, className: 'ic', 'aria-hidden': true } as const;
  return (
    <div className={`shell${mini ? ' mini' : ''}`}>
      <aside className="sidebar">
        <div className="top">
          <Lockup />
          <SidebarToggle mini={mini} />
        </div>
        <details className="project-switch">
          <summary><span className="project-current">{project.name}</span><ChevronDown size={14} className="chev" aria-hidden="true" /></summary>
          <div className="menu">
            {projects.map((p) => (
              <a key={p.id} href={`/p/${p.slug}`} aria-current={p.id === project.id ? 'true' : undefined}>
                <span>{p.name}</span>{p.id === project.id && <Check size={14} aria-hidden="true" />}
              </a>
            ))}
            <a href="/new"><span className="new-project"><Plus size={14} aria-hidden="true" />New project</span></a>
          </div>
        </details>
        <nav className="nav">
          <NavLink href={base} exact label="Overview" icon={<House {...icon} />} count={counts.attention} attention />
          <NavLink href={`${base}/inbox`} label="Inbox" icon={<Inbox {...icon} />} count={counts.inbox} />
          <NavLink href={`${base}/board`} label="Board" icon={<SquareKanban {...icon} />} />
          <NavLink href={`${base}/memory`} label="Memory" icon={<Brain {...icon} />} />
          <NavLink href={`${base}/settings`} label="Project settings" icon={<Settings {...icon} />} />
        </nav>
        <details className="account">
          <summary aria-label={`Account menu, ${me.name}`}>
            <Avatar name={me.name} url={me.avatarUrl} size={24} />
            <span className="name">{me.name}</span>
            <ChevronUp size={14} className="chev" aria-hidden="true" />
          </summary>
          <div className="menu">
            <div className="email">{me.email}</div>
            <a href={`${base}/account`}>Settings</a>
            <form action={signOut}><button>Sign out</button></form>
          </div>
        </details>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
