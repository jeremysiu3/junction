import { activityLog, contextCounts, keyContext, roleOf } from '@junction/core';
import { db } from '../../../../lib/db';
import { dayLabel, errorLine, exact, rel } from '../../../../lib/format';
import { projectFromSlug } from '../../../../lib/project';
import { DeleteEntry } from './delete-entry';
import { Folders } from './folders';

const LIMIT = 50;

// "today", "yesterday", "Nov 9"
const when = (d: Date) => {
  const l = dayLabel(d);
  return l === 'Today' || l === 'Yesterday' ? l.toLowerCase() : l;
};

export default async function Memory({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ before?: string; error?: string }> }) {
  const { slug } = await params;
  const { before: raw, error } = await searchParams;
  const parsed = raw ? new Date(raw) : undefined;
  const before = parsed && !Number.isNaN(parsed.getTime()) ? parsed : undefined;
  const { actor, project } = await projectFromSlug(slug);
  const [keys, log, role, counts] = await Promise.all([
    keyContext(db, actor, project.id),
    activityLog(db, actor, project.id, { before, limit: LIMIT }),
    roleOf(db, actor.userId, project.id),
    contextCounts(db, actor, project.id),
  ]);

  let last = '';
  return (
    <>
      <div className="page-head"><h1>Memory</h1></div>
      {error && <p className="error" role="alert">{errorLine(error)}</p>}
      <Folders base={`/p/${slug}/memory/entries`} counts={counts} />
      <section className="sec">
        <h2 className="lbl">Key context</h2>
        {keys.length === 0 && <p className="empty">No decisions or owners yet. Agents record them with write_context.</p>}
        <div className="mem-grid">
          {keys.map((k) => (
            <div className="kc" key={k.id}>
              <div className="t">{k.title}</div>
              <div className="m">
                {k.kind === 'decision'
                  ? `Decision · ${k.authorName} · ${when(k.createdAt)}${k.replacesTitle ? ` · replaced "${k.replacesTitle}"` : ''}`
                  : `Ownership · since ${when(k.createdAt)}`}
              </div>
              {k.body && <details><summary>Details</summary><p className="kc-body">{k.body}</p></details>}
              {(role === 'admin' || k.authorId === actor.userId) && <DeleteEntry slug={slug} id={k.id} title={k.title} />}
            </div>
          ))}
        </div>
        <p className="box-link"><a href={`/p/${slug}/memory/entries`}>All entries</a></p>
      </section>
      <section>
        <h2 className="lbl">Log</h2>
        {log.length === 0 && (before
          ? <><p className="empty">No older entries.</p><a className="more box-link" href="?">Newest</a></>
          : <p className="empty">Nothing has happened yet.</p>)}
        {log.length > 0 && (
          <div className="log">
            {log.map((e, i) => {
              const day = dayLabel(e.at);
              const head = day !== last;
              last = day;
              const href = e.taskId ? `/p/${slug}/tasks/${e.taskId}` : e.workItemId ? `/p/${slug}/work/${e.workItemId}` : null;
              const line = <><b>{e.actor}</b> {e.text}</>;
              return (
                <div key={i}>
                  {head && <div className="day">{day}</div>}
                  <div className={`ev${e.agent ? ' dim' : ''}`}>
                    <span className="time" title={exact(e.at)}>{rel(e.at)}</span>
                    <div className="x">
                      {href ? <a href={href}>{line}</a> : line}
                      {e.detail && <div className="m">{e.detail}</div>}
                    </div>
                  </div>
                </div>
              );
            })}
            {log.length >= LIMIT && <a className="more box-link" href={`?before=${encodeURIComponent(log[log.length - 1].at.toISOString())}`}>Load older</a>}
            {before && <a className="more box-link" href="?">Newest</a>}
          </div>
        )}
      </section>
    </>
  );
}
