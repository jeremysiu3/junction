import { getWorkItem, JunctionError } from '@junction/core';
import { notFound } from 'next/navigation';
import { db } from '../../../../../lib/db';
import { ago, errorLine, exact, rel } from '../../../../../lib/format';
import { Pill } from '../../pill';
import { projectFromSlug } from '../../../../../lib/project';
import { abandon } from '../../actions';

export default async function WorkDetail({ params, searchParams }: { params: Promise<{ slug: string; id: string }>; searchParams: Promise<{ error?: string }> }) {
  const { slug, id } = await params;
  const { error } = await searchParams;
  const { actor, project } = await projectFromSlug(slug);
  const w = await getWorkItem(db, actor, project.id, id).catch((e) => {
    if (e instanceof JunctionError) notFound();
    throw e;
  });
  return (
    <>
      <div className="page-head">
        <p><a href={`/p/${slug}/board`}>Board</a></p>
        <h1>{w.title}</h1>
      </div>
      {error && <p className="error" role="alert">{errorLine(error)}</p>}
      <div className="stack detail">
        <section className="card">
          <dl className="fields">
            <dt>Status</dt>
            <dd>
              <Pill status={w.status} />{' '}
              {w.stale && <span className="pill p-stuck">Stale, {ago(w.daysSinceActivity)}</span>}
            </dd>
            <dt>Owner</dt><dd>{w.ownerName}</dd>
            <dt>Key</dt><dd className="mono">{w.key}</dd>
            <dt>Repo</dt><dd>{w.repo}</dd>
            <dt>Responsibility</dt><dd>{w.areaName ?? <span className="muted">none</span>}</dd>
            <dt>Last activity</dt><dd>{exact(w.lastActivityAt)}</dd>
            <dt>Started</dt><dd>{exact(w.createdAt)}</dd>
            <dt>Paths</dt>
            <dd>{w.paths.length ? w.paths.map((p) => <div key={p} className="mono">{p}</div>) : <span className="muted">none</span>}</dd>
          </dl>
        </section>
        <section className="card">
          <h4>Done</h4>
          {w.done.length === 0 ? <p className="muted">Nothing done yet.</p> : (
            <ul>
              {w.done.map((d, i) => (
                <li key={i}>
                  {d.text}{' '}
                  {d.confirmed ? <span className="muted mono">{d.evidence}</span> : <span className="pill p-ask">unconfirmed</span>}
                </li>
              ))}
            </ul>
          )}
          <h4>Not done</h4>
          {w.notDone.length === 0 ? <p className="muted">Nothing left.</p> : <ul>{w.notDone.map((t, i) => <li key={i}>{t}</li>)}</ul>}
        </section>
        {w.stale && (
          <section className="card">
            <h3>Mark abandoned</h3>
            <p className="muted">No activity for {w.daysSinceActivity} days. Abandoned work stops showing as in progress.</p>
            <form action={abandon} className="actions">
              <input type="hidden" name="slug" value={slug} /><input type="hidden" name="id" value={w.id} />
              <button className="danger">Mark abandoned</button>
            </form>
          </section>
        )}
        <section>
          <h2 className="lbl">History</h2>
          <div className="log">
            {w.updates.map((u, i) => (
              <div key={i} className="ev">
                <span className="time" title={exact(u.createdAt)}>{rel(u.createdAt)}</span>
                <div className="x">
                  <b>{u.authorName}</b> {u.summary}
                  <div className="m">{u.status.replace('_', ' ')} · {u.done.length} done, {u.notDone.length} not done</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
