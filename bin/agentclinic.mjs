#!/usr/bin/env node
/**
 * One command to play:  `agentclinic`  (or `npm start` inside the repo)
 *   • checks Node.js, installs dependencies and builds the 3D client on first run
 *   • NPC brains: the first start in a terminal asks once whether the characters may run on your
 *     own Claude Code login, and saves the answer in agentclinic.local.json (server/firstRun.ts).
 *     Otherwise: your own ANTHROPIC_API_KEY → scripted offline NPCs (docs/SETUP.md)
 *   • picks a free port if 5317 is taken, starts the server and opens your browser
 * Flags: --port 5317  --llm auto|api|claude-code|offline  --no-open  --dev  --host 0.0.0.0
 *        --max-tokens 200k / --max-usd 0.50  (NPC budget per server run; then scripted NPCs)
 *        --tts kokoro|browser|off  (NPC voices; kokoro = local neural TTS once `npm run voices:install`
 *                                   added it, else browser voices; or AGENTCLINIC_TTS)
 *        --exit-when-idle  (stop 2 minutes after the last game tab closes; the Mac launcher uses it)
 *        --allow-host NAME  --allow-origin URL  (who may connect besides localhost; see SECURITY.md)
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, statSync, readdirSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkNode } from '../scripts/check-node.mjs';

checkNode(); // Node.js 22.12+, with install instructions otherwise

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (k) => argv.includes(`--${k}`);
const opt = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const c = { teal: '\x1b[36m', dim: '\x1b[2m', bold: '\x1b[1m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', reset: '\x1b[0m' };
let port = Number(opt('port', process.env.PORT ?? '5317'));
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`${c.red}  --port must be a number from 1 to 65535.${c.reset}`);
  process.exit(1);
}
const host = opt('host', process.env.HOST ?? '127.0.0.1');
// only an explicit --llm is passed on: the server itself reads AGENTCLINIC_LLM and agentclinic.local.json
const llm = opt('llm');
const dev = flag('dev');

console.log(`\n${c.teal}${c.bold}  ✚ GTAgentClinic${c.reset}${c.dim}  — a 3D embodied hospital environment for AI and human agents${c.reset}\n`);

// 1) dependencies + client build
const vite = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const tsx = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
{
  // A branch switch can add dependencies even when tsx and Vite are already installed.
  console.log(`${c.dim}  checking and installing dependencies…${c.reset}`);
  const r = spawnSync('npm', ['install', '--no-fund', '--no-audit'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) {
    console.error(`${c.red}  npm install failed (see above).${c.reset} Check your internet connection, then run: npm ci. Help: docs/SETUP.md#troubleshooting`);
    process.exit(r.status ?? 1);
  }
}
const built = path.join(root, 'dist', 'client', 'index.html');
const newestSrc = (dir) => {
  let t = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    t = Math.max(t, e.isDirectory() ? newestSrc(p) : statSync(p).mtimeMs);
  }
  return t;
};
if (!dev) {
  const stale = !existsSync(built) || Math.max(newestSrc(path.join(root, 'client')), newestSrc(path.join(root, 'shared'))) > statSync(built).mtimeMs;
  if (stale) {
    console.log(`${c.dim}  building the 3D client…${c.reset}`);
    const r = spawnSync(process.execPath, [vite, 'build', '--logLevel', 'warn'], { cwd: root, stdio: 'inherit' });
    if (r.status !== 0) {
      console.error(`${c.red}  The 3D client did not build (see above).${c.reset} Try: npm ci, then npm start again. Help: docs/SETUP.md#troubleshooting`);
      process.exit(r.status ?? 1);
    }
    // never serve a bundle with a key in it (same scan as `npm run build` → postbuild; ~0.1 s)
    const scan = spawnSync(process.execPath, [path.join(root, 'scripts', 'check-secrets.mjs'), '--dist'], { cwd: root, encoding: 'utf8' });
    if (scan.status !== 0) {
      process.stdout.write(scan.stdout ?? '');
      process.stderr.write(scan.stderr ?? '');
      console.error(`${c.red}  Refusing to serve a client bundle that may contain a secret (see above, and SECURITY.md).${c.reset}`);
      process.exit(1);
    }
  }
}

// 2) a free port (5317 may be taken, e.g. by an AgentClinic that is already running)
function openBrowser(url) {
  if (flag('no-open')) return;
  const cmd = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true, windowsHide: true }).on('error', () => {}).unref();
}
const canListen = (p) =>
  new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.listen({ port: p, host, exclusive: true }, () => probe.close(() => resolve(true)));
  });
const urlHost = ['0.0.0.0', '::', ''].includes(host) ? '127.0.0.1' : host.includes(':') ? `[${host}]` : host;
if (!(await canListen(port))) {
  const busy = `http://${urlHost}:${port}`;
  const running = await fetch(`${busy}/api/health`, { signal: AbortSignal.timeout(1500) })
    .then((r) => r.json())
    .then((j) => (j && j.ok && typeof j.version === 'string' ? j.version : null))
    .catch(() => null);
  if (running) {
    console.log(`  ${c.green}●${c.reset} AgentClinic v${running} is already running at ${c.bold}${busy}${c.reset}, so opening that one.`);
    console.log(`${c.dim}    To restart it (e.g. after an update): Ctrl+C in its terminal, then npm start. A second one: npm start -- --port ${port + 1}${c.reset}\n`);
    openBrowser(busy);
    process.exit(0);
  }
  let free = 0;
  for (let p = port + 1; p <= Math.min(65535, port + 20) && !free; p++) if (await canListen(p)) free = p;
  if (!free) {
    console.error(`${c.red}  Port ${port} and the next 20 are in use.${c.reset} Start with --port <a free port>.`);
    process.exit(1);
  }
  console.log(`  ${c.yellow}◌ Port ${port} is in use by another program, so using ${free} instead${c.reset} ${c.dim}(choose one with --port)${c.reset}`);
  port = free;
}

// 3) in a terminal, the first start asks once who talks for the characters (server/firstRun.ts).
//    Not interactive (CI, scripts, tests): nothing is asked and nothing changes.
let llmForRun = llm;
let offlineHint;
if (process.stdin.isTTY && process.stdout.isTTY) {
  try {
    const { tsImport } = await import('tsx/esm/api');
    const { runFirstRun } = await tsImport('../server/firstRun.ts', import.meta.url);
    const r = await runFirstRun({ root, llmFlag: llm });
    if (r.aborted) process.exit(130);
    if (r.llm) llmForRun = r.llm;
    offlineHint = r.offlineHint;
  } catch (e) {
    console.log(`${c.dim}  (skipped the first-run question: ${e.message})${c.reset}`);
  }
}

// 4) server
const args = [tsx, path.join(root, 'server', 'index.ts'), '--port', String(port)];
if (llmForRun) args.push('--llm', llmForRun);
if (dev) args.push('--dev');
if (opt('host')) args.push('--host', opt('host'));
for (const k of ['max-tokens', 'max-usd', 'tts']) if (opt(k)) args.push(`--${k}`, opt(k));
// --exit-when-idle[=2m]: stop once no game tab has been open for a while (the Mac launcher's Terminal window)
const idleFlag = argv.find((a) => a === '--exit-when-idle' || a.startsWith('--exit-when-idle='));
if (idleFlag) args.push(idleFlag);
// repeatable access flags (SECURITY.md): --allow-host mymac.local, --allow-origin http://localhost:3000
argv.forEach((a, i) => {
  if (/^--allow-(host|origin)=/.test(a)) args.push(a);
  else if (/^--allow-(host|origin)$/.test(a) && argv[i + 1]) args.push(a, argv[i + 1]);
});
const server = spawn(process.execPath, args, { cwd: root, stdio: ['ignore', 'pipe', 'inherit'], env: process.env });
let opened = false;
let ttsShown = false;
server.stdout.on('data', (d) => {
  const s = d.toString();
  for (const line of s.split('\n').filter(Boolean)) {
    if (line.startsWith('[llm]')) {
      const offline = /offline/i.test(line);
      console.log(`  ${offline ? c.yellow + '◌' : c.green + '●'} Default NPC source:${c.reset} ${line.replace('[llm] ', '')}`);
      // (the first-run question may have explained already, or knows a better hint: server/firstRun.ts)
      if (offline && offlineHint !== null) console.log(`${c.dim}    ${offlineHint ?? 'For open-ended conversations, set ANTHROPIC_API_KEY to your own key (Claude Haiku NPCs: a few cents per shift). See docs/SETUP.md'}${c.reset}`);
    } else if (line.startsWith('[claude-code]')) {
      console.log(`  ${c.yellow}!${c.reset} ${line.replace('[claude-code] ', '')}`);
    } else if (line.startsWith('[tts] ') && !ttsShown) {
      ttsShown = true;
      const quiet = /^\[tts\] (off|browser)/.test(line);
      console.log(`  ${quiet ? c.yellow + '◌' : c.green + '●'} NPC voices:${c.reset} ${line.replace('[tts] ', '')}`);
    } else if (line.startsWith('[server]')) {
      const url = /(http:\/\/\S+)/.exec(line)?.[1] ?? `http://localhost:${port}`;
      console.log(`  ${c.green}●${c.reset} Hospital open at ${c.bold}${url}${c.reset}`);
      console.log(`${c.dim}    AI agents: POST ${url}/api/sessions · MCP: npm run mcp · Ctrl+C to close the ED${c.reset}\n`);
      if (!opened) {
        opened = true;
        openBrowser(url);
      }
    } else if (/\[session\]|\[npc\]|\[usage\]|\[security\]|\[tts\]|\[observe\]|\[idle\]|error/i.test(line)) {
      console.log(`${c.dim}  ${line}${c.reset}`);
    }
  }
});
const stop = () => {
  server.kill('SIGINT');
  setTimeout(() => process.exit(0), 300);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.on('SIGHUP', stop); // the terminal window was closed (e.g. the Mac launcher's)
server.on('exit', (code) => process.exit(code ?? 0));
