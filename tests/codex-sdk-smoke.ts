/** Explicit live check: consumes Codex plan allowance. Never runs under npm test. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CodexProvider } from '../server/llm/codex';
import { schemaFor } from '../server/npc/prompts';
import { CODEX_DOCTOR_MODEL } from '../shared/llm';

if (!process.argv.includes('--live')) throw new Error('Pass --live to use your Codex login and plan allowance.');
if (!process.argv.includes('--doctor-only')) {
  const provider = new CodexProvider();
  try {
    const reply = await provider.chat({ key: 'smoke:nurse', system: 'You are a simulated nurse. Say hello. Do not take any actions.', schema: schemaFor({ factIds: [], counselIds: [], actionIds: ['order'], withPatient: true, withOrder: true }), history: [], message: 'Hello.' });
    assert.equal(typeof reply.json?.say, 'string');
    assert.ok(Array.isArray(reply.json?.actions));
    console.log(`✓ Live Luna NPC: structured reply, ${reply.usage?.inputTokens} input tokens, ${reply.usage?.outputTokens} output tokens.`);
  } finally { provider.dispose(); }
}

const dir = mkdtempSync(path.join(tmpdir(), 'ac-codex-smoke-'));
const port = 7800 + Math.floor(Math.random() * 70);
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts', '--port', String(port), '--llm', 'offline', '--tts', 'off'], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { ...process.env, AGENTCLINIC_USAGE_FILE: path.join(dir, 'usage.json') } });
let log = '';
server.stdout?.on('data', (chunk) => log += chunk);
server.stderr?.on('data', (chunk) => log += chunk);
try {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(log)), 30_000);
    server.once('message', () => { clearTimeout(timer); resolve(); });
    server.once('exit', () => { clearTimeout(timer); reject(new Error(log)); });
  });
  // an offline server uses no LLM at all: Online with No default, as the title screen's picker would (Codex is ready)
  const online = await fetch(`${base}/api/llm-mode`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ online: true, use: 'none' }) });
  assert.ok(online.ok, JSON.stringify(await online.json()));
  const start = await fetch(`${base}/api/observe`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agent: 'codex', mapId: 'orientation', npc: { source: 'offline' }, seed: 2024, pace: 0, maxTurns: 150 }) });
  const created = await start.json();
  assert.ok(start.ok, JSON.stringify(created));
  console.log(`Live Sol physician started: ${created.sessionId}`);
  let status: any;
  for (let i = 0; i < 480; i++) {
    status = await (await fetch(`${base}/api/observe`)).json();
    if (status.current?.state !== 'running') break;
    if (i % 30 === 0) console.log(`Physician running (${i}s), ${status.current.tail.length} recent log lines.`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  assert.equal(status.current?.state, 'finished', JSON.stringify(status.current));
  const run = await (await fetch(`${base}/api/runs/${created.sessionId}`)).json();
  assert.ok(run.actions.some((a: any) => a.action.type === 'talk'));
  assert.ok(run.actions.some((a: any) => a.action.type === 'order'));
  // The clock can end a shift before end_shift retrieves its debrief.
  assert.ok(status.current.tail.includes('→ end_shift'));
  assert.ok(run.debrief);
  assert.equal(run.llm, 'offline');
  assert.equal(run.usage.agent.model, CODEX_DOCTOR_MODEL);
  assert.ok(run.usage.agent.inputTokens > 0);
  console.log(`✓ Live Sol physician: ${run.actions.length} actions, debrief ${run.debrief.percent}%, final usage recorded.`);
} finally {
  await fetch(`${base}/api/observe`, { method: 'DELETE' }).catch(() => undefined);
  server.kill('SIGTERM');
  await new Promise<void>((resolve) => { server.once('exit', () => resolve()); const timer = setTimeout(() => { server.kill('SIGKILL'); resolve(); }, 5000); timer.unref(); });
  rmSync(dir, { recursive: true, force: true });
}
