/** Real game browser + spectator + Anthropic SDK, with a local image-model stand-in. */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { startHarness } from './harness';
import type { Decision } from '../agents/embodiedControls';

const plans: Decision[] = [
  { intent: 'Cross the corridor', inputs: [{ kind: 'key', key: 'w', ms: 4000 }, { kind: 'look', dx: 300, dy: 0 }], observeAfter: false },
  { intent: 'Open the tablet', inputs: [{ kind: 'key', key: 'Tab', ms: 0 }], observeAfter: true },
  { intent: 'Open the patient chart', inputs: [{ kind: 'click', x: 1010, y: 270 }], observeAfter: true },
  { intent: 'Choose diagnoses', inputs: [{ kind: 'click', x: 82, y: 516 }], observeAfter: true },
  { intent: 'Enter a diagnosis', inputs: [{ kind: 'click', x: 337, y: 231 }, { kind: 'type', text: 'Ankle sprain' }, { kind: 'key', key: 'Enter', ms: 0 }], observeAfter: false },
  { intent: 'Close the chart', inputs: [{ kind: 'key', key: 'Escape', ms: 0 }, { kind: 'speak', text: 'Hello?' }], observeAfter: false },
];
const images: Buffer[] = [];
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}
const firstRequest = gate();
let release = gate();
let turns = 0;
const dir = 'shots/embodied';
mkdirSync(dir, { recursive: true });
const mock = http.createServer(async (req, res) => {
  const data: Buffer[] = [];
  for await (const c of req) data.push(c);
  const request = JSON.parse(Buffer.concat(data).toString());
  const blocks = request.messages.at(-1).content;
  if (!turns || plans[turns - 1].observeAfter) {
    assert.deepEqual(blocks.map((b: {type: string}) => b.type), ['text', 'image']);
    assert.equal(blocks[1].source.media_type, 'image/jpeg');
    const pixels = Buffer.from(blocks[1].source.data, 'base64');
    assert.equal(pixels.readUInt16BE(0), 0xffd8);
    images.push(pixels);
    writeFileSync(dir + '/observation-' + images.length + '.jpg', pixels);
  } else {
    assert.equal(typeof blocks, 'string', 'a blind decision has no image content');
  }
  const plan = plans[turns++];
  assert.ok(plan);
  if (turns === 1) { firstRequest.resolve(); await release.promise; }
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ id: 'msg_' + turns, model: request.model, type: 'message', role: 'assistant', stop_reason: 'end_turn',
    content: [{ type: 'text', text: JSON.stringify(plan) }], usage: { input_tokens: 100, output_tokens: 20 } }));
});
await new Promise<void>(resolve => mock.listen(0, '127.0.0.1', resolve));
const h = await startHarness({ portBase: 7600, llm: 'api', dev: false, env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:' + (mock.address() as AddressInfo).port, ANTHROPIC_API_KEY: 'offline-test' } });
try {
  const page = await h.browser.newPage();
  await page.goto(h.url);
  const card = page.locator('.watch-ai');
  assert.equal(await card.getByRole('button', { name: 'Embodied', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await card.getByRole('button', { name: 'Over-the-shoulder' }).getAttribute('aria-pressed'), 'true');
  assert.equal(await card.getByRole('group', { name: 'AI doctor' }).count(), 0);
  await page.getByLabel('NPC source', { exact: true }).selectOption('offline');
  await card.getByRole('button', { name: 'Haiku' }).click();
  await card.getByLabel('Shift', { exact: true }).selectOption('orientation');
  await card.getByLabel('Case seed').fill('42');
  await card.getByLabel('Turn limit').fill(String(plans.length));
  await card.getByRole('button', { name: /Watch the AI doctor/ }).click();
  await page.waitForURL('**/?embodied=*');
  const id = new URL(page.url()).searchParams.get('embodied');
  const session = h.url + '/api/sessions/' + id;
  assert.equal((await fetch(session)).status, 404);
  assert.equal((await fetch(session + '/act', { method: 'POST', body: '{}' })).status, 404);
  const ws = new WebSocket(h.url.replace('http:', 'ws:') + '/ws');
  try {
    const denial = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('No spectator refusal')), 5000);
      ws.on('message', data => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'welcome') ws.send(JSON.stringify({ type: 'resume', sessionId: id }));
        if (msg.type === 'error') { clearTimeout(timer); resolve(msg.message); }
      });
    });
    assert.match(await denial, /spectator link/);
  } finally { ws.close(); }
  await Promise.race([firstRequest.promise, page.waitForTimeout(120000).then(() => { throw Error('No first model request'); })]);
  const live = page.getByRole('img', { name: /current game screen/ });
  await page.waitForFunction(() => document.querySelector<HTMLImageElement>('.embodied-view img')?.naturalWidth === 1920, undefined, { timeout: 30000 });
  assert.equal(await live.evaluate(image => (image as HTMLImageElement).naturalHeight), 1080);
  assert.equal(await page.getByRole('button', { name: 'Live view' }).getAttribute('aria-pressed'), 'true');
  await page.screenshot({ path: dir + '/live-view.png' });
  const reader = (await fetch(h.url + '/api/observe/' + id + '/live', { signal: AbortSignal.timeout(12000) })).body!.getReader();
  let bytes = Buffer.alloc(0);
  const started = Date.now();
  try {
    while (bytes.toString('latin1').split('--gameframe').length < 8) {
      const chunk = await reader.read();
      assert.ok(!chunk.done);
      bytes = Buffer.concat([bytes, chunk.value]);
    }
  } finally { await reader.cancel(); }
  console.log('Received 6 live 1080p frames in ' + (Date.now() - started) + ' ms while inference was held.');
  await page.getByRole('button', { name: 'What the AI saw' }).click();
  const frozen = page.getByRole('img', { name: 'Observation 1', exact: true });
  await frozen.waitFor();
  await page.waitForFunction(() => document.querySelector<HTMLImageElement>('.embodied-view img')?.naturalWidth === 1280);
  assert.equal(await frozen.evaluate(image => (image as HTMLImageElement).naturalHeight), 720);
  const shot = await fetch(h.url + '/api/runs/' + id + '/observations/1.jpg');
  assert.deepEqual(Buffer.from(await shot.arrayBuffer()), images[0]);
  await page.getByRole('button', { name: /Observation log/ }).click();
  await page.getByRole('link', { name: 'Screenshot 1' }).waitFor();
  release.resolve();
  await page.getByText(/Cross the corridor · continue without/).waitFor();
  await page.screenshot({ path: dir + '/ai-observation.png' });
  assert.equal(await frozen.count(), 1, 'during the long move the model still sees observation 1');
  await page.getByRole('button', { name: 'Live view' }).click();
  await page.getByText(/Debrief ·/).waitFor({ timeout: 90000 });
  const saved = await (await fetch(h.url + '/api/runs/' + id)).json();
  assert.deepEqual(saved.doctor, { source: 'api', model: 'haiku', maxTurns: plans.length, initialCamera: 'third' });
  assert.equal(saved.observations.count, 4);
  assert.equal(images.length, 4);
  assert.equal(saved.observations.events.filter((e: { kind: string }) => e.kind === 'decision').length, plans.length);
  const logData = await (await fetch(h.url + '/api/runs/' + id + '/observations')).json();
  assert.deepEqual(logData, saved.observations);
  assert.equal(saved.seed, 42);
  assert.equal(saved.llm, 'offline', 'embodied physician retains independent NPC selection');
  assert.equal(saved.controlMode, 'embodied');
  assert.equal(saved.usage.agent.calls, plans.length);
  assert.ok(saved.actions.some((r: { action: { type: string } }) => r.action.type === 'set_diagnoses'), 'screen inputs should save a diagnosis in the chart');
  const log = await (await fetch(h.url + '/api/runs/' + id + '/agent-log')).text();
  assert.match(log, /No available conversation/);
  assert.equal(turns, plans.length);
  await page.getByRole('link', { name: 'Main menu' }).click();
  await card.getByRole('button', { name: 'Embodied', exact: true }).click();
  turns = 0;
  release = gate();
  await card.getByRole('button', { name: 'First-person' }).click();
  await card.getByRole('button', { name: /Watch the AI doctor/ }).click();
  await page.getByRole('img', { name: /current game screen/ }).waitFor({ timeout: 120000 });
  const oldShot = await fetch(h.url + '/api/runs/' + id + '/observations/4.jpg');
  assert.deepEqual(Buffer.from(await oldShot.arrayBuffer()), images[3], 'archive survives switching to another run');
  await page.getByRole('button', { name: 'What the AI saw' }).click();
  await page.getByRole('img', { name: 'Observation 1', exact: true }).waitFor({ timeout: 90000 });
  // A stale viewer must not stop this new run.
  assert.equal((await fetch(h.url + '/api/observe?session=' + id, { method: 'DELETE' })).status, 409);
  await page.getByRole('button', { name: 'Stop shift' }).click();
  await page.getByText(/Debrief ·/).waitFor();
  assert.equal((await (await fetch(h.url + '/api/observe')).json()).current.state, 'stopped');
  console.log('Verified screenshot inference, movement controls, tablet → chart, out-of-range speech, usage, debrief and spectator isolation.');
} catch (e) {
  console.error(h.log(), await (await fetch(h.url + '/api/observe')).text());
  throw e;
} finally {
  release.resolve();
  await fetch(h.url + '/api/observe', { method: 'DELETE' }).catch(() => {});
  await h.close();
  mock.close();
}
