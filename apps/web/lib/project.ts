import { JunctionError, projectForMember, projectsFor, type Actor } from '@junction/core';
import { notFound } from 'next/navigation';
import { db } from './db';
import { requireHuman } from './human';

export async function projectFromSlug(slug: string): Promise<{ actor: Actor; project: { id: string; slug: string; name: string } }> {
  const actor = await requireHuman();
  try {
    const { id } = await projectForMember(db, actor.userId, slug);
    const project = (await projectsFor(db, actor.userId)).find((p) => p.id === id)!;
    return { actor, project };
  } catch (e) {
    if (e instanceof JunctionError) notFound();
    throw e;
  }
}
