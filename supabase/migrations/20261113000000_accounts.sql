-- M5 accounts, OAuth and polish

drop table contacts;
alter table users drop column api_key_hash;

create table worker_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null check (btrim(name) <> '' and length(name) <= 60),
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at timestamptz
);

create table invites (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  email text not null,
  token_hash text not null unique,
  invited_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  accepted_by uuid references users(id),
  cancelled_at timestamptz
);

create table task_requesters (
  task_id uuid references tasks(id) on delete cascade,
  user_id uuid references users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (task_id, user_id)
);

alter table tasks add column not_duplicate_reason text;
alter table memberships add column briefed_at timestamptz;

alter table task_events drop constraint task_events_event_check;
alter table task_events add constraint task_events_event_check check (event in (
  'created', 'approved', 'declined', 'deferred', 'started', 'completed', 'cancelled', 'estimated',
  'claimed', 'asked', 'answered', 'stuck', 'retried', 'finished', 'pr_opened', 'pr_closed', 'merged',
  'unapproved', 'joined', 'left', 'member_removed'));

create extension if not exists pg_trgm with schema extensions;
create index tasks_title_trgm on tasks using gin (title extensions.gin_trgm_ops);

alter table worker_credentials enable row level security;
alter table invites enable row level security;
alter table task_requesters enable row level security;
