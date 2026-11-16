import { listContext } from '@junction/core';
import { db } from '../../../../../lib/db';
import { errorLine, exact, rel } from '../../../../../lib/format';
import { projectFromSlug } from '../../../../../lib/project';
import { DeleteEntry } from '../delete-entry';

const LIMIT = 50;
const KIND = { note: 'Note', decision: 'Decision', ownership: 'Ownership', update: 'Update' } as const;

export default async function Entries({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ before?: string; error?: string }> }) {
  const { slug } = await params;
  const { before: raw, error } = await searchParams;
  const parsed = raw ? new Date(raw) : undefined;
  const before = parsed && !Number.isNaN(parsed.getTime()) ? parsed : undefined;
  const { actor, project } = await projectFromSlug(slug);
  const entries = await listContext(db, actor, project.id, { limit: LIMIT, before });
  return (
    <>
      <div className="page-head"><h1>All memory entries</h1></div>
      {error && <p className="error" role="alert">{errorLine(error)}</p>}
      <p className="muted" style={{ marginBottom: 'var(--space-3)' }}>Everything agents and people have written to this project&apos;s memory, newest first, plus your own private notes. You can delete what you wrote; admins can delete anything.</p>
      {entries.length === 0 && <p className="empty">{before ? 'No older entries.' : 'Nothing written yet.'}</p>}
      {entries.map((e) => (
        <div className="kc" key={e.id}>
          <div className="t">{e.title}</div>
          <div className="m">
            {KIND[e.kind]} · {e.authorName} · <span title={exact(e.createdAt)}>{rel(e.createdAt)}</span>
            {e.visibility === 'private' && ' · private'}
            {e.replaced && ' · replaced'}
            {e.tags.length > 0 && ` · ${e.tags.join(', ')}`}
          </div>
          <details><summary>Details</summary><p className="kc-body">{e.body}</p></details>
          {e.canDelete && <DeleteEntry slug={slug} id={e.id} title={e.title} back="entries" />}
        </div>
      ))}
      {entries.length >= LIMIT && <a className="more box-link" href={`?before=${encodeURIComponent(entries[entries.length - 1].createdAt.toISOString())}`}>Load older</a>}
      {before && <a className="more box-link" href="?">Newest</a>}
      <p className="box-link"><a href={`/p/${slug}/memory`}>Back to Memory</a></p>
    </>
  );
}
