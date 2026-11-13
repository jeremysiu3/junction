-- junction_app can't be granted the auth schema (postgres has no grant option there), so core reaches the few auth rows it
-- needs through these functions. They live in their own schema because PostgREST exposes public: a function there would be
-- callable with the anon key. Each runs one query core used to run, as postgres, and is executable by junction_app only.
-- search_path is pg_catalog, pg_temp (not ''): an empty path still searches pg_temp first, where junction_app can plant
-- types and casts, so casts below name pg_catalog.text.
create schema junction_auth;
revoke all on schema junction_auth from public;

create function junction_auth.is_human_session(p_session_id text) returns boolean
  language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  select exists (select 1 from auth.sessions where id::pg_catalog.text = p_session_id and oauth_client_id is null)
$$;

create function junction_auth.agent_session(p_session_id text) returns table (id uuid, name text, client_id uuid)
  language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  select u.id, u.name, s.oauth_client_id
  from auth.sessions s join public.users u on u.auth_user_id = s.user_id
  where s.id::pg_catalog.text = p_session_id and s.oauth_client_id is not null and (s.not_after is null or s.not_after > now())
$$;

create function junction_auth.avatar_url(p_auth_user_id uuid) returns text
  language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  select raw_user_meta_data->>'avatar_url' from auth.users where id = p_auth_user_id
$$;

create function junction_auth.delete_user(p_auth_user_id uuid) returns void
  language sql security definer set search_path = pg_catalog, pg_temp as $$
  delete from auth.users where id = p_auth_user_id
$$;

create function junction_auth.agent_connected(p_user_id uuid) returns boolean
  language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  select exists (select 1 from auth.oauth_consents c join public.users u on u.auth_user_id = c.user_id
                 where u.id = p_user_id and c.revoked_at is null)
$$;

create function junction_auth.list_connections(p_user_id uuid)
  returns table (client_id uuid, name text, granted_at timestamptz, last_used_at timestamptz)
  language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  select c.client_id, cl.client_name, c.granted_at,
    (select max(coalesce(s.refreshed_at, s.updated_at, s.created_at)) from auth.sessions s
     where s.user_id = c.user_id and s.oauth_client_id = c.client_id)
  from auth.oauth_consents c
  join auth.oauth_clients cl on cl.id = c.client_id
  join public.users u on u.auth_user_id = c.user_id
  where u.id = p_user_id and c.revoked_at is null order by c.granted_at
$$;

revoke execute on all functions in schema junction_auth from public, anon, authenticated, service_role;
grant usage on schema junction_auth to junction_app;
grant execute on all functions in schema junction_auth to junction_app;
