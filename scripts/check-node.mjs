#!/usr/bin/env node
/**
 * Node.js version gate, shared by `npm install` / `npm ci` ("preinstall") and `npm start`
 * (bin/agentclinic.mjs), so an old Node fails early with instructions instead of a stack trace.
 * Why 22.12: Vite 8 needs ^20.19 || >=22.12, Vitest 5 needs 22.12+, and Node 20 is end-of-life.
 * Keep this file dependency-free and plain, so it runs (and explains itself) on old versions.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MIN_NODE = [22, 12];

/** null when `version` (e.g. "22.12.0") is new enough, else a friendly multi-line message */
export function nodeVersionProblem(version = process.versions.node) {
  const [major, minor] = version.split('.').map(Number);
  if (major > MIN_NODE[0] || (major === MIN_NODE[0] && minor >= MIN_NODE[1])) return null;
  return [
    `GTAgentClinic needs Node.js ${MIN_NODE.join('.')} or newer, but this is Node ${version}.`,
    '  Install the current LTS from https://nodejs.org, or with a package manager:',
    '    macOS:   brew install node           Windows: winget install OpenJS.NodeJS.LTS',
    '    Linux:   nvm install 22 (https://github.com/nvm-sh/nvm)',
    '  Then open a NEW terminal and run the command again. Step by step: docs/SETUP.md',
  ].join('\n');
}

export function checkNode() {
  const problem = nodeVersionProblem();
  if (!problem) return;
  console.error(`\n${problem}\n`);
  process.exit(1);
}

// run directly: node scripts/check-node.mjs
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) checkNode();
