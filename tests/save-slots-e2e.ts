/** A real process restart between saving two branches and loading them through the normal wire protocol. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import type { ClientMsg, ServerMsg, PlayerView, PatientChart } from '../shared/types';
import { newRotation } from '../shared/saveGame';

const dir = mkdtempSync(path.join(tmpdir(), 'clinic-restart-'));
const port = 7700 + Math.floor(Math.random() * 250);
const owner = randomUUID();
async function boot() {
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts', '--port', String(port), '--llm', 'offline', '--tts', 'off'], {
    env: { ...process.env, AGENTCLINIC_SAVE_DIR: dir, AGENTCLINIC_USAGE_FILE: path.join(dir, 'usage.json') }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Server start timed out')), 20000);
      child.once('exit', code => { clearTimeout(timer); reject(new Error('Server exit ' + code)); });
      child.stdout.on('data', chunk => { if (chunk.toString().includes('[server]')) { clearTimeout(timer); resolve(); } });
    });
    const ws = new WebSocket('ws://127.0.0.1:' + port + '/ws');
    await once(ws, 'open');
    return {
      async request<T extends ServerMsg['type']>(msg: ClientMsg, type: T) {
        const result = new Promise<Extract<ServerMsg, { type: T }>>((resolve, reject) => {
          const timer = setTimeout(() => { ws.off('message', listener); reject(new Error('No ' + type)); }, 8000);
          const listener = (raw: Buffer) => {
            const response = JSON.parse(raw.toString()) as ServerMsg;
            if (response.type !== type && response.type !== 'slot_error' && response.type !== 'error') return;
            clearTimeout(timer);
            ws.off('message', listener);
            if (response.type === 'slot_error' || response.type === 'error') reject(new Error(response.message));
            else resolve(response as Extract<ServerMsg, { type: T }>);
          };
          ws.on('message', listener);
        });
        ws.send(JSON.stringify(msg));
        return result;
      },
      async close() {
        ws.terminate();
        const exit = once(child, 'exit');
        child.kill();
        await exit;
      },
    };
  } catch (error) { child.kill(); throw error; }
}

let server: Awaited<ReturnType<typeof boot>> | undefined;
try {
  server = await boot();
  const start = await server.request({ type: 'start', owner, mapId: 'night_shift', seed: 77, playerName: 'Student', settings: { paused: true } }, 'state');
  const pid = start.view.board[0].id;
  for (const action of [{ type: 'talk', npcId: 'pt_' + pid, text: 'What happened?' }, { type: 'order', patientId: pid, code: 'cbc' }] as const) {
    assert.ok((await server.request({ type: 'action', action }, 'actionResult')).result.ok);
  }
  const player = { rotation: newRotation(), camera: 'first' as const, world: null };
  await server.request({ type: 'save_slot', owner, slot: 1, name: 'Awaiting lab', revision: null, player }, 'slot_saved');
  assert.ok((await server.request({ type: 'action', action: { type: 'wait', minutes: 100 } }, 'actionResult')).result.ok);
  await server.request({ type: 'save_slot', owner, slot: 2, name: 'After lab', revision: null, player }, 'slot_saved');
  await server.close();
  server = undefined;
  server = await boot();
  const list = await server.request({ type: 'slots', owner }, 'slots');
  assert.deepEqual(list.slots.map(s => s?.name), ['Awaiting lab', 'After lab', undefined, undefined, undefined]);
  for (const slot of [2, 1, 1]) {
    const { view }: {view: PlayerView} = await server.request({ type: 'load_slot', owner, slot }, 'state');
    assert.equal(view.t, slot === 1 ? 0 : 6000);
    assert.ok(view.settings.paused);
    assert.ok(view.conversations.some(c => c.lines.some(l => l.speaker === 'npc')));
    const { chart }: {chart: PatientChart} = await server.request({ type: 'chart', patientId: pid }, 'chart');
    assert.equal(chart.orders.find(o => o.code === 'cbc')?.status === 'Resulted', slot === 2);
  }
  console.log('Five slots, two independent checkpoints, pending lab, dialogue and repeated loads verified after a server restart.');
} finally {
  await server?.close();
  rmSync(dir, { recursive: true, force: true });
}
