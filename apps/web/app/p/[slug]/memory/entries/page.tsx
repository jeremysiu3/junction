import { contextCounts, listContext } from '@junction/core';
import { db } from '../../../../../lib/db';
import { errorLine, exact, rel } from '../../../../../lib/format';
import { projectFromSlug } from '../../../../../lib/project';
import { DeleteEntry } from '../delete-entry';
import { Folders, qs } from '../folders';

const LIMIT = 50;
const KIND = { note: 'Note', decision: 'Decision', ownership: 'Ownership', update: 'Update' } as const;
type Kind = keyof typeof KIND;

export default async function Entries({ params, searchParams }: {
  params: Promise<{ slug: string }>; searchParams: Promise<{ before?: string; error?: string; kind?: string; tag?: string }>;
}) {
  const { slug } = await params;
  const { before: raw, error, kind: rawKind, tag: rawTag } = await searchParams;
  const parsed = raw ? new Date(raw) : undefined;
  const before = parsed && !Number.isNaN(parsed.getTime()) ? parsed : undefined;
  const kind = rawKind && Object.hasOwn(KIND, rawKind) ? (rawKind as Kind) : undefined;
  const tag = rawTag?.trim().slice(0, 50) || undefined;
  const { actor, project } = await projectFromSlug(slug);
  const [entries, counts] = await Promise.all([
    listContext(db, actor, project.id, { limit: LIMIT, before, kind, tag }),
    contextCounts(db, actor, project.id, tag),
  ]);
  return (
    <>
      <div className="page-head"><h1>All memory entries</h1></div>
      {error && <p className="error" role="alert">{errorLine(error)}</p>}
      <p className="muted" style={{ marginBottom: 'var(--space-3)' }}>Everything agents and people have written to this project&apos;s memory, newest first, plus your own private notes. You can delete what you wrote; admins can delete anything.</p>
      <Folders base="" counts={counts} active={kind ?? 'all'} tag={tag} />
      {tag && <p className="tagbar">Tag <b>#{tag}</b> · <a href={qs({ kind })}>Clear</a></p>}
      {entries.length === 0 && <p className="empty">{before ? 'No older entries.' : 'Nothing here yet.'}</p>}
      {entries.map((e) => (
        <div className="kc" key={e.id}>
          <div className="t">{e.title}</div>
          <div className="m">
            {KIND[e.kind]} · {e.authorName} · <span title={exact(e.createdAt)}>{rel(e.createdAt)}</span>
            {e.visibility === 'private' && ' · private'}
            {e.replaced && ' · replaced'}
            {e.tags.map((t) => <span key={t}> · <a href={qs({ kind, tag: t })}>#{t}</a></span>)}
          </div>
          <details><summary>Details</summary><p className="kc-body">{e.body}</p></details>
          {e.canDelete && <DeleteEntry slug={slug} id={e.id} title={e.title} back="entries" />}
        </div>
      ))}
      {entries.length >= LIMIT && <a className="more box-link" href={qs({ kind, tag, before: entries[entries.length - 1].createdAt.toISOString() })}>Load older</a>}
      {before && <a className="more box-link" href={qs({ kind, tag })}>Newest</a>}
      <p className="box-link"><a href={`/p/${slug}/memory`}>Back to Memory</a></p>
    </>
  );
}
