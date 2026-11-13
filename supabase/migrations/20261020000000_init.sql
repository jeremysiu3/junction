create function junction_tags_text(text[]) returns text
  language sql immutable as $$ select array_to_string($1, ' ') $$;

create table users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  auth_user_id uuid unique references auth.users(id) on delete set null,
  api_key_hash text not null unique,
  slack_user_id text,
  created_at timestamptz not null default now()
);

create table projects (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  created_at timestamptz not null default now()
);

create table memberships (
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null default 'member' check (role in ('admin', 'member')),
  last_checked_at timestamptz,
  primary key (project_id, user_id)
);

create table contacts (
  project_id uuid not null references projects(id) on delete cascade,
  sender_id uuid not null references users(id) on delete cascade,
  receiver_id uuid not null references users(id) on delete cascade,
  allowed boolean not null default true,
  primary key (project_id, sender_id, receiver_id)
);

create table tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  requester_id uuid not null references users(id),
  assignee_id uuid not null references users(id),
  title text not null,
  description text not null default '',
  blocking_reason text,
  status text not null default 'pending_approval'
    check (status in ('pending_approval', 'approved', 'in_progress', 'done', 'declined', 'cancelled')),
  estimate_text text,
  evidence_url text,
  evidence_note text,
  deferred_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tasks_assignee_status_idx on tasks (assignee_id, status);

create table context_entries (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  author_id uuid not null references users(id),
  kind text not null check (kind in ('note', 'ownership', 'decision', 'update')),
  title text not null,
  body text not null default '',
  tags text[] not null default '{}',
  visibility text not null default 'project' check (visibility in ('project', 'private')),
  related_task_id uuid references tasks(id) on delete set null,
  created_at timestamptz not null default now(),
  search_vector tsvector generated always as (
    to_tsvector('english', title || ' ' || body || ' ' || junction_tags_text(tags))
  ) stored
);
create index context_entries_search_idx on context_entries using gin (search_vector);

create table task_events (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  actor_id uuid not null references users(id),
  actor_type text not null check (actor_type in ('agent', 'human')),
  event text not null check (event in
    ('created', 'approved', 'declined', 'deferred', 'started', 'completed', 'cancelled', 'estimated')),
  note text,
  created_at timestamptz not null default now()
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  task_id uuid not null references tasks(id) on delete cascade,
  kind text not null check (kind in ('new_request', 'approved', 'declined', 'unblocked', 'cancelled')),
  read boolean not null default false,
  created_at timestamptz not null default now()
);

alter table users enable row level security;
alter table projects enable row level security;
alter table memberships enable row level security;
alter table contacts enable row level security;
alter table tasks enable row level security;
alter table context_entries enable row level security;
alter table task_events enable row level security;
alter table notifications enable row level security;
