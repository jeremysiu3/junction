'use client';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';

const hhmm = (t: number) => new Date(t).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });

// Refreshes the server components every 5s while the tab is visible. An unreachable server shows "Reconnecting…".
// Only the Live / Reconnecting state is announced; the ticking "updated Ns ago" is aria-hidden.
export function Live({ label = true }: { label?: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [updated, setUpdated] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [failed, setFailed] = useState(false);
  const probing = useRef(false);
  const pending = useRef(false);
  pending.current = isPending;

  const refresh = useCallback(async () => {
    if (probing.current || pending.current) return; // one refresh in flight at a time
    probing.current = true;
    startTransition(() => router.refresh());
    try {
      // router.refresh() never reports errors, so check the server separately (cheap, no DB).
      const r = await fetch('/api/health', { cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(4000) });
      if (!r.ok) throw new Error(String(r.status)); // also catches opaqueredirect (status 0)
      setUpdated(Date.now());
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      probing.current = false;
    }
  }, [router]);

  useEffect(() => {
    setUpdated(Date.now());
    setNow(Date.now());
    const visible = () => document.visibilityState === 'visible';
    const poll = setInterval(() => visible() && void refresh(), 5000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const onVisible = () => visible() && void refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  if (!label) return null;
  return (
    <span className={`live${failed ? ' down' : ''}`}>
      <span role="status" aria-atomic="true">{failed && updated !== null ? `Reconnecting… last updated ${hhmm(updated)}` : 'Live'}</span>
      {!failed && updated !== null && <span aria-hidden="true">&nbsp;· updated {Math.max(0, Math.round((now - updated) / 1000))}s ago</span>}
    </span>
  );
}
