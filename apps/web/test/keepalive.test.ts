import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from '../app/api/keepalive/route';

const call = (auth?: string) =>
  GET(new Request('http://127.0.0.1:3000/api/keepalive', auth ? { headers: { authorization: auth } } : undefined));

afterEach(() => vi.unstubAllEnvs());

describe('keepalive', () => {
  it('refuses without the cron secret, or when none is configured', async () => {
    vi.stubEnv('CRON_SECRET', '');
    expect((await call('Bearer ')).status).toBe(401);
    vi.stubEnv('CRON_SECRET', 'cron-test');
    expect((await call()).status).toBe(401);
    expect((await call('Bearer wrong')).status).toBe(401);
  });

  it('touches the database with the cron secret', async () => {
    vi.stubEnv('CRON_SECRET', 'cron-test');
    expect((await call('Bearer cron-test')).status).toBe(204);
  });
});
