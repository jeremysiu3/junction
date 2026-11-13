'use server';
import { acceptInvite, JunctionError } from '@junction/core';
import { redirect } from 'next/navigation';
import { db } from '../../../lib/db';
import { requireHuman } from '../../../lib/human';

export async function acceptInviteAction(formData: FormData) {
  const token = String(formData.get('token') ?? '');
  const actor = await requireHuman(`/join/${token}`);
  let to: string;
  try {
    const { slug, firstTime } = await acceptInvite(db, actor, token);
    to = firstTime ? `/p/${slug}/setup` : `/p/${slug}`;
  } catch (e) {
    // Used, expired, cancelled or unknown: the join page explains which.
    if (e instanceof JunctionError) to = `/join/${token}`;
    else throw e;
  }
  redirect(to);
}
