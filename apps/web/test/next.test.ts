import { describe, expect, it } from 'vitest';
import { loopbackRedirect, safeNext } from '../lib/next';

describe('safeNext', () => {
  it('keeps same-site paths', () => {
    expect(safeNext('/p/demo')).toBe('/p/demo');
    expect(safeNext('/join/ji_x?y=1')).toBe('/join/ji_x?y=1');
  });
  it('falls back to / for anything else', () => {
    expect(safeNext('//evil.com')).toBe('/');
    expect(safeNext('/\\evil.com')).toBe('/');
    expect(safeNext('https://evil.com')).toBe('/');
    expect(safeNext(undefined)).toBe('/');
    expect(safeNext('/a\nb')).toBe('/');
  });
});

describe('loopbackRedirect', () => {
  it('is true only for this computer', () => {
    for (const u of ['http://localhost:3333/cb', 'http://127.0.0.1:9999/cb', 'http://[::1]:8080/cb']) expect(loopbackRedirect(u), u).toBe(true);
    for (const u of ['https://attacker.example/cb', 'http://localhost.attacker.example/cb', 'cursor://anysphere/cb', 'not a url']) expect(loopbackRedirect(u), u).toBe(false);
  });
});
