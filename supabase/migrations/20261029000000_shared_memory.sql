create table areas (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null,
  owner_id uuid references users(id),
  description text not null default '',
  created_at timestamptz not null default now()
);
create unique index areas_project_name_idx on areas (project_id, lower(name));

create table work_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  owner_id uuid not null references users(id),
  repo text not null,
  key text not null,
  title text not null,
  area_id uuid references areas(id) on delete set null,
  status text not null default 'in_progress'
    check (status in ('in_progress', 'merged', 'abandoned')),
  done jsonb not null default '[]',
  not_done jsonb not null default '[]',
  paths text[] not null default '{}',
  search_text text not null default '',
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (project_id, repo, key, owner_id),
  search_vector tsvector generated always as (
    to_tsvector('english', title || ' ' || key || ' ' || search_text)
  ) stored
);
create index work_items_search_idx on work_items using gin (search_vector);

create table work_updates (
  id uuid primary key default gen_random_uuid(),
  work_item_id uuid not null references work_items(id) on delete cascade,
  author_id uuid not null references users(id),
  summary text not null,
  status text not null,
  done jsonb not null,
  not_done jsonb not null,
  created_at timestamptz not null default now()
);

alter table projects add column stale_after_days int not null default 14
  check (stale_after_days between 1 and 365);
alter table memberships add column dashboard_seen_at timestamptz;

alter table context_entries add column replaces_id uuid references context_entries(id);
create unique index context_entries_replaces_idx on context_entries (replaces_id)
  where replaces_id is not null;

alter table tasks add column from_work_item_id uuid references work_items(id) on delete set null,
  add column from_item text;

alter table areas enable row level security;
alter table work_items enable row level security;
alter table work_updates enable row level security;
