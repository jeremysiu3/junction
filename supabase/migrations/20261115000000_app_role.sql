-- M6 least-privilege app role. apps/web connects as junction_app instead of postgres. NOLOGIN here: give it LOGIN and a
-- password out of band (alter role junction_app with login password '...'), never in a migration.
do $$ begin
  if not exists (select from pg_roles where rolname = 'junction_app') then
    create role junction_app nologin;
  end if;
end $$;

grant usage on schema public to junction_app;
-- pg_trgm similarity() for duplicate detection
grant usage on schema extensions to junction_app;
grant select, insert, update, delete on all tables in schema public to junction_app;
grant usage, select on all sequences in schema public to junction_app;
grant execute on function public.junction_tags_text(text[]) to junction_app;

alter default privileges in schema public grant select, insert, update, delete on tables to junction_app;
alter default privileges in schema public grant usage, select on sequences to junction_app;

-- RLS stays on with no policies for anon and authenticated. junction_app is not bypassrls, so it gets an allow-all
-- policy of its own on each table. A new table needs the same two lines (schema.test.ts fails if one is missing).
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('create policy junction_app_all on public.%I for all to junction_app using (true) with check (true)', t);
  end loop;
end $$;

-- Hourly and daily limit counts
create index tasks_requester_created_idx on tasks (requester_id, created_at);
create index context_entries_author_created_idx on context_entries (author_id, created_at);
create index work_updates_author_created_idx on work_updates (author_id, created_at);
create index invites_inviter_created_idx on invites (invited_by, created_at);
