'use server';
import {
  answerQuestion, approveTask, cancelInvite, createInvite, declineTask, deferTask, deleteAccount, deleteContext, deleteProject, getTaskDetail, hasLink, JunctionError, listConnections, listMembers, markAbandoned, markDashboardSeen,
  projectForMember, projectsFor, removeMember, renameProject, retryTask, revokeWorkerCredential, saveArea, setRole, setStaleDays, unapproveTask, userProfile, type Actor,
} from '@junction/core';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '../../../lib/db';
import { sendEmail } from '../../../lib/email';
import { requireHuman } from '../../../lib/human';
import { origin } from '../../../lib/origin';
import { supabaseServer } from '../../../lib/supabase';

// redirect() throws, so only the core call sits inside the try.
async function run(formData: FormData, page: 'inbox' | 'work', fn: (actor: Actor, slug: string, id: string) => Promise<unknown>) {
  const slug = String(formData.get('slug'));
  const id = String(formData.get('id'));
  const actor = await requireHuman();
  try {
    await fn(actor, slug, id);
  } catch (e) {
    if (e instanceof JunctionError) redirect(`/p/${slug}/${page === 'work' ? `work/${id}` : page}?error=${e.code}`);
    throw e;
  }
  revalidatePath(`/p/${slug}`, 'layout');
}

// core takes no projectId for approve, unapprove, decline or defer, so check the task belongs to the slug's project first.
const inProject = async (actor: Actor, slug: string, id: string) => getTaskDetail(db, actor, (await projectForMember(db, actor.userId, slug)).id, id);

export const defer = async (formData: FormData) =>
  run(formData, 'inbox', async (actor, slug, id) => {
    await inProject(actor, slug, id);
    return deferTask(db, actor, id);
  });
export const decline = async (formData: FormData) =>
  run(formData, 'inbox', async (actor, slug, id) => {
    await inProject(actor, slug, id);
    return declineTask(db, actor, id, String(formData.get('note') ?? '') || undefined);
  });
export const abandon = async (formData: FormData) =>
  run(formData, 'work', async (actor, slug, id) => markAbandoned(db, actor, (await projectForMember(db, actor.userId, slug)).id, id));

// approve/unapprove return the error (the Inbox toast shows it) instead of redirecting.
async function inboxAction(slug: string, id: string, fn: (actor: Actor) => Promise<unknown>, tooLate?: string): Promise<{ error?: string }> {
  const actor = await requireHuman();
  try {
    await inProject(actor, slug, id);
    await fn(actor);
  } catch (e) {
    if (!(e instanceof JunctionError)) throw e;
    return { error: tooLate && e.code === 'invalid_transition' ? tooLate : e.message };
  }
  revalidatePath(`/p/${slug}`, 'layout');
  return {};
}

export const approveAction = async (slug: string, id: string) => inboxAction(slug, id, (actor) => approveTask(db, actor, id));
export const unapproveAction = async (slug: string, id: string) =>
  inboxAction(slug, id, (actor) => unapproveTask(db, actor, id), 'Too late, the task has already started.');

// Same pattern as run(), but the project is re-derived from the hidden slug.
async function runProject(formData: FormData, page: '' | 'settings' | 'account' | 'memory' | 'memory/entries', fn: (actor: Actor, projectId: string) => Promise<unknown>) {
  const slug = String(formData.get('slug'));
  const actor = await requireHuman();
  try {
    await fn(actor, (await projectForMember(db, actor.userId, slug)).id);
  } catch (e) {
    if (e instanceof JunctionError) redirect(`/p/${slug}/${page}?error=${e.code}`);
    throw e;
  }
  revalidatePath(`/p/${slug}`, 'layout');
}

export const saveAreaAction = async (formData: FormData) =>
  runProject(formData, 'settings', (actor, projectId) =>
    saveArea(db, actor, {
      projectId,
      id: String(formData.get('id') ?? '') || undefined,
      name: String(formData.get('name') ?? ''),
      ownerId: String(formData.get('ownerId') ?? '') || null,
      description: String(formData.get('description') ?? ''),
    }));

export const setStaleDaysAction = async (formData: FormData) =>
  runProject(formData, 'settings', (actor, projectId) => setStaleDays(db, actor, projectId, Number(formData.get('days'))));

export const renameProjectAction = async (formData: FormData) =>
  runProject(formData, 'settings', (actor, projectId) => renameProject(db, actor, projectId, String(formData.get('name') ?? '')));

export const deleteContextAction = async (formData: FormData) =>
  runProject(formData, formData.get('back') === 'entries' ? 'memory/entries' : 'memory', (actor, projectId) =>
    deleteContext(db, actor, projectId, String(formData.get('id'))));

export const cancelInviteAction = async (formData: FormData) =>
  runProject(formData, 'settings', (actor, projectId) => cancelInvite(db, actor, projectId, String(formData.get('id'))));

export const setRoleAction = async (formData: FormData) =>
  runProject(formData, 'settings', (actor, projectId) =>
    setRole(db, actor, projectId, String(formData.get('userId')), formData.get('role') === 'admin' ? 'admin' : 'member'));

export const removeMemberAction = async (formData: FormData) => {
  await runProject(formData, 'settings', (actor, projectId) => removeMember(db, actor, projectId, String(formData.get('userId'))));
  // Removing yourself (core only allows it when another admin remains) leaves the project's pages behind.
  if (formData.get('userId') === (await requireHuman()).userId) redirect('/');
};

export const revokeWorkerAction = async (formData: FormData) =>
  runProject(formData, 'account', (actor) => revokeWorkerCredential(db, actor, String(formData.get('id'))));

// Only the user's own listed connections can be revoked; the grant is revoked with their own session.
export const revokeConnectionAction = async (formData: FormData) => {
  const actor = await requireHuman();
  const slug = String(formData.get('slug'));
  const clientId = String(formData.get('clientId'));
  if ((await listConnections(db, actor)).some((c) => c.clientId === clientId)) {
    const { error } = await (await supabaseServer()).auth.oauth.revokeGrant({ clientId });
    if (error) redirect(`/p/${slug}/account?error=revoke_failed`);
  }
  revalidatePath(`/p/${slug}`, 'layout');
};

// Returns the error for the inline form. The login row is gone afterwards, so signOut may fail: it only clears this browser's cookies.
export async function deleteAccountAction(_prev: { error?: string }, formData: FormData): Promise<{ error?: string }> {
  const actor = await requireHuman();
  if (String(formData.get('email') ?? '').trim().toLowerCase() !== (await userProfile(db, actor.userId)).email.toLowerCase()) return { error: 'Type your email to confirm' };
  try {
    await deleteAccount(db, actor);
  } catch (e) {
    if (e instanceof JunctionError) return { error: e.message };
    throw e;
  }
  await (await supabaseServer()).auth.signOut({ scope: 'local' }).catch(() => {});
  redirect('/login?deleted=1');
}

export async function deleteProjectAction(_prev: { error?: string }, formData: FormData): Promise<{ error?: string }> {
  const actor = await requireHuman();
  const project = await projectForMember(db, actor.userId, String(formData.get('slug')));
  if (String(formData.get('name') ?? '').trim() !== project.name) return { error: 'Type the project name to confirm' };
  try {
    await deleteProject(db, actor, project.id);
  } catch (e) {
    if (e instanceof JunctionError) return { error: e.message };
    throw e;
  }
  redirect('/');
}

// The invite link carries the token, so it goes back only in the action result (never a URL or redirect) and only to this admin.
export type InviteResult = { sent: true; email: string } | { sent: false; email: string; link: string } | { error: string };

export async function inviteAction(_prev: InviteResult | null, formData: FormData): Promise<InviteResult> {
  const slug = String(formData.get('slug'));
  const email = String(formData.get('email') ?? '').trim();
  const actor = await requireHuman();
  try {
    const { id: projectId } = await projectForMember(db, actor.userId, slug);
    const { token, email: to } = await createInvite(db, actor, projectId, email);
    const [project, members, o] = await Promise.all([
      projectsFor(db, actor.userId).then((ps) => ps.find((p) => p.id === projectId)!),
      listMembers(db, actor, projectId),
      origin(),
    ]);
    const link = `${o}/join/${token}`;
    // Display names come from GitHub and could carry a link into the email.
    const name = members.find((m) => m.id === actor.userId)!.name;
    const inviter = !hasLink(name) && name.length <= 60 ? name : 'A teammate';
    const sent = await sendEmail(
      to,
      `Join ${project.name} on Junction`,
      `${inviter} invited you to ${project.name} on Junction.\n\nJoin: ${link}\n\nThe link works once and expires in 7 days.`,
    );
    revalidatePath(`/p/${slug}/settings`);
    return sent ? { sent: true, email: to } : { sent: false, email: to, link };
  } catch (e) {
    if (e instanceof JunctionError) return { error: e.message };
    throw e;
  }
}

export const answerAction = async (formData: FormData) =>
  runProject(formData, '', (actor, projectId) => answerQuestion(db, actor, String(formData.get('id')), String(formData.get('answer') ?? ''), projectId));

export const retryAction = async (formData: FormData) =>
  runProject(formData, '', (actor, projectId) => retryTask(db, actor, String(formData.get('id')), projectId));

// No revalidate or redirect: the visible page keeps its "new" badges until the next real view.
export async function markSeen(slug: string) {
  const actor = await requireHuman();
  await markDashboardSeen(db, actor, (await projectForMember(db, actor.userId, slug)).id);
}
