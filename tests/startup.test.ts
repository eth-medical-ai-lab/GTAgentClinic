/** Real launcher + real npm, using local fixture packages only. No game or model process. */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, expect, it } from 'vitest';

const root = mkdtempSync(path.join(tmpdir(), 'ac-startup-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const put = (name: string, content: string) => {
  const target = path.join(root, name);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
};
const env = { ...process.env, npm_config_offline: 'true', npm_config_cache: path.join(root, 'cache'), npm_config_update_notifier: 'false', npm_config_audit: 'false', npm_config_fund: 'false' };
const manifest = (dependencies: Record<string, string>) => put('package.json', JSON.stringify({ name: 'startup-fixture', version: '1.0.0', private: true, type: 'module', dependencies }));
const launch = () => spawnSync(process.execPath, ['bin/agentclinic.mjs', '--dev', '--no-open', '--port', '7989', '--llm', 'offline', '--tts', 'off'], { cwd: root, env, encoding: 'utf8', timeout: 20_000 });

it('installs on first start, after a branch adds Codex, and on an unchanged restart; stops on installation failure', () => {
  mkdirSync(path.join(root, 'bin'), { recursive: true });
  mkdirSync(path.join(root, 'scripts'), { recursive: true });
  copyFileSync('bin/agentclinic.mjs', path.join(root, 'bin/agentclinic.mjs'));
  copyFileSync('scripts/check-node.mjs', path.join(root, 'scripts/check-node.mjs'));
  put('fixtures/tsx/package.json', JSON.stringify({ name: 'tsx', version: '1.0.0', type: 'module' }));
  put('fixtures/vite/package.json', JSON.stringify({ name: 'vite', version: '1.0.0' }));
  put('fixtures/vite/bin/vite.js', '');
  put('fixtures/tsx/dist/cli.mjs', `
import { appendFileSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const root = process.cwd();
const pkg = JSON.parse(readFileSync(root + '/package.json', 'utf8'));
if (pkg.dependencies['@openai/codex-sdk']) createRequire(root + '/package.json')('@openai/codex-sdk');
appendFileSync(root + '/started', 'started\\n');
`);
  const old = { tsx: 'file:fixtures/tsx', vite: 'file:fixtures/vite' };
  manifest(old);
  let result = launch();
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(existsSync(path.join(root, 'node_modules/tsx/dist/cli.mjs'))).toBe(true);
  expect(existsSync(path.join(root, 'node_modules/vite/bin/vite.js'))).toBe(true);
  expect(existsSync(path.join(root, 'node_modules/@openai/codex-sdk'))).toBe(false);
  put('fixtures/codex/package.json', JSON.stringify({ name: '@openai/codex-sdk', version: '1.0.0', main: 'index.cjs' }));
  put('fixtures/codex/index.cjs', 'module.exports = {};');
  manifest({ ...old, '@openai/codex-sdk': 'file:fixtures/codex' });
  result = launch();
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(existsSync(path.join(root, 'node_modules/@openai/codex-sdk'))).toBe(true);
  result = launch();
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(result.stdout).toContain('checking and installing dependencies');
  expect(readFileSync(path.join(root, 'started'), 'utf8')).toBe('started\nstarted\nstarted\n');
  put('package.json', '{ invalid manifest');
  result = launch();
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('npm install failed');
  expect(readFileSync(path.join(root, 'started'), 'utf8')).toBe('started\nstarted\nstarted\n');
}, 60_000);
