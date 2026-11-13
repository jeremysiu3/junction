import { EVENT_TEXT, getTaskDetail, JunctionError } from '@junction/core';
import { notFound } from 'next/navigation';
import { db } from '../../../../../lib/db';
import { exact, rel } from '../../../../../lib/format';
import { projectFromSlug } from '../../../../../lib/project';
import { answerAction, retryAction } from '../../actions';
import { Hidden } from '../../agent-panel';
import { Live } from '../../live';
import { Pill } from '../../pill';

export default async function TaskDetail({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const { actor, project } = await projectFromSlug(slug);
  const { task, requesterName, assigneeName, coRequesterNames, events, questions } = await getTaskDetail(db, actor, project.id, id).catch((e) => {
    if (e instanceof JunctionError && e.code === 'not_found') notFound();
    throw e;
  });
  const mine = actor.userId === task.assigneeId;
  const pr = task.evidenceUrl?.match(/\/pull\/(\d+)/)?.[1];
  return (
    <>
      <div className="page-head">
        <p><a href={`/p/${slug}/board`}>Board</a></p>
        <h1>{task.title}</h1>
        <Live />
      </div>
      <div className="stack detail">
        <section className="card">
          <p className="card-meta">
            <Pill status={task.status} background={task.background} prNumber={task.status === 'in_review' && pr ? Number(pr) : null} />
            <span>{requesterName} → {assigneeName}</span>
            {task.repo && <span>repo <span className="mono">{task.repo}</span></span>}
            {task.branch && <span>branch <span className="mono">{task.branch}</span></span>}
            {task.evidenceUrl && <a href={task.evidenceUrl} className="mono">{pr ? 'View pull request' : task.evidenceUrl}</a>}
          </p>
          {coRequesterNames.length > 0 && <p className="card-meta">Also requested by {coRequesterNames.join(', ')}</p>}
          {task.notDuplicateReason && <p className="card-meta">Sent despite a similar open request: {task.notDuplicateReason}</p>}
          {task.changes && task.changes.length > 0 && (
            <>
              <h4>Proposed changes</h4>
              <ul>{task.changes.map((c, i) => <li key={i}>{c}</li>)}</ul>
            </>
          )}
          {task.blockingReason && <><h4>Blocking</h4><p>{task.blockingReason}</p></>}
          <h4>Description</h4>
          <p className="req-desc">{task.description}</p>
        </section>
        {questions.length > 0 && (
          <section>
            <h2 className="lbl">Questions and answers</h2>
            {questions.map((q, i) => (
              <div key={i} className="kc">
                <div className="t">{q.question}</div>
                <div className="kc-body">{q.answer ?? <span className="muted">Waiting for an answer.</span>}</div>
                <div className="m">Asked {exact(q.createdAt)}{q.answeredAt && `, answered ${exact(q.answeredAt)}`}</div>
              </div>
            ))}
          </section>
        )}
        {mine && task.status === 'needs_input' && (
          <form action={answerAction} className="task">
            <Hidden slug={slug} id={task.id} />
            <textarea name="answer" required rows={3} aria-label={`Answer for ${task.title}`} placeholder="Your answer" />
            <div className="btns"><button className="primary">Answer</button></div>
          </form>
        )}
        {mine && task.status === 'stuck' && (
          <form action={retryAction} className="task">
            <Hidden slug={slug} id={task.id} />
            <div className="btns"><button>Retry</button><span className="m">This task is stuck.</span></div>
          </form>
        )}
        <section>
          <h2 className="lbl">Log</h2>
          <div className="log">
            {events.map((e, i) => (
              <div key={i} className={`ev${e.actorType === 'agent' ? ' dim' : ''}`}>
                <span className="time" title={exact(e.createdAt)}>{rel(e.createdAt)}</span>
                <div className="x">
                  <b>{e.actorName}{e.actorType === 'agent' && "'s agent"}</b> {EVENT_TEXT[e.event] ?? e.event} {task.title}{e.event === 'created' && ` to ${assigneeName}`}
                  {e.note && <div className="m">{e.note}</div>}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
