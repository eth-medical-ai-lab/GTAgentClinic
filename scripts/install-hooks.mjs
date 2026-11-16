#!/usr/bin/env node
/**
 * `npm install` → "prepare" → this: point git at .githooks/ (the pre-commit secret scan), but only
 * when this package is the top of its own git work tree. It never fails the install.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

try {
  if (git('rev-parse', '--is-inside-work-tree') !== 'true') process.exit(0);
  // nested inside another repo (vendored, monorepo): a relative hooksPath would point at the outer repo
  if (realpathSync(git('rev-parse', '--show-toplevel')) !== realpathSync(root)) process.exit(0);
  let current = '';
  try {
    current = git('config', '--local', '--get', 'core.hooksPath');
  } catch {
    /* not set */
  }
  if (current && current !== '.githooks') {
    console.warn(`[hooks] core.hooksPath is already "${current}"; leaving it alone. Run .githooks/pre-commit from your own hook to keep the secret scan.`);
    process.exit(0);
  }
  if (!current) {
    const legacy = path.join(git('rev-parse', '--git-dir'), 'hooks', 'pre-commit');
    if (existsSync(path.resolve(root, legacy))) console.warn(`[hooks] note: ${legacy} will no longer run (git now uses .githooks/).`);
    git('config', 'core.hooksPath', '.githooks');
    console.log('[hooks] pre-commit secret scan enabled (git config core.hooksPath .githooks)');
  }
} catch {
  // no git, not a checkout (tarball, Docker build), read-only config…: hooks are optional, the install must not fail
}
