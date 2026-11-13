import postgres from 'postgres';

// JUNCTION_TEST_DB_URL lets the suite run as the junction_app role (see README); unset, it's the local postgres role.
export const POSTGRES_LOCAL_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
export const LOCAL_DB_URL = process.env.JUNCTION_TEST_DB_URL ?? POSTGRES_LOCAL_DB_URL;

export type Db = postgres.Sql;

// prepare: false for Supavisor transaction mode; harmless locally. Anything but a local host gets TLS (postgres.js
// only enables it from sslmode in the URL, and the pooler URL has none) and a small pool, since frozen serverless
// instances hold pooler slots.
export function dbOptions(url: string): postgres.Options<{}> {
  const base = { transform: postgres.camel, prepare: false };
  const host = new URL(url).hostname;
  return host === '127.0.0.1' || host === 'localhost' ? base : { ...base, ssl: 'require', max: 5, idle_timeout: 20 };
}

export function createDb(url: string = LOCAL_DB_URL): Db {
  return postgres(url, dbOptions(url));
}
