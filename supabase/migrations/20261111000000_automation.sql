alter table tasks
  add column repo text,
  add column branch text,
  add column background boolean not null default false,
  add column stuck_reason text;

alter table tasks drop constraint tasks_status_check;
alter table tasks add constraint tasks_status_check check (status in (
  'pending_approval', 'approved', 'in_progress', 'needs_input', 'stuck',
  'ready_for_review', 'in_review', 'done', 'declined', 'cancelled'));

alter table task_events drop constraint task_events_event_check;
alter table task_events add constraint task_events_event_check check (event in (
  'created', 'approved', 'declined', 'deferred', 'started', 'completed', 'cancelled', 'estimated',
  'claimed', 'asked', 'answered', 'stuck', 'retried', 'finished', 'pr_opened', 'pr_closed', 'merged'));

alter table notifications drop constraint notifications_kind_check;
alter table notifications add constraint notifications_kind_check check (kind in (
  'new_request', 'approved', 'declined', 'unblocked', 'cancelled', 'needs_input', 'stuck', 'ready_for_review', 'preview'));

create table task_questions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  question text not null,
  answer text,
  answered_by uuid references users(id),
  answered_actor_type text check (answered_actor_type in ('agent', 'human')),
  created_at timestamptz not null default now(),
  answered_at timestamptz
);

alter table task_questions enable row level security;
