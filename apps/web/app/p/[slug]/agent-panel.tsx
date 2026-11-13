import type { PanelRow } from '@junction/core';
import { when } from '../../../lib/format';
import { answerAction, retryAction } from './actions';
import { Live } from './live';
import { Pill } from './pill';

export const Hidden = ({ slug, id }: { slug: string; id: string }) => (
  <>
    <input type="hidden" name="slug" value={slug} />
    <input type="hidden" name="id" value={id} />
  </>
);

function Detail({ r }: { r: PanelRow }) {
  const from = `From ${r.requesterName}`;
  const branch = r.branch && <> · <span className="mono">{r.branch}</span></>;
  switch (r.status) {
    case 'needs_input': return <>{from} · asked {when(r.since)}</>;
    case 'in_progress': return <>{from} · started {when(r.since)}{branch}</>;
    case 'approved': return <>{from} · approved {when(r.since)}</>;
    case 'stuck': return <>{from} · stuck {when(r.since)}</>;
    case 'ready_for_review': return <><span className="mono">{r.branch}</span> · open a PR when it looks right</>;
    default: return <>{from} · in review since {when(r.since)}{branch}</>;
  }
}

// Answer boxes are uncontrolled and each row is keyed by task id, so a live refresh never clears half-typed text.
export function AgentPanel({ rows, slug }: { rows: PanelRow[]; slug: string }) {
  return (
    <aside className="agent">
      <div className="lbl-row"><h2 className="lbl">Your background agent</h2><Live /></div>
      {rows.length === 0 && <p className="empty">Nothing running. Approved tasks start here.</p>}
      {rows.map((r) => (
        <div key={r.id} className="task">
          <div className="row">
            <a className="t" href={`/p/${slug}/tasks/${r.id}`}>{r.title}</a>
            <Pill status={r.status} background />
          </div>
          <div className="m"><Detail r={r} /></div>
          {r.status === 'needs_input' && (
            <>
              <div className="q">{r.question}</div>
              <form action={answerAction}>
                <Hidden slug={slug} id={r.id} />
                <textarea name="answer" required rows={2} aria-label={`Answer for ${r.title}`} placeholder="Your answer" />
                <div className="btns"><button className="primary">Answer</button></div>
              </form>
            </>
          )}
          {r.status === 'stuck' && (
            <>
              {r.stuckReason && <div className="m">{r.stuckReason}</div>}
              <form action={retryAction} className="btns">
                <Hidden slug={slug} id={r.id} />
                <button>Retry</button>
              </form>
            </>
          )}
        </div>
      ))}
    </aside>
  );
}
