import { boardColumns, type BoardCard } from '@junction/core';
import { db } from '../../../../lib/db';
import { exact, rel } from '../../../../lib/format';
import { Pill } from '../pill';
import { Live } from '../live';
import { projectFromSlug } from '../../../../lib/project';

const PILLED = new Set(['in_progress', 'approved', 'needs_input', 'stuck', 'ready_for_review', 'in_review']);

const href = (slug: string, c: BoardCard) => `/p/${slug}/${c.kind === 'request' ? 'tasks' : 'work'}/${c.id}`;
const who = (c: BoardCard) => (c.kind === 'request' ? [c.from && c.to && `${c.from} → ${c.to}`] : [[c.owner, c.area].filter(Boolean).join(' · ')]).filter(Boolean);

function Card({ c, slug }: { c: BoardCard; slug: string }) {
  const pilled = c.kind === 'request' ? PILLED.has(c.status) && (c.status !== 'in_progress' || c.background) : false;
  return (
    <a className="bcard" href={href(slug, c)}>
      <div className="t">{c.title}</div>
      <div className="m">
        {pilled && <Pill status={c.status} background={c.background} prNumber={c.prNumber} short />}
        <span>{c.kind === 'request' ? 'Request' : 'Work'}</span>
        {who(c).map((p, i) => <span key={i} className={c.kind === 'work' ? 'nowrap' : undefined}>{p}</span>)}
        <span className={`age${c.old ? ' old' : ''}`} title={`In this column since ${exact(c.since)}`}>{rel(c.since)}</span>
      </div>
    </a>
  );
}

export default async function Board({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { actor, project } = await projectFromSlug(slug);
  const board = await boardColumns(db, actor, project.id);
  const columns = [
    { title: 'Waiting for approval', cards: board.waiting },
    { title: 'In progress', cards: board.inProgress },
    { title: 'Needs a person', cards: board.needsPerson, hot: true },
    { title: 'In review', cards: board.inReview },
  ];
  return (
    <>
      <div className="page-head"><h1>Board</h1><Live /></div>
      <div className="kb">
        {columns.map((col) => (
          <section key={col.title}>
            <h2 className="colh">{col.title} <span className={`c${col.hot && col.cards.length > 0 ? ' hot' : ''}`}>{col.cards.length}</span></h2>
            <div className={`col${col.hot ? ' hot' : ''}`}>
              {col.cards.map((c) => <Card key={`${c.kind}-${c.id}`} c={c} slug={slug} />)}
              {col.cards.length === 0 && <p className="colempty">Nothing here</p>}
            </div>
          </section>
        ))}
      </div>
      <details className="done">
        <summary>Done and declined ({board.done.length})</summary>
        {board.done.map((c) => (
          <a key={`${c.kind}-${c.id}`} className="done-row" href={href(slug, c)}>
            <Pill status={c.status} />
            <span className="t">{c.title}</span>
            <span>{c.kind === 'request' ? 'Request' : 'Work'}</span>
            <span className="age" title={exact(c.since)}>{rel(c.since)}</span>
          </a>
        ))}
      </details>
    </>
  );
}
