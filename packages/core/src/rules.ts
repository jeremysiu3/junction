import { fold } from './untrusted';
import { JunctionError, type Actor, type Task, type TaskAction, type TaskStatus } from './types';

// Stranger-abuse caps, counted in Postgres inside the same transaction as the insert.
export const LIMITS = {
  invitesPerDay: 20, pendingInvitesPerProject: 50, projectsPerUser: 10, tasksPerHour: 100, contextWritesPerHour: 100, workRecordsPerHour: 300,
} as const;

// Project names and inviter names end up in emails, so no urls or bare domains. Any word.letters counts, so dotted
// names like "Next.js" are refused too; versions like v1.2 are fine. Folded first so a full-width dot can't slip by,
// and ideographic full stops count as dots. JS's \b only knows ASCII, so the end of the TLD is a Unicode lookahead
// (evil.рф). Combining marks count as label and TLD letters. A label starts only after a non-label character, so a long dotless run is scanned once, not quadratically.
export function hasLink(s: string): boolean {
  return /:\/\/|www\.|(?<![\p{L}\p{N}\p{M}-])[\p{L}\p{N}\p{M}-]+\.[\p{L}\p{M}]{2,}(?![\p{L}\p{N}\p{M}])/iu.test(fold(s).replace(/[。｡]/g, '.'));
}

// Agent-supplied lists are stored as-is, so cap how many items and how long each string is (maxChars omitted: items are checked elsewhere).
export function capList(field: string, items: readonly unknown[], maxItems: number, maxChars?: number): void {
  if (items.length > maxItems) throw new JunctionError('validation', `${field} must have at most ${maxItems} items`);
  if (maxChars && items.some(i => String(i).length > maxChars)) throw new JunctionError('validation', `${field} items must be at most ${maxChars} characters`);
}

export const OPEN: TaskStatus[] = [
  'pending_approval', 'approved', 'in_progress', 'needs_input', 'stuck', 'ready_for_review', 'in_review',
];

// Assignee-only lifecycle actions (the worker, headless and interactive agents all act as the assignee).
const LIFECYCLE = {
  claim: { from: ['approved'], to: 'in_progress' },
  ask: { from: ['in_progress'], to: 'needs_input' },
  answer: { from: ['needs_input'], to: 'approved' },
  stuck: { from: ['approved', 'in_progress', 'ready_for_review'], to: 'stuck' },
  retry: { from: ['stuck'], to: 'approved' },
  finish: { from: ['in_progress'], to: 'ready_for_review' },
  pr_open: { from: ['ready_for_review'], to: 'in_review' },
  pr_closed: { from: ['in_review'], to: 'ready_for_review' },
  merge: { from: ['ready_for_review', 'in_review'], to: 'done' },
} as const satisfies Record<string, { from: readonly TaskStatus[]; to: TaskStatus }>;

// Pure state machine. Checks in order: actor type, role, state.
export function nextStatus(
  task: Pick<Task, 'status' | 'requesterId' | 'assigneeId'>,
  actor: Actor,
  action: TaskAction,
): TaskStatus {
  const { status } = task;
  const isRequester = actor.userId === task.requesterId;
  const isAssignee = actor.userId === task.assigneeId;

  if (['approve', 'unapprove', 'decline', 'defer'].includes(action) && actor.type !== 'human') {
    throw new JunctionError('forbidden', `${action} is human-only`);
  }

  switch (action) {
    case 'approve':
    case 'decline':
    case 'defer': {
      if (!isAssignee) throw new JunctionError('forbidden', `only the assignee can ${action}`);
      if (status !== 'pending_approval') throw invalid(action, status);
      return action === 'approve' ? 'approved' : action === 'decline' ? 'declined' : 'pending_approval';
    }
    case 'unapprove': {
      if (!isAssignee) throw new JunctionError('forbidden', 'only the assignee can unapprove');
      if (status !== 'approved') throw invalid(action, status);
      return 'pending_approval';
    }
    case 'start': {
      if (!isAssignee) throw new JunctionError('forbidden', 'only the assignee can start');
      if (status !== 'approved') throw invalid(action, status);
      return 'in_progress';
    }
    case 'complete': {
      if (!isAssignee) throw new JunctionError('forbidden', 'only the assignee can complete');
      if (status !== 'in_progress') throw invalid(action, status);
      return 'done';
    }
    case 'cancel': {
      if (!isRequester) throw new JunctionError('forbidden', 'only the requester can cancel');
      if (!OPEN.includes(status)) throw invalid(action, status);
      return 'cancelled';
    }
    case 'estimate': {
      if (!isAssignee) throw new JunctionError('forbidden', 'only the assignee can estimate');
      if (status !== 'pending_approval' && status !== 'approved') throw invalid(action, status);
      return status;
    }
    case 'claim':
    case 'ask':
    case 'answer':
    case 'stuck':
    case 'retry':
    case 'finish':
    case 'pr_open':
    case 'pr_closed':
    case 'merge': {
      if (!isAssignee) throw new JunctionError('forbidden', `only the assignee can ${action}`);
      const rule: { from: readonly TaskStatus[]; to: TaskStatus } = LIFECYCLE[action];
      if (!rule.from.includes(status)) throw invalid(action, status);
      return rule.to;
    }
  }
}

function invalid(action: TaskAction, status: TaskStatus): JunctionError {
  return new JunctionError('invalid_transition', `cannot ${action} a task that is ${status}`);
}
