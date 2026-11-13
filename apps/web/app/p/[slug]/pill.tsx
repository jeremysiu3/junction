import type { TaskStatus, WorkStatus } from '@junction/core';

type Look = { label: string; short?: string; tone: 'run' | 'ask' | 'stuck' | 'ok' | 'wait'; glyph?: string };

const LOOK: Record<TaskStatus | WorkStatus, Look> = {
  pending_approval: { label: 'Waiting for approval', tone: 'wait' },
  approved: { label: 'Queued', tone: 'wait', glyph: '○' },
  in_progress: { label: 'In progress', tone: 'run' },
  needs_input: { label: 'Needs your answer', short: 'Question', tone: 'ask', glyph: '?' },
  stuck: { label: 'Stuck', tone: 'stuck', glyph: '!' },
  ready_for_review: { label: 'Ready for review', short: 'Ready', tone: 'ok', glyph: '✓' },
  in_review: { label: 'In review', tone: 'ok', glyph: '✓' },
  done: { label: 'Done', tone: 'ok', glyph: '✓' },
  merged: { label: 'Merged', tone: 'ok', glyph: '✓' },
  declined: { label: 'Declined', tone: 'wait' },
  cancelled: { label: 'Cancelled', tone: 'wait' },
  abandoned: { label: 'Abandoned', tone: 'wait' },
};

export function Pill({ status, background, prNumber, short }: { status: TaskStatus | WorkStatus; background?: boolean; prNumber?: number | null; short?: boolean }) {
  const look = LOOK[status];
  const working = status === 'in_progress' && background;
  const text = working ? 'Working' : status === 'in_review' && prNumber ? `PR #${prNumber}` : short && look.short ? look.short : look.label;
  return (
    <span className={`pill p-${working ? 'run' : look.tone}`}>
      {working ? <span className="spin" aria-hidden="true" /> : look.glyph && <span aria-hidden="true">{look.glyph}</span>}
      {text}
    </span>
  );
}
