import { describe, expect, it } from 'vitest';
import { nextStatus } from '../src/rules';
import type { Actor, TaskStatus } from '../src/types';

const J = 'requester';
const K = 'assignee';
const S = 'scott'; // a third user: neither requester nor assignee
const human = (userId: string): Actor => ({ userId, type: 'human' });
const agent = (userId: string): Actor => ({ userId, type: 'agent' });

const task = (status: TaskStatus) => ({ status, requesterId: J, assigneeId: K });

describe('nextStatus', () => {
  it.each([
    ['approve', human(K), 'pending_approval', 'approved'],
    ['approve', agent(K), 'pending_approval', 'forbidden'],
    ['approve', human(J), 'pending_approval', 'forbidden'],
    ['approve', human(S), 'pending_approval', 'forbidden'],
    ['approve', human(K), 'approved', 'invalid_transition'],
    ['approve', human(K), 'declined', 'invalid_transition'],
    ['unapprove', human(K), 'approved', 'pending_approval'],
    ['unapprove', agent(K), 'approved', 'forbidden'],
    ['unapprove', human(J), 'approved', 'forbidden'],
    ['unapprove', human(K), 'pending_approval', 'invalid_transition'],
    ['decline', human(K), 'pending_approval', 'declined'],
    ['decline', agent(K), 'pending_approval', 'forbidden'],
    ['decline', human(J), 'pending_approval', 'forbidden'],
    ['defer', human(K), 'pending_approval', 'pending_approval'],
    ['defer', agent(K), 'pending_approval', 'forbidden'],
    ['defer', human(K), 'approved', 'invalid_transition'],
    ['start', agent(K), 'approved', 'in_progress'],
    ['start', agent(J), 'approved', 'forbidden'],
    ['start', agent(K), 'pending_approval', 'invalid_transition'],
    ['complete', agent(K), 'in_progress', 'done'],
    ['complete', agent(J), 'in_progress', 'forbidden'],
    ['complete', agent(K), 'approved', 'invalid_transition'],
    ['complete', agent(K), 'done', 'invalid_transition'],
    ['cancel', agent(J), 'pending_approval', 'cancelled'],
    ['cancel', agent(J), 'approved', 'cancelled'],
    ['cancel', agent(J), 'in_progress', 'cancelled'],
    ['cancel', agent(K), 'pending_approval', 'forbidden'],
    ['cancel', agent(J), 'done', 'invalid_transition'],
    ['cancel', agent(J), 'declined', 'invalid_transition'],
    ['cancel', agent(J), 'cancelled', 'invalid_transition'],
    ['estimate', agent(K), 'pending_approval', 'pending_approval'],
    ['estimate', agent(K), 'approved', 'approved'],
    ['estimate', agent(J), 'pending_approval', 'forbidden'],
    ['estimate', agent(K), 'in_progress', 'invalid_transition'],
    ['claim', agent(K), 'approved', 'in_progress'],
    ['claim', human(K), 'approved', 'in_progress'],
    ['claim', agent(J), 'approved', 'forbidden'],
    ['claim', agent(K), 'in_progress', 'invalid_transition'],
    ['ask', agent(K), 'in_progress', 'needs_input'],
    ['ask', agent(J), 'in_progress', 'forbidden'],
    ['ask', agent(K), 'approved', 'invalid_transition'],
    ['answer', agent(K), 'needs_input', 'approved'],
    ['answer', agent(J), 'needs_input', 'forbidden'],
    ['answer', agent(K), 'in_progress', 'invalid_transition'],
    ['stuck', agent(K), 'approved', 'stuck'],
    ['stuck', agent(K), 'in_progress', 'stuck'],
    ['stuck', agent(K), 'ready_for_review', 'stuck'],
    ['stuck', agent(J), 'in_progress', 'forbidden'],
    ['stuck', agent(K), 'needs_input', 'invalid_transition'],
    ['retry', agent(K), 'stuck', 'approved'],
    ['retry', agent(J), 'stuck', 'forbidden'],
    ['retry', agent(K), 'in_progress', 'invalid_transition'],
    ['finish', agent(K), 'in_progress', 'ready_for_review'],
    ['finish', agent(J), 'in_progress', 'forbidden'],
    ['finish', agent(K), 'approved', 'invalid_transition'],
    ['pr_open', agent(K), 'ready_for_review', 'in_review'],
    ['pr_open', agent(J), 'ready_for_review', 'forbidden'],
    ['pr_open', agent(K), 'in_progress', 'invalid_transition'],
    ['pr_closed', agent(K), 'in_review', 'ready_for_review'],
    ['pr_closed', agent(J), 'in_review', 'forbidden'],
    ['pr_closed', agent(K), 'ready_for_review', 'invalid_transition'],
    ['merge', agent(K), 'ready_for_review', 'done'],
    ['merge', agent(K), 'in_review', 'done'],
    ['merge', agent(J), 'ready_for_review', 'forbidden'],
    ['merge', agent(K), 'in_progress', 'invalid_transition'],
    ['complete', agent(K), 'ready_for_review', 'invalid_transition'],
    ['cancel', agent(J), 'needs_input', 'cancelled'],
    ['cancel', agent(J), 'stuck', 'cancelled'],
    ['cancel', agent(J), 'ready_for_review', 'cancelled'],
    ['cancel', agent(J), 'in_review', 'cancelled'],
    ['approve', agent(K), 'approved', 'forbidden'],
    ['unapprove', human(S), 'approved', 'forbidden'],
    ['decline', human(S), 'pending_approval', 'forbidden'],
    ['defer', human(S), 'pending_approval', 'forbidden'],
    ['start', agent(S), 'approved', 'forbidden'],
    ['complete', agent(S), 'in_progress', 'forbidden'],
    ['cancel', agent(S), 'pending_approval', 'forbidden'],
    ['estimate', agent(S), 'pending_approval', 'forbidden'],
    ['claim', agent(S), 'approved', 'forbidden'],
    ['ask', agent(S), 'in_progress', 'forbidden'],
    ['answer', agent(S), 'needs_input', 'forbidden'],
    ['stuck', agent(S), 'in_progress', 'forbidden'],
    ['retry', agent(S), 'stuck', 'forbidden'],
    ['finish', agent(S), 'in_progress', 'forbidden'],
    ['pr_open', agent(S), 'ready_for_review', 'forbidden'],
    ['pr_closed', agent(S), 'in_review', 'forbidden'],
    ['merge', agent(S), 'in_review', 'forbidden'],
  ] as const)('%s by %j from %s -> %s', (action, actor, from, expected) => {
    if (expected === 'forbidden' || expected === 'invalid_transition') {
      expect(() => nextStatus(task(from), actor, action)).toThrow(expect.objectContaining({ code: expected }));
    } else {
      expect(nextStatus(task(from), actor, action)).toBe(expected);
    }
  });
});
