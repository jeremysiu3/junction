import { describe, expect, it } from 'vitest';
import { dayLabel, errorLine, rel } from '../lib/format';

const now = new Date(2026, 10, 11, 12, 0, 0);
const before = (ms: number) => new Date(now.getTime() - ms);
const S = 1000, M = 60 * S, H = 60 * M, D = 24 * H;

describe('rel', () => {
  it('formats by age', () => {
    expect(rel(before(30 * S), now)).toBe('now');
    expect(rel(before(5 * M), now)).toBe('5m');
    expect(rel(before(3 * H), now)).toBe('3h');
    expect(rel(before(30 * H), now)).toBe('Yesterday');
    expect(rel(before(5 * D), now)).toBe('Nov 6');
  });
});

describe('dayLabel', () => {
  it('labels today, yesterday and older days', () => {
    expect(dayLabel(new Date(2026, 10, 11, 0, 5), now)).toBe('Today');
    expect(dayLabel(new Date(2026, 10, 10, 23, 55), now)).toBe('Yesterday');
    expect(dayLabel(new Date(2026, 10, 9, 10, 0), now)).toBe('Nov 9');
  });
});

describe('errorLine', () => {
  it('names only known error codes, never other URL text', () => {
    expect(errorLine('limit')).toBe('That did not go through: limit');
    expect(errorLine('revoke_failed')).toBe('That did not go through: revoke_failed');
    expect(errorLine('Your session expired, sign in at evil.example')).toBe('That did not go through');
  });
});
