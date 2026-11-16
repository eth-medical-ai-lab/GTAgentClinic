/**
 * Black-box tests for scripts/check-secrets.mjs. Every fake credential is assembled at run time
 * and written to a temp dir, so no key-shaped literal ever exists in the repo. Fixture lines that
 * contain credential keywords are written with a "~" that t() removes, so that neither this
 * scanner nor gitleaks flags the test source itself.
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../scripts/check-secrets.mjs', import.meta.url));
const tmp = mkdtempSync(path.join(tmpdir(), 'check-secrets-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const rand = (n: number, alphabet = ALNUM) => [...randomBytes(n)].map((b) => alphabet[b % alphabet.length]).join('');
const t = (s: string) => s.replaceAll('~', '');
const fake = {
  anthropic: ['sk', 'ant', 'api03', rand(93) + 'AA'].join('-'),
  github: ['ghp', rand(36)].join('_'),
  aws: ['AK', 'IA', rand(16, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567')].join(''),
  pem: ['-----BEGIN', 'OPENSSH PRIVATE KEY-----'].join(' '),
  generic: rand(12) + '7' + rand(11),
};

function run(args: string[], cwd = tmp) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' });
  return { code: r.status, out: r.stdout + r.stderr };
}

function file(rel: string, content: string) {
  const p = path.join(tmp, rel);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, content);
  return p;
}

const hasGit = spawnSync('git', ['--version']).status === 0;

describe('check-secrets', () => {
  it('flags key-shaped secrets, private keys, hard-coded credentials and .env files, without printing them', () => {
    const p = file('leaky/config.ts', [`const anthropic = "${fake.anthropic}";`, `export const gh = '${fake.github}';`, `const id = "${fake.aws}";`, fake.pem, t(`const settings = { api~Key: "${fake.generic}" };`)].join('\n'));
    file('leaky/.env', t(`ANTHROPIC_API_~KEY=${fake.anthropic}\n`));
    const r = run([path.dirname(p)]);
    expect(r.code).toBe(1);
    for (const id of ['anthropic-key', 'github-token', 'aws-access-key-id', 'private-key', 'generic-secret', 'sensitive-file']) expect(r.out).toContain(`[${id}]`);
    expect(r.out).toContain('config.ts:1:20');
    for (const v of [fake.anthropic, fake.github, fake.aws, fake.generic]) expect(r.out).not.toContain(v.slice(0, 12));
  });

  it('reports each secret once, even when a generic rule matches it too', () => {
    const r = run([file('once/.env.local', t(`ANTHROPIC_API_~KEY=${fake.anthropic}\n`))]);
    expect(r.out.match(/\[anthropic-key\]/g)).toHaveLength(1);
    expect(r.out).not.toContain('[generic-secret]');
  });

  it('ignores placeholders, env lookups and ordinary code', () => {
    const p = file(
      'clean/app.ts',
      [
        '# ANTHROPIC_API_KEY=sk-ant-...',
        t('const api~Key = process.env.ANTHROPIC_API_KEY;'),
        t('const req = { max_tokens: 1024, tok~en: "${TOKEN}" };'),
        ['const docs = "AKIA', 'IOSFODNN7EXAMPLE";'].join(''),
        t('pass~word: "changeme-please-0000"'),
        'const tokens = text.split(/\\s+/);',
        t('secret~Path: "/etc/agentclinic/secret1.txt"'),
      ].join('\n'),
    );
    file('clean/.env.example', t('ANTHROPIC_API_~KEY=\n'));
    expect(run([path.dirname(p)])).toMatchObject({ code: 0 });
  });

  it('honours the inline marker and the allowlist file (fingerprints and paths)', () => {
    expect(run([file('allow/marked.ts', `const fixture = "${fake.github}"; // check-secrets:allow (test fixture)\n`)]).code).toBe(0);
    const p = file('allow/listed.ts', `const fixture = "${fake.github}";\n`);
    const first = run([p]);
    expect(first.code).toBe(1);
    const fp = /fp:([0-9a-f]{16})/.exec(first.out)?.[1];
    expect(fp).toBeTruthy();
    expect(run([p, '--allowlist', file('allow/by-fp.txt', `# known fixture\nfp:${fp}\n`)]).code).toBe(0);
    expect(run([p, '--allowlist', file('allow/by-path.txt', 'path:**/listed.ts\n')]).code).toBe(0);
    expect(run([p, '--allowlist', file('allow/by-rule.txt', 'rule:github-token:**/allow/*\n')]).code).toBe(0);
  });

  it('--dist scans a bundle directory, where inline markers do not count', () => {
    file('dist/assets/index.js', `const a="x";const k="${fake.anthropic}"; // check-secrets:allow\n`);
    const r = run([`--dist=${path.join(tmp, 'dist')}`]);
    expect(r.code).toBe(1);
    expect(r.out).toContain('[anthropic-key]');
    expect(run([`--dist=${path.join(tmp, 'no-such-dir')}`]).code).toBe(2);
  });

  it('flags secrets headed for the browser bundle by name', () => {
    const r = run([file('client/env.ts', [t('const k = import.meta.env.VITE_ANTHROPIC_API_~KEY;'), t('new Anthropic({ dangerouslyAllowBrowser: ~true });')].join('\n'))]);
    expect(r.code).toBe(1);
    expect(r.out).toContain('[vite-secret-var]');
    expect(r.out).toContain('[browser-api-key]');
  });

  it.skipIf(!hasGit)('--staged scans the index (also before the first commit); the default mode honours .gitignore', () => {
    const repo = mkdtempSync(path.join(tmp, 'repo-'));
    const git = (...a: string[]) => spawnSync('git', a, { cwd: repo, encoding: 'utf8' });
    expect(git('init', '-q').status).toBe(0);
    writeFileSync(path.join(repo, 'leak.ts'), `export const k = "${fake.anthropic}";\n`);
    writeFileSync(path.join(repo, 'clean.ts'), 'export const x = 1;\n');
    git('add', 'clean.ts');
    expect(run(['--staged'], repo).code).toBe(0); // the key exists only in the working tree
    git('add', 'leak.ts');
    const r = run(['--staged'], repo);
    expect(r.code).toBe(1);
    expect(r.out).toContain('leak.ts:1:');
    // the staged blob is what gets committed: fixing the file without re-adding it still blocks
    writeFileSync(path.join(repo, 'leak.ts'), 'export const k = process.env.KEY;\n');
    expect(run(['--staged'], repo).code).toBe(1);
    git('add', 'leak.ts');
    expect(run(['--staged'], repo).code).toBe(0);

    writeFileSync(path.join(repo, '.gitignore'), 'ignored.ts\n');
    writeFileSync(path.join(repo, 'ignored.ts'), `export const k = "${fake.github}";\n`);
    expect(run([], repo).code).toBe(0);
    writeFileSync(path.join(repo, 'untracked.ts'), `export const k = "${fake.github}";\n`);
    expect(run([], repo)).toMatchObject({ code: 1 });
  });
});
