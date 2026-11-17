import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mergeConfig, privateDir, readRepoFile, validToken } from '../src/init.js';
import { validProjects } from '../src/startup.js';

let dir: string;
beforeEach(() => void (dir = mkdtempSync(join(tmpdir(), 'junction-init-test-'))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const add = { apiUrl: 'https://app.junctionmcp.com', token: `jw_${'a'.repeat(43)}`, project: 'live-test', repo: 'site', path: '/code/site' };

describe('readRepoFile', () => {
  it('reads project and repo', () => {
    writeFileSync(join(dir, 'junction.json'), '{"project":"live-test","repo":" site "}');
    expect(readRepoFile(dir)).toEqual({ project: 'live-test', repo: 'site' });
  });

  it('explains a missing or malformed file', () => {
    expect(() => readRepoFile(dir)).toThrow(/No junction.json in/);
    for (const bad of ['{', '{"project":"Live Test","repo":"site"}', '{"project":"live-test"}', '{"project":"live-test","repo":"  "}']) {
      writeFileSync(join(dir, 'junction.json'), bad);
      expect(() => readRepoFile(dir)).toThrow(/junction.json/);
    }
  });
});

describe('mergeConfig', () => {
  it('builds a config the worker accepts from nothing', () => {
    const cfg = mergeConfig({}, add);
    expect(cfg).toEqual({ apiUrl: add.apiUrl, token: add.token, projects: { 'live-test': { site: '/code/site' } } });
    expect(validProjects(cfg.projects)).toBe(true);
  });

  it('keeps other projects and repos, moves a repo that changed folder, drops broken entries', () => {
    const existing = {
      apiUrl: 'http://127.0.0.1:3000', token: 'old', extra: 1,
      projects: { 'live-test': { site: '/old/site', api: '/code/api' }, other: { web: '/code/web' }, 'Bad Slug': { x: '/x' }, broken: 'nope' },
    };
    expect(mergeConfig(existing, add)).toEqual({
      apiUrl: add.apiUrl, token: add.token, extra: 1,
      projects: { 'live-test': { site: '/code/site', api: '/code/api' }, other: { web: '/code/web' } },
    });
  });
});

it('validToken matches the minted shape only', () => {
  expect(validToken(add.token)).toBe(true);
  for (const bad of ['', 'jw_short', `jw_${'a'.repeat(44)}`, `xx_${'a'.repeat(43)}`, undefined]) expect(validToken(bad)).toBe(false);
});

it('privateDir creates a missing folder as 0700 and tightens an existing 0755 one', () => {
  const fresh = join(dir, 'a', '.junction');
  privateDir(fresh);
  expect(statSync(fresh).mode & 0o777).toBe(0o700);
  const old = join(dir, 'old');
  mkdirSync(old, { mode: 0o755 });
  privateDir(old);
  expect(statSync(old).mode & 0o777).toBe(0o700);
});
