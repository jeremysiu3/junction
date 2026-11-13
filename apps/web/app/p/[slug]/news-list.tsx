'use client';
import { useState } from 'react';
import type { LogEntry } from '@junction/core';
import { dayLabel, exact, rel } from '../../../lib/format';

const NEW_MAX = 10;
const OLDER_MAX = 3;

// Keeps the first seenAt it is given, so the router.refresh() polls never move the divider or clear the dots.
export function NewsList({ items, seenAt, slug }: { items: LogEntry[]; seenAt: string | null; slug: string }) {
  const [seen] = useState(() => (seenAt ? new Date(seenAt).getTime() : null));
  const isNew = (e: LogEntry) => seen === null || new Date(e.at).getTime() > seen;
  const fresh = items.filter(isNew).slice(0, NEW_MAX);
  const older = seen === null ? [] : items.filter((e) => !isNew(e)).slice(0, OLDER_MAX);

  const href = (e: LogEntry) =>
    e.taskId ? `/p/${slug}/tasks/${e.taskId}` : e.workItemId ? `/p/${slug}/work/${e.workItemId}` : `/p/${slug}/memory`;

  // A day heading whenever the day changes; the divider starts a new run.
  const group = (list: LogEntry[], dot: boolean) => {
    let last = '';
    return list.map((e, i) => {
      const day = dayLabel(new Date(e.at));
      const head = day !== last;
      last = day;
      return (
        <div key={`${dot}-${i}`}>
          {head && <div className="day" suppressHydrationWarning>{day}</div>}
          <a className="item" href={href(e)}>
            <span className={`dot${dot ? '' : ' off'}`} aria-hidden="true" />
            <div className="body">
              <div className="t"><b>{e.actor}</b> {e.text}</div>
              {e.detail && <div className="m">{e.detail}</div>}
            </div>
            <span className="time" title={exact(new Date(e.at))} suppressHydrationWarning>{rel(new Date(e.at))}</span>
          </a>
        </div>
      );
    });
  };

  return (
    <section>
      <h2 className="lbl">New since you looked · {fresh.length}</h2>
      {fresh.length === 0 && <p className="empty">Nothing new. Updates and decisions from your team&apos;s agents show up here.</p>}
      {group(fresh, true)}
      {older.length > 0 && <div className="since">last time you looked</div>}
      {group(older, false)}
      <a className="more box-link" href={`/p/${slug}/memory`}>Everything else is in Memory →</a>
    </section>
  );
}
