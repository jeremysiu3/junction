-- M4 dashboard redesign

alter table tasks add column changes text[];

alter table task_events drop constraint task_events_event_check;
alter table task_events add constraint task_events_event_check check (event in (
  'created', 'approved', 'declined', 'deferred', 'started', 'completed', 'cancelled', 'estimated',
  'claimed', 'asked', 'answered', 'stuck', 'retried', 'finished', 'pr_opened', 'pr_closed', 'merged',
  'unapproved'));

alter table notifications drop constraint notifications_kind_check;
alter table notifications add constraint notifications_kind_check check (kind in (
  'new_request', 'approved', 'declined', 'unblocked', 'cancelled', 'needs_input', 'stuck', 'ready_for_review', 'preview',
  'approval_undone'));

create unique index tasks_junction_branch_idx on tasks (project_id, repo, branch) where branch like 'junction/%';

alter table task_questions add constraint task_questions_answer_not_blank check (answer is null or btrim(answer) <> '');
