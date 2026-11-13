import { redirect } from 'next/navigation';
import { requireHuman } from '../../../lib/human';
import { loopbackRedirect } from '../../../lib/next';
import { supabaseServer } from '../../../lib/supabase';
import { approve, deny } from './actions';

const redirectHost = (uri: string) => new URL(uri).host || new URL(uri).protocol; // custom-scheme URIs have no host

export default async function Consent({ searchParams }: { searchParams: Promise<{ authorization_id?: string }> }) {
  const id = (await searchParams).authorization_id ?? '';
  await requireHuman('/oauth/consent?authorization_id=' + encodeURIComponent(id));
  const { data, error } = await (await supabaseServer()).auth.oauth.getAuthorizationDetails(id);
  if (data && 'redirect_url' in data) redirect(data.redirect_url);
  return (
    <main className="auth">
      <div className="card">
        <div className="brand">Junction</div>
        {error || !data ? (
          <p className="error">This authorization request is invalid or has expired.</p>
        ) : (
          <>
            <h1>An app that calls itself {data.client.name} wants to connect to Junction as you</h1>
            <p>This will send you back to <strong>{redirectHost(data.redirect_uri)}</strong></p>
            {!loopbackRedirect(data.redirect_uri) && (
              <p className="error">That address is not on this computer. Only approve if you started this connection and recognise it.</p>
            )}
            <p className="muted">
              It can read and send requests in your projects, record work and read memory. It can never approve, decline or undo anything: only you can, here in the dashboard.
            </p>
            <form>
              <input type="hidden" name="authorization_id" value={data.authorization_id} />
              <button className="primary" formAction={approve}>Approve</button>
              <button formAction={deny}>Deny</button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
