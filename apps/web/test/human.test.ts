import { afterEach, describe, expect, it, vi } from 'vitest';
import { devLoginEnabled, providerLogin } from '../lib/human';

describe('providerLogin', () => {
  it('accepts a GitHub (oauth) login', () => {
    expect(providerLogin([{ method: 'oauth' }], false)).toBe(true);
    expect(providerLogin([{ method: 'totp' }, { method: 'oauth' }], false)).toBe(true);
  });

  it('refuses a password session, even with a second factor, unless dev login allows password', () => {
    expect(providerLogin([{ method: 'password' }], false)).toBe(false);
    expect(providerLogin([{ method: 'totp' }, { method: 'password' }], false)).toBe(false);
    expect(providerLogin([{ method: 'totp' }, { method: 'password' }], true)).toBe(true);
  });

  it("refuses an agent's OAuth-server token and missing or garbage amr", () => {
    expect(providerLogin([{ method: 'oauth_provider/authorization_code' }], true)).toBe(false);
    for (const amr of [undefined, null, 'oauth', ['oauth'], [null], {}, [{ method: 1 }]]) expect(providerLogin(amr, true), JSON.stringify(amr)).toBe(false);
  });
});

describe('devLoginEnabled', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('is on only when asked for and not on Vercel', () => {
    vi.stubEnv('JUNCTION_DEV_LOGIN', '1');
    vi.stubEnv('VERCEL', '');
    expect(devLoginEnabled()).toBe(true);
    vi.stubEnv('JUNCTION_DEV_LOGIN', '');
    expect(devLoginEnabled()).toBe(false);
    vi.stubEnv('JUNCTION_DEV_LOGIN', '1');
    vi.stubEnv('VERCEL', '1');
    expect(devLoginEnabled()).toBe(false);
  });
});
