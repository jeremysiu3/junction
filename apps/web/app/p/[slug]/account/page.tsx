import { listConnections, listWorkerCredentials, userProfile } from '@junction/core';
import { db } from '../../../../lib/db';
import { errorLine, when } from '../../../../lib/format';
import { origin } from '../../../../lib/origin';
import { projectFromSlug } from '../../../../lib/project';
import { signOut } from '../../../login/actions';
import { revokeConnectionAction, revokeWorkerAction } from '../actions';
import { Avatar } from '../avatar';
import { WorkerCredentialForm } from '../setup/worker-step';
import { DeleteAccountForm } from './delete-account-form';

export default async function Account({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string }> }) {
  const { slug } = await params;
  const { error } = await searchParams;
  const { actor } = await projectFromSlug(slug);
  const [me, connections, workers, o] = await Promise.all([userProfile(db, actor.userId), listConnections(db, actor), listWorkerCredentials(db, actor), origin()]);
  return (
    <>
      <div className="page-head"><h1>Settings</h1></div>
      {error && <p className="error" role="alert">{errorLine(error)}</p>}
      <section className="sec">
        <h2 className="lbl">Profile</h2>
        <div className="kc profile">
          <Avatar name={me.name} url={me.avatarUrl} size={48} />
          <div>
            <div className="t">{me.name}</div>
            <div className="m">{me.email}</div>
            {me.avatarUrl && <div className="m">From your GitHub account</div>}
          </div>
        </div>
      </section>
      <section className="sec">
        <h2 className="lbl">Your agents</h2>
        {connections.length === 0 && <p className="empty">No agents connected. The setup guide shows how.</p>}
        {connections.map((c) => (
          <div key={c.clientId} className="kc">
            <div className="t">{c.name}</div>
            <div className="m">{c.lastUsedAt ? `Last used ${when(c.lastUsedAt)}` : 'Not used yet'}</div>
            <div className="acts">
              <form action={revokeConnectionAction}>
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="clientId" value={c.clientId} />
                <button>Revoke</button>
              </form>
            </div>
          </div>
        ))}
        <p className="box-link"><a href={`/p/${slug}/setup`}>Setup guide</a></p>
      </section>
      <section className="sec">
        <h2 className="lbl">Your workers</h2>
        {workers.length === 0 && <p className="empty">No worker credentials yet.</p>}
        {workers.map((w) => (
          <div key={w.id} className="kc">
            <div className="t">{w.name}</div>
            <div className="m">{w.lastSeenAt ? `Last check-in ${when(w.lastSeenAt)}` : 'Never checked in'}</div>
            <div className="acts">
              <form action={revokeWorkerAction}>
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="id" value={w.id} />
                <button>Revoke</button>
              </form>
            </div>
          </div>
        ))}
        <div className="kc"><WorkerCredentialForm slug={slug} origin={o} /></div>
      </section>
      <section className="sec">
        <h2 className="lbl">Sign out</h2>
        <form action={signOut}><button>Sign out</button></form>
      </section>
      <section className="sec danger-zone">
        <h2 className="lbl">Danger zone</h2>
        <div className="kc">
          <p>Deleting your account removes you from every project, cancels your open requests and disconnects your agents and workers. Your past work stays, shown as Deleted user. This can&apos;t be undone.</p>
          <DeleteAccountForm />
        </div>
      </section>
    </>
  );
}
