import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendEmail } from '../lib/email';

const fetchMock = vi.fn();
beforeEach(() => { vi.stubGlobal('fetch', fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); fetchMock.mockReset(); });

describe('sendEmail with RESEND_API_KEY', () => {
  beforeEach(() => { vi.stubEnv('RESEND_API_KEY', 're_test'); });

  it('posts to Resend with a Bearer key and returns true on 200', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    expect(await sendEmail('a@example.com', 'Hi', 'body')).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.headers.authorization).toBe('Bearer re_test');
    expect(JSON.parse(init.body)).toEqual({ from: 'Junction <invites@junctionmcp.com>', to: ['a@example.com'], subject: 'Hi', text: 'body' });
  });

  it('returns false on 500 and on a thrown fetch, logging only the status or "network error"', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockResolvedValue(new Response('{"message":"a@example.com re_test"}', { status: 500 }));
    expect(await sendEmail('a@example.com', 'Hi', 'secret body')).toBe(false);
    fetchMock.mockRejectedValue(new Error('boom re_test a@example.com'));
    expect(await sendEmail('a@example.com', 'Hi', 'secret body')).toBe(false);
    expect(log.mock.calls).toEqual([['Resend email failed: HTTP 500'], ['Resend email failed: network error']]);
    log.mockRestore();
  });
});

describe('sendEmail without RESEND_API_KEY', () => {
  it('uses Mailpit', async () => {
    vi.stubEnv('RESEND_API_KEY', '');
    vi.stubEnv('JUNCTION_MAIL_API', undefined);
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    expect(await sendEmail('a@example.com', 'Hi', 'body')).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:54324/api/v1/send');
  });
});
