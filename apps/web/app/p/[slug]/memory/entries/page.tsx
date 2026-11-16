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
  params: Promise<{ slug: string }>; searchParams: Promise<{ before?: string; error?: string; kind?: string; tag?: string; q?: string }>;
}) {
  const { slug } = await params;
  const { before: raw, error, kind: rawKind, tag: rawTag, q: rawQ } = await searchParams;
  const parsed = raw ? new Date(raw) : undefined;
  const before = parsed && !Number.isNaN(parsed.getTime()) ? parsed : undefined;
  const kind = rawKind && Object.hasOwn(KIND, rawKind) ? (rawKind as Kind) : undefined;
  const tag = rawTag?.trim().slice(0, 50) || undefined;
  const q = rawQ?.trim().slice(0, 100) || undefined;
  const { actor, project } = await projectFromSlug(slug);
  const [entries, counts] = await Promise.all([
    listContext(db, actor, project.id, { limit: LIMIT, before, kind, tag, q }),
    contextCounts(db, actor, project.id, { tag, q }),
  ]);
  return (
    <>
      <div className="page-head"><h1>All memory entries</h1></div>
      {error && <p className="error" role="alert">{errorLine(error)}</p>}
      <form className="mem-search" role="search">
        {kind && <input type="hidden" name="kind" value={kind} />}
        {tag && <input type="hidden" name="tag" value={tag} />}
        <input type="search" name="q" defaultValue={q} placeholder="Search memory" aria-label="Search memory" maxLength={100} />
        <button>Search</button>
        {q && <a href={qs({ kind, tag })}>Clear</a>}
      </form>
      <Folders base="" counts={counts} active={kind ?? 'all'} tag={tag} q={q} />
      {tag && <p className="tagbar">Tag <b>#{tag}</b> · <a href={qs({ kind, q })}>Clear</a></p>}
      {entries.length === 0 && <p className="empty">{before ? 'No older entries.' : q ? `Nothing matches \u201c${q}\u201d.` : 'Nothing here yet.'}</p>}
      <div className="mem-grid">
      {entries.map((e) => (
        <div className="kc" key={e.id}>
          <div className="t">{e.title}</div>
          <div className="m">
            {KIND[e.kind]} · {e.authorName} · <span title={exact(e.createdAt)}>{rel(e.createdAt)}</span>
            {e.visibility === 'private' && ' · private'}
            {e.replaced && ' · replaced'}
            {e.tags.map((t) => <span key={t}> · <a href={qs({ kind, tag: t, q })}>#{t}</a></span>)}
          </div>
          <details><summary>Details</summary><p className="kc-body">{e.body}</p></details>
          {e.canDelete && <DeleteEntry slug={slug} id={e.id} title={e.title} back="entries" />}
        </div>
      ))}
      </div>
      {entries.length >= LIMIT && <a className="more box-link" href={qs({ kind, tag, q, before: entries[entries.length - 1].createdAt.toISOString() })}>Load older</a>}
      {before && <a className="more box-link" href={qs({ kind, tag, q })}>Newest</a>}
      <p className="box-link"><a href={`/p/${slug}/memory`}>Back to Memory</a></p>
    </>
  );
}
