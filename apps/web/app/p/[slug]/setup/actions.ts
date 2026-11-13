'use server';
import { createWorkerCredential, JunctionError } from '@junction/core';
import { db } from '../../../../lib/db';
import { requireHuman } from '../../../../lib/human';

// The token goes back only in the action result: never in a URL, redirect or log, and not on later page loads.
export async function createWorkerCredentialAction(_prev: { token?: string; error?: string }, formData: FormData): Promise<{ token?: string; error?: string }> {
  const actor = await requireHuman();
  try {
    return { token: (await createWorkerCredential(db, actor, String(formData.get('name') ?? ''))).token };
  } catch (e) {
    if (e instanceof JunctionError) return { error: e.message };
    throw e;
  }
}
