/** Runs inside ObserveManager's child process. The model receives pixels and its own previous inputs. */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { EmbodiedEvent } from '../shared/embodied';
import { startLiveView } from './embodiedLive';
import { chromium, type Browser } from 'playwright';
import { z } from 'zod';
import { CLAUDE_MODELS, detectProvider, LlmError, type LlmProvider, type LlmCallUsage } from '../server/llm/provider';
import { addTotals, callTotals, emptyTotals } from '../server/usage';
import { playInputs, decision, systemPrompt, viewport } from './embodiedControls';

const argument = (key: string) => process.argv[process.argv.indexOf(key) + 1];
const sessionId = argument('--session');
const model = argument('--model') as keyof typeof CLAUDE_MODELS;
const source = process.env.AGENTCLINIC_VISION_SOURCE!;
const maxTurns = Number(argument('--max-turns'));
const url = new URL(process.env.AGENTCLINIC_URL!);
const token = process.env.AGENTCLINIC_DRIVER_TOKEN;
let browser: Browser | undefined;
let provider: LlmProvider | null = null;
let closing = false;
const totals = emptyTotals();
let actualModel: string | undefined;

function report(u?: LlmCallUsage, final = false) {
  if (u) {
    addTotals(totals, callTotals(u));
    actualModel = u.model;
  }
  if (provider && process.connected) process.send?.({ usage: { ...totals, label: 'Embodied doctor', billing: provider.billing, model: actualModel ?? model, final } });
}

async function close() {
  closing = true;
  provider?.dispose();
  await browser?.close().catch(() => {});
}
for (const signal of ['disconnect', 'SIGTERM', 'SIGINT'] as const) process.once(signal, () => { void close().finally(() => process.exit(0)); });

// The API supports anyOf and primitive types. Local validation enforces coordinates, time and length.
const schema = z.toJSONSchema(decision, { override: ({ jsonSchema: s }) => {
  for (const k of ['minimum', 'maximum', 'minLength', 'maxLength', 'maxItems']) delete s[k];
  if (s.oneOf) { s.anyOf = s.oneOf; delete s.oneOf; }
} });
delete schema.$schema;

async function run() {
  url.searchParams.set('doctorCamera', process.env.AGENTCLINIC_DRIVER_CAMERA === 'first' ? 'first' : 'third');
  if (!token || !process.send) throw Error('Start the embodied doctor from Watch an AI doctor.');
  provider = await detectProvider(source, {});
  if (!provider) throw Error('The selected vision provider is unavailable.');
  browser = await chromium.launch({ channel: 'chromium', args: ['--force-device-scale-factor=1.5', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] });
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1.5, acceptDownloads: false, serviceWorkers: 'block' });
  const page = await context.newPage();
  await context.route('**/*', route => {
    const req = route.request();
    const dest = new URL(req.url());
    if (dest.origin !== url.origin || (req.isNavigationRequest() && dest.href !== url.href)) return route.abort();
    return route.continue();
  });
  await page.addInitScript(({ origin, id, key }) => {
    if (location.origin === origin) {
      sessionStorage.setItem('ac.sessionId', id);
      sessionStorage.setItem('ac.driverToken', key);
    }
  }, { origin: url.origin, id: sessionId, key: token });
  await page.goto(url.href, { waitUntil: 'domcontentloaded' });
  await page.locator('.game .hud-clock').waitFor({ timeout: 90000 });
  await page.locator('.loading-screen').waitFor({ state: 'hidden', timeout: 120000 });
  const stopLive = await startLiveView(page, frame => new Promise(resolve => {
    if (closing || !process.connected) return resolve();
    process.send!({ frame }, () => resolve());
  }));
  const dir = path.join(process.env.AGENTCLINIC_RUNS_DIR!, sessionId + '.observations');
  let observeNext = true;
  let observation = 0;
  const previous: string[] = [];
  const record = (event: EmbodiedEvent) => {
    if (process.connected) process.send?.({ event });
    if (event.kind !== 'observation') previous.push(JSON.stringify(event));
    console.log(JSON.stringify(event));
  };
  try {
    await mkdir(dir, { recursive: true });
    for (let turn = 1; turn <= maxTurns; turn++) {
      if (!await page.locator('.game').count()) return;
      let screenshot: string | undefined;
      if (observeNext) {
        const bytes = await page.screenshot({ type: 'jpeg', quality: 85, scale: 'css', timeout: 10000 });
        const at = Date.now();
        observation++;
        await writeFile(path.join(dir, observation + '.jpg'), bytes);
        record({ kind: 'observation', observation, turn, at });
        screenshot = bytes.toString('base64');
      }
      const view = observeNext ? 'New observation #' + observation : 'No new image requested. Last observation: #' + observation;
      const j = await provider.chat({ key: sessionId, model: source === 'api' ? CLAUDE_MODELS[model] : model,
        system: systemPrompt, history: [], schema, message: view + '\nRecent decisions and input results:\n' + previous.slice(-24).join('\n'), screenshot });
      report(j.usage);
      const parsed = decision.safeParse(j.json);
      if (!parsed.success) {
        const result = parsed.error.issues.slice(0, 2).map(i => i.path.join('.') + ' ' + i.message).join(', ');
        record({ kind: 'invalid', observation, turn, at: Date.now(), result });
        observeNext = false; // repair the invalid plan without paying for another image
        continue;
      }
      const choice = parsed.data;
      record({ kind: 'decision', ...choice, observation, turn, at: Date.now() });
      const active = await playInputs(page, choice.inputs, (input, result) => {
        record({ kind: 'input', input, result, observation, turn, at: Date.now() });
      });
      if (!active) return;
      observeNext = choice.observeAfter;
      await page.waitForTimeout(200);
    }
    console.log('Turn limit reached.');
  } finally {
    await stopLive();
  }
}

try { await run(); }
catch (e) {
  if (e instanceof LlmError) report(e.usage);
  const msg = (e as Error).message;
  console.error(msg.includes("Executable doesn't exist") ? 'Install the game browser with npx playwright install chromium, then start a new run.' : msg);
  process.exitCode = 1;
} finally {
  report(undefined, true);
  await close();
  if (process.connected) process.disconnect?.();
}
