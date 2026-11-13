'use client';
import { useEffect, useState, useTransition } from 'react';
import { approveAction, decline, defer, unapproveAction } from '../actions';

export type Req = {
  id: string; title: string; from: string; repo: string | null; ago: string;
  changes: string[]; blocking: string | null; description: string; deferred: boolean;
  workItem: { id: string; text: string } | null;
  coRequesters: string[]; notDuplicateReason: string | null;
};

// The toast counts 10s; core allows UNDO_SECONDS (15) so a slow click still lands.
const TOAST_SECONDS = 10;
const ERROR_MS = 4000;

type Toast = { id: string; title: string; secs: number } | { error: string };

const Hidden = ({ slug, id }: { slug: string; id: string }) => (
  <>
    <input type="hidden" name="slug" value={slug} />
    <input type="hidden" name="id" value={id} />
  </>
);

function Card({ r, slug, onApprove, busy }: { r: Req; slug: string; onApprove: (r: Req) => void; busy: boolean }) {
  const [declining, setDeclining] = useState(false);
  return (
    <section className="card req">
      <h3 className="req-title">{r.title}</h3>
      <p className="card-meta">From {r.from} · {r.repo && <>repo <span className="mono">{r.repo}</span> · </>}{r.ago}</p>
      {r.coRequesters.length > 0 && <p className="card-meta">Also requested by {r.coRequesters.join(', ')}</p>}
      {r.notDuplicateReason && <p className="card-meta">Sent despite a similar open request: {r.notDuplicateReason}</p>}
      {r.workItem && <p className="card-meta"><a href={`/p/${slug}/work/${r.workItem.id}`}>{r.workItem.text}</a></p>}
      <h4>Proposed changes</h4>
      <ul>{r.changes.map((c, i) => <li key={i}>{c}</li>)}</ul>
      {r.blocking && <><h4>Blocking</h4><p>{r.blocking}</p></>}
      <details><summary>Full description</summary><p className="req-desc">{r.description}</p></details>
      <div className="actions">
        <button className="primary" disabled={busy} onClick={() => onApprove(r)}>Approve</button>
        <form action={defer}><Hidden slug={slug} id={r.id} /><button className="text">Defer</button></form>
        <span className="gap" />
        {declining ? (
          <form action={decline}>
            <Hidden slug={slug} id={r.id} />
            <input name="note" placeholder="Note (optional)" aria-label="Decline note" autoFocus />
            <button className="danger">Decline request</button>
          </form>
        ) : (
          <button onClick={() => setDeclining(true)}>Decline…</button>
        )}
      </div>
    </section>
  );
}

// Holds the toast, so it outlives the card that disappears after the approve revalidates.
export function InboxList({ slug, reqs }: { slug: string; reqs: Req[] }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const [busy, start] = useTransition();

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast('error' in toast ? null : toast.secs > 1 ? { ...toast, secs: toast.secs - 1 } : null), 'error' in toast ? ERROR_MS : 1000);
    return () => clearTimeout(t);
  }, [toast]);

  const approve = (r: Req) => start(async () => {
    const { error } = await approveAction(slug, r.id);
    setToast(error ? { error } : { id: r.id, title: r.title, secs: TOAST_SECONDS });
  });
  const undo = (id: string) => start(async () => {
    const { error } = await unapproveAction(slug, id);
    setToast(error ? { error } : null);
  });

  const open = reqs.filter((r) => !r.deferred);
  const deferred = reqs.filter((r) => r.deferred);
  return (
    <>
      {reqs.length === 0 && <p className="empty">You&apos;re caught up. New requests show up here.</p>}
      <div className="stack">{open.map((r) => <Card key={r.id} r={r} slug={slug} onApprove={approve} busy={busy} />)}</div>
      {deferred.length > 0 && (
        <details className="group">
          <summary>Deferred ({deferred.length})</summary>
          <div className="stack">{deferred.map((r) => <Card key={r.id} r={r} slug={slug} onApprove={approve} busy={busy} />)}</div>
        </details>
      )}
      <div className="toast" role="status">
        {toast && ('error' in toast ? <span>{toast.error}</span> : (
          <>
            <span>Approved {toast.title}<span aria-hidden="true"> · {toast.secs}s to undo</span></span>
            <button onClick={() => undo(toast.id)} disabled={busy}>Undo</button>
          </>
        ))}
      </div>
    </>
  );
}
