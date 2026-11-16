import { getSnapshot, listInvites, listMembers, roleOf, staleDays, type AreaView } from '@junction/core';
import { db } from '../../../../lib/db';
import { errorLine } from '../../../../lib/format';
import { projectFromSlug } from '../../../../lib/project';
import {
  cancelInviteAction, removeMemberAction, renameProjectAction, saveAreaAction, setRoleAction, setStaleDaysAction,
} from '../actions';
import { InviteForm } from './invite-form';

type Member = { id: string; name: string };

function AreaForm({ slug, members, area }: { slug: string; members: Member[]; area?: AreaView }) {
  return (
    <form action={saveAreaAction} className="form">
      <input type="hidden" name="slug" value={slug} />
      {area && <input type="hidden" name="id" value={area.id} />}
      <div className="form-grid">
        <label>Responsibility<input name="name" required placeholder="Reports API" defaultValue={area?.name} /></label>
        <label>
          Owner
          <select name="ownerId" defaultValue={area?.ownerId ?? ''}>
            <option value="">No owner</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
      </div>
      <label>Description<textarea name="description" rows={2} defaultValue={area?.description} /></label>
      <div><button className="primary">{area ? 'Save changes' : 'Add responsibility'}</button></div>
    </form>
  );
}

export default async function Settings({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string }> }) {
  const { slug } = await params;
  const { error } = await searchParams;
  const { actor, project } = await projectFromSlug(slug);
  const admin = (await roleOf(db, actor.userId, project.id)) === 'admin';
  const [{ areas }, members, days, invites] = await Promise.all([
    getSnapshot(db, actor, { projectId: project.id }),
    listMembers(db, actor, project.id),
    staleDays(db, project.id),
    admin ? listInvites(db, actor, project.id) : [],
  ]);
  return (
    <>
      <div className="page-head"><h1>Project settings</h1></div>
      {error && <p className="error" role="alert">{errorLine(error)}</p>}
      <div className="halves">
        {admin && (
          <section className="sec">
            <h2 className="lbl">Project</h2>
            <div className="kc">
              <form action={renameProjectAction} className="form">
                <input type="hidden" name="slug" value={slug} />
                <label>Name<input name="name" required maxLength={60} defaultValue={project.name} /></label>
                <div><button className="primary">Rename</button></div>
              </form>
            </div>
          </section>
        )}
        <section className="sec">
          <h2 className="lbl">Repos</h2>
          <div className="kc">
            <p className="m">Commit this as <code>junction.json</code> at the root of each repo in this project, with the repo&apos;s name. Agents working in the repo read it to find this project.</p>
            <pre className="snippet">{`{"project":"${project.slug}","repo":"your-repo"}`}</pre>
            <p className="m">For background work, also map the repo to its local folder in your worker&apos;s <code>~/.junction/worker.json</code>. The <a href={`/p/${slug}/setup`}>agent setup</a> page shows how.</p>
          </div>
        </section>
      </div>
      <details className="sec fold" open>
        <summary><h2 className="lbl">Members</h2></summary>
        {members.map((m) => (
          <div key={m.id} className="kc">
            <div className="t">{m.name} <span className={`pill p-${m.role === 'admin' ? 'ok' : 'wait'}`}>{m.role}</span></div>
            <div className="m">{m.email}</div>
            {admin && (
              <div className="acts">
                <form action={setRoleAction}>
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="userId" value={m.id} />
                  <input type="hidden" name="role" value={m.role === 'admin' ? 'member' : 'admin'} />
                  <button>{m.role === 'admin' ? 'Remove admin' : 'Make admin'}</button>
                </form>
                <details>
                  <summary>Remove</summary>
                  <form action={removeMemberAction}>
                    <input type="hidden" name="slug" value={slug} />
                    <input type="hidden" name="userId" value={m.id} />
                    <p className="m">Remove {m.name} from {project.name}? Their open tasks are cancelled.</p>
                    <button className="danger">Confirm remove</button>
                  </form>
                </details>
              </div>
            )}
          </div>
        ))}
        {admin && (
          <>
            {invites.map((i) => (
              <div key={i.id} className="kc">
                <div className="t">{i.email} <span className="pill p-ask">invited</span></div>
                <div className="m">Expires {i.expiresAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
                <div className="acts">
                  <form action={cancelInviteAction}>
                    <input type="hidden" name="slug" value={slug} />
                    <input type="hidden" name="id" value={i.id} />
                    <button>Cancel</button>
                  </form>
                </div>
              </div>
            ))}
            <div className="kc"><InviteForm slug={slug} /></div>
          </>
        )}
      </details>
      <div className="two">
        <details className="fold" open>
          <summary><h2 className="lbl">Responsibilities</h2></summary>
          <p className="muted" style={{ marginBottom: 'var(--space-2)' }}>What each person is responsible for. Agents check this to send requests to the right person.</p>
          {areas.length === 0 && <p className="empty">{admin ? 'No responsibilities yet. Add one below.' : 'No responsibilities yet.'}</p>}
          {areas.map((a) => (
            <div key={a.id} className="kc">
              <div className="t">{a.name}</div>
              <div className="m">Owner {a.ownerName ?? 'none'} · {a.inProgress} in progress{a.stale > 0 && ` · ${a.stale} stale`}</div>
              {a.description && <div className="m">{a.description}</div>}
              {a.notDone.length > 0 && (
                <>
                  <div className="m">Not done</div>
                  <ul className="m">{a.notDone.map((n, i) => <li key={i}><a href={`/p/${slug}/work/${n.workItemId}`}><span className="mono">{n.key}</span></a> {n.text}</li>)}</ul>
                </>
              )}
              {admin && (
                <details>
                  <summary>Edit</summary>
                  <AreaForm slug={slug} members={members} area={a} />
                </details>
              )}
            </div>
          ))}
          {admin && (
            <div className="kc">
              <details>
                <summary>New responsibility</summary>
                <AreaForm slug={slug} members={members} />
              </details>
            </div>
          )}
        </details>
        <section>
          <h2 className="lbl">Stale work</h2>
          <div className="kc">
            <form action={setStaleDaysAction} className="form">
              <input type="hidden" name="slug" value={slug} />
              <label>
                Days without activity before work counts as stale
                <input type="number" name="days" min={1} max={365} step={1} required defaultValue={days} />
              </label>
              <div><button className="primary">Save</button></div>
            </form>
          </div>
        </section>
      </div>
    </>
  );
}
