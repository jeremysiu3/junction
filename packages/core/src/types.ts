export type Actor = { userId: string; type: 'agent' | 'human' };

export type TaskStatus =
  | 'pending_approval'
  | 'approved'
  | 'in_progress'
  | 'needs_input'
  | 'stuck'
  | 'ready_for_review'
  | 'in_review'
  | 'done'
  | 'declined'
  | 'cancelled';

export type TaskAction =
  | 'approve' | 'unapprove' | 'decline' | 'defer' | 'start' | 'complete' | 'cancel' | 'estimate'
  | 'claim' | 'ask' | 'answer' | 'stuck' | 'retry' | 'finish' | 'pr_open' | 'pr_closed' | 'merge';

export type Task = {
  id: string;
  projectId: string;
  requesterId: string;
  assigneeId: string;
  title: string;
  description: string;
  blockingReason: string | null;
  changes: string[] | null;
  notDuplicateReason: string | null;
  status: TaskStatus;
  estimateText: string | null;
  evidenceUrl: string | null;
  evidenceNote: string | null;
  deferredAt: Date | null;
  fromWorkItemId: string | null;
  fromItem: string | null;
  repo: string | null;
  branch: string | null;
  background: boolean;
  stuckReason: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ContextKind = 'note' | 'ownership' | 'decision' | 'update';

export type ContextEntry = {
  id: string;
  projectId: string;
  authorId: string;
  kind: ContextKind;
  title: string;
  body: string;
  tags: string[];
  visibility: 'project' | 'private';
  relatedTaskId: string | null;
  createdAt: Date;
};

export class JunctionError extends Error {
  name = 'JunctionError';
  constructor(
    public code: 'unauthorized' | 'forbidden' | 'not_found' | 'invalid_transition' | 'validation' | 'duplicate' | 'limit',
    message: string,
  ) {
    super(message);
  }
}

export type Area = { id: string; projectId: string; name: string; ownerId: string | null; description: string };

export type WorkStatus = 'in_progress' | 'merged' | 'abandoned';

export type DoneItem = { text: string; evidence: string | null; confirmed: boolean };

export type WorkItemView = {
  id: string;
  projectId: string;
  ownerId: string;
  ownerName: string;
  repo: string;
  key: string;
  title: string;
  areaId: string | null;
  areaName: string | null;
  status: WorkStatus;
  done: DoneItem[];
  notDone: string[];
  paths: string[];
  lastActivityAt: Date;
  createdAt: Date;
  stale: boolean;
  daysSinceActivity: number;
};

export type AreaView = Area & {
  ownerName: string | null;
  inProgress: number;
  stale: number;
  notDone: { workItemId: string; key: string; text: string }[];
};

export type Overlap = { workItem: WorkItemView; reason: 'path' | 'area'; paths: string[] };
