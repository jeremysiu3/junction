import { agentPanel, dashboardSeenAt, overviewNews } from '@junction/core';
import { db } from '../../../lib/db';
import { errorLine } from '../../../lib/format';
import { projectFromSlug } from '../../../lib/project';
import { AgentPanel } from './agent-panel';
import { MarkSeen } from './mark-seen';
import { NewsList } from './news-list';

export default async function Overview({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string }> }) {
  const { slug } = await params;
  const { error } = await searchParams;
  const { actor, project } = await projectFromSlug(slug);
  const [news, rows, seenAt] = await Promise.all([
    overviewNews(db, actor, project.id),
    agentPanel(db, actor, project.id),
    dashboardSeenAt(db, actor, project.id),
  ]);
  return (
    <>
      <MarkSeen slug={slug} />
      <div className="page-head"><h1>Overview</h1></div>
      {error && <p className="error">{errorLine(error)}</p>}
      <div className="two">
        <NewsList items={news} seenAt={seenAt?.toISOString() ?? null} slug={slug} />
        <AgentPanel rows={rows} slug={slug} />
      </div>
    </>
  );
}
