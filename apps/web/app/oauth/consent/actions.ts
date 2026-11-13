'use server';
import { redirect } from 'next/navigation';
import { supabaseServer } from '../../../lib/supabase';
import { requireHuman } from '../../../lib/human';

async function decide(formData: FormData, approve: boolean) {
  const id = String(formData.get('authorization_id'));
  await requireHuman('/oauth/consent?authorization_id=' + encodeURIComponent(id));
  const { auth } = await supabaseServer();
  const { data, error } = approve
    ? await auth.oauth.approveAuthorization(id, { skipBrowserRedirect: true })
    : await auth.oauth.denyAuthorization(id, { skipBrowserRedirect: true });
  redirect(error ? '/oauth/consent?authorization_id=' + encodeURIComponent(id) : data.redirect_url);
}

export async function approve(formData: FormData) {
  await decide(formData, true);
}

export async function deny(formData: FormData) {
  await decide(formData, false);
}
