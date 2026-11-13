'use client';
import { useEffect } from 'react';
import { markSeen } from './actions';

export function MarkSeen({ slug }: { slug: string }) {
  useEffect(() => {
    void markSeen(slug);
  }, [slug]);
  return null;
}
