import { describe, expect, it } from 'vitest';
import { LOCAL_DB_URL, dbOptions } from '../src';

describe('dbOptions', () => {
  it.each([LOCAL_DB_URL, 'postgresql://u:p@localhost:5432/db'])('keeps local connections plain with default pool: %s', url => {
    const o = dbOptions(url);
    expect(o.ssl).toBeUndefined();
    expect(o.max).toBeUndefined();
    expect(o.idle_timeout).toBeUndefined();
    expect(o.prepare).toBe(false);
  });

  it('requires TLS and a small pool for any other host', () => {
    const o = dbOptions('postgresql://postgres.abc:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres');
    expect(o).toMatchObject({ ssl: 'require', max: 5, idle_timeout: 20, prepare: false });
  });

  it('does not treat a lookalike host as local', () => {
    expect(dbOptions('postgresql://u:p@localhost.evil.com/db').ssl).toBe('require');
    expect(dbOptions('postgresql://u:p@evil.com/127.0.0.1').ssl).toBe('require');
  });
});
