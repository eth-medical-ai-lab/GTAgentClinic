#!/usr/bin/env node
// The SDK owns the agent loop. This launcher only supplies CLI isolation flags
// absent from the SDK options. Authentication remains inside unmodified Codex.
//
// macOS and Linux: the SDK starts this file. Windows cannot start a script, so there the SDK
// starts node.exe with this file as a preload (NODE_OPTIONS --import, see server/llm/codex.ts).
// Node takes the SDK's first argument, "exec", for a script name; the preload runs first and
// exits with Codex, so Node never looks for that script.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const preload = process.env.AGENTCLINIC_CODEX_PRELOAD === '1';
// (as a preload, any other Node process that inherits the variables passes through untouched)
if (!preload || path.basename(process.argv[1] ?? '') === 'exec') {
  const args = preload ? ['exec', ...process.argv.slice(2)] : process.argv.slice(2);
  if (args[0] !== 'exec') throw new Error('Only Codex exec is supported by the game launcher.');
  args.splice(1, 0, '--ignore-user-config', '--ephemeral');
  const env = { ...process.env };
  if (preload) { delete env.NODE_OPTIONS; delete env.AGENTCLINIC_CODEX_PRELOAD; } // Codex and its MCP servers start clean
  const override = process.env.AGENTCLINIC_CODEX_BIN;
  // (Windows cannot start a .js override either: Node runs it)
  const viaNode = !override || (process.platform === 'win32' && /\.[cm]?js$/i.test(override));
  const child = spawn(viaNode ? process.execPath : override, viaNode ? [override || createRequire(import.meta.url).resolve('@openai/codex/bin/codex.js'), ...args] : args, { stdio: 'inherit', env, windowsHide: true });
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
  const code = await new Promise((resolve) => {
    child.on('error', (e) => { console.error(e.message); resolve(1); });
    child.on('exit', (exit) => resolve(exit ?? 1));
  });
  process.exit(code);
}
