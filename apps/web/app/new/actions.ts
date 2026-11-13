'use server';
import { createProject, JunctionError } from '@junction/core';
import { redirect } from 'next/navigation';
import { db } from '../../lib/db';
import { requireHuman } from '../../lib/human';

// The error goes back in the action state, never the URL, so no page renders text it was linked with.
export async function createProjectAction(_prev: { error: string } | null, formData: FormData): Promise<{ error: string }> {
  const actor = await requireHuman();
  let slug: string;
  try {
    ({ slug } = await createProject(db, actor, { name: String(formData.get('name') ?? '') }));
  } catch (e) {
    if (e instanceof JunctionError) return { error: e.message };
    throw e;
  }
  redirect(`/p/${slug}/setup`);
}
