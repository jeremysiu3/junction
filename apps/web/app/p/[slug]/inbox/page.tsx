import { pendingApprovals } from '@junction/core';
import { db } from '../../../../lib/db';
import { errorLine, when } from '../../../../lib/format';
import { projectFromSlug } from '../../../../lib/project';
import { Live } from '../live';
import { InboxList, type Req } from './inbox-list';

export default async function Inbox({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string }> }) {
  const { slug } = await params;
  const { error } = await searchParams;
  const { actor, project } = await projectFromSlug(slug);
  const reqs: Req[] = (await pendingApprovals(db, actor))
    .filter((t) => t.projectId === project.id)
    .map((t) => ({
      id: t.id,
      title: t.title,
      from: t.requesterName,
      repo: t.repo,
      ago: when(t.createdAt),
      // Requests sent before M4 have no `changes`; fall back to the first 2 lines of the description.
      changes: t.changes ?? t.description.split('\n').filter((l) => l.trim()).slice(0, 2),
      blocking: t.blockingReason,
      description: t.description,
      deferred: !!t.deferredAt,
      coRequesters: t.coRequesterNames,
      notDuplicateReason: t.notDuplicateReason,
      workItem: t.fromWorkItemId ? { id: t.fromWorkItemId, text: `From ${t.fromWorkItemOwner}'s ${t.fromWorkItemKey}: ${t.fromItem}` } : null,
    }));
  return (
    <>
      <div className="page-head"><h1>Inbox</h1><Live /></div>
      {error && <p className="error">{errorLine(error)}</p>}
      <InboxList slug={slug} reqs={reqs} />
    </>
  );
}
