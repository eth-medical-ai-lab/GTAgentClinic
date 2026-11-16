/** Offline model fixtures + real server, MCP tools, SDK, and browser. No paid calls. */
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright';
import { menuStoryboard } from './menu-storyboard';
import { CODEX_DOCTOR_MODEL } from '../shared/llm';

export async function sourceStoryboard(out = 'shots/llm-sources') {
  mkdirSync(out, { recursive: true });
  const tmp = mkdtempSync(path.join(tmpdir(), 'ac-sources-e2e-'));
  const requests: { model: string; tools: boolean }[] = [];
  let server: ChildProcess | undefined;
  let browser: Browser | undefined;
  let log = '';
  const fixture = http.createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'npc-model' }, { id: 'doctor-model' }] }));
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    requests.push({ model: body.model, tools: !!body.tools });
    let message: unknown;
    if (body.tools) {
      const done = body.messages.filter((m: { role: string }) => m.role === 'tool').length;
      const steps = [ ['start_shift', {}], ['wait', { minutes: 6 }], ['move', { to: 'bed_4' }], ['talk', { npc_id: 'pt_p_brunner', text: 'Does it burn when you pass urine?' }], ['end_shift', {}] ];
      const [name, args] = steps[Math.min(done, steps.length - 1)];
      message = { role: 'assistant', content: `Fixture action ${name}.`, tool_calls: [{ id: `call_${done}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] };
    } else message = { role: 'assistant', content: JSON.stringify({ say: 'I feel unwell.', emotion: 'neutral', revealed: [], counseled: [], actions: [] }) };
    res.end(JSON.stringify({ choices: [{ message }], usage: { prompt_tokens: 100, completion_tokens: 20 } }));
  });
  const check = (name: string, condition: unknown) => { assert.ok(condition, name); console.log(`✓ ${name}`); };
  try {
    await new Promise<void>((resolve, reject) => { fixture.once('error', reject); fixture.listen(0, '127.0.0.1', resolve); });
    const vllmUrl = `http://127.0.0.1:${(fixture.address() as { port: number }).port}/v1`;
    const fake = path.join(tmp, 'codex.mjs');
    writeFileSync(fake, `#!/usr/bin/env node
if (process.argv[2] === 'login') process.exit(0);
let input = ''; for await (const chunk of process.stdin) input += chunk;
console.log(JSON.stringify({type:'thread.started',thread_id:'fixture'}));
if (!process.argv.includes('--output-schema')) {
  const { Client } = await import(${JSON.stringify(import.meta.resolve('@modelcontextprotocol/sdk/client/index.js'))});
  const { StdioClientTransport } = await import(${JSON.stringify(import.meta.resolve('@modelcontextprotocol/sdk/client/stdio.js'))});
  const config = process.argv.find(a => a.startsWith('mcp_servers='));
  if (!config) throw Error('Missing hospital MCP configuration');
  const stringField = key => JSON.parse(config.match(new RegExp('"' + key + '"=("[^"\\n]*")'))[1]);
  const args = JSON.parse(config.match(/"args"=(\\[[^\\]]*\\])/)[1]);
  const transport = new StdioClientTransport({ command: stringField('command'), args, cwd: stringField('cwd'),
    env: { PATH: process.env.PATH, AGENTCLINIC_URL: stringField('AGENTCLINIC_URL'), AGENTCLINIC_SESSION: stringField('AGENTCLINIC_SESSION') }, stderr: 'inherit' });
  const client = new Client({ name: 'codex-test', version: '1.0.0' });
  try {
    await client.connect(transport);
    for (const tool of ['start_shift', 'end_shift']) {
      const result = await client.callTool({ name: tool, arguments: {} });
      if (result.isError) throw Error(JSON.stringify(result));
      console.log(JSON.stringify({type:'item.completed',item:{id:tool,type:'mcp_tool_call',server:'agentclinic',tool,status:'completed',arguments:{},result}}));
    }
  } finally { await transport.close(); }
  console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:200,cached_input_tokens:0,output_tokens:30}}));
  process.exit(0);
}
console.log(JSON.stringify({type:'item.completed',item:{id:'a',type:'agent_message',text:JSON.stringify({say:'I feel unwell.',emotion:'neutral',revealed:[],counseled:[],actions:[]})}}));
console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:100,cached_input_tokens:0,output_tokens:20}}));
`);
    chmodSync(fake, 0o755);
    const port = 7700 + Math.floor(Math.random() * 90);
    const url = `http://127.0.0.1:${port}`;
    server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts', '--dev', '--port', String(port), '--llm', 'offline', '--tts', 'off'], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { ...process.env, AGENTCLINIC_CODEX_BIN: fake, LOCAL_API_URL: vllmUrl, AGENTCLINIC_SAVE_DIR: path.join(tmp, 'saves'), AGENTCLINIC_USAGE_FILE: path.join(tmp, 'usage.json') } });
    server.stdout?.on('data', (data) => log += data);
    server.stderr?.on('data', (data) => log += data);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(log || 'Server startup timed out.')), 30_000);
      server!.once('error', reject);
      server!.on('message', () => { clearTimeout(timer); resolve(); });
      server!.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${log}`)); });
    });
    const api = async (route: string, body?: unknown, method = 'POST') => {
      const response = await fetch(url + route, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      const value = await response.json();
      assert.ok(response.ok, `${route}: ${JSON.stringify(value)}`);
      return value;
    };
    // An offline server uses no LLM at all, so switch Online as the title screen's picker would, with
    // No default: nothing paid, and each shift's own source is what runs (the fixture vLLM and fake Codex are ready)
    const mode = await api('/api/llm-mode', { online: true, use: 'none' });
    check('online without a default LLM', mode.online === true && mode.status.label === 'Online · no default LLM');
    // Every source is per-session: two simultaneous REST shifts keep different brains.
    const local = await api('/api/sessions', { mapId: 'night_shift', npc: { source: 'vllm', baseUrl: vllmUrl, model: 'npc-model' } });
    const codex = await api('/api/sessions', { mapId: 'night_shift', npc: { source: 'codex' } });
    for (const session of [local, codex]) {
      await api(`/api/sessions/${session.sessionId}/act`, { action: { type: 'wait', minutes: 6 } });
      const moved = await api(`/api/sessions/${session.sessionId}/act`, { action: { type: 'move', to: 'bed_4' } });
      const talked = await api(`/api/sessions/${session.sessionId}/act`, { action: { type: 'talk', npcId: 'pt_p_brunner', text: 'Does it burn when you pass urine?' } });
      check('test physician reaches and talks to patient', moved.result.ok && talked.result.ok);
    }
    const localUsage = await api(`/api/sessions/${local.sessionId}/usage`, undefined, 'GET');
    const codexUsage = await api(`/api/sessions/${codex.sessionId}/usage`, undefined, 'GET');
    check('vLLM NPC turns use their selected model', localUsage.provider === 'vllm' && localUsage.session.calls > 0);
    check('Codex NPC turns use SDK independently', codexUsage.provider === 'codex' && codexUsage.session.calls > 0);
    check('custom API is unpriced and Codex has an estimate', localUsage.costAvailable === false && codexUsage.session.costUSD > 0 && codexUsage.apiEquivalent === true);
    browser = await chromium.launch({ channel: 'chromium', args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${url}/?debug=1`);
    await page.waitForSelector('.npc-sources');
    await page.locator('.watch-ai').getByRole('button', { name: 'Clinical actions', exact: true }).click();
    const choices = page.getByLabel('NPC source', { exact: true });
    check('NPC selector separates all five connections', (await choices.locator('option').allTextContents()).join('|') === 'Use server default|Claude Code login|Anthropic API|Codex login|OpenAI API|Custom API (OpenAI-compatible)|Scripted (no LLM)');
    await choices.selectOption('anthropic-api');
    check('Anthropic choice retains its API identity', await page.evaluate(() => JSON.parse(localStorage.getItem('ac.npc.source')!).claudeMode) === 'api');
    await choices.selectOption('claude-code');
    check('Claude Code choice retains its login identity', await page.evaluate(() => JSON.parse(localStorage.getItem('ac.npc.source')!).claudeMode) === 'claude-code');
    await choices.selectOption('openai-api');
    await page.getByLabel('NPC model', { exact: true }).fill('chosen-openai-model');
    await page.reload();
    check('OpenAI NPC source and model survive reload', await choices.inputValue() === 'openai-api' && await page.getByLabel('NPC model', { exact: true }).inputValue() === 'chosen-openai-model');
    await choices.selectOption('codex');
    await page.locator('.watch-ai').getByRole('button', { name: 'Clinical actions', exact: true }).click();
    await page.locator('.watch-ai').getByRole('button', { name: 'Local (vLLM)', exact: true }).click();
    await page.getByLabel('Physician vLLM URL').fill(vllmUrl);
    await page.getByLabel('Physician model', { exact: true }).fill('doctor-model');
    await page.locator('.watch-ai').getByRole('button', { name: 'Embodied', exact: true }).click();
    check('embodied mode retains camera controls', await page.getByRole('group', { name: 'Starting camera' }).isVisible());
    await page.locator('.watch-ai').getByRole('button', { name: 'Clinical actions', exact: true }).click();
    check('switching modes preserves the local physician source and model', await page.getByLabel('Physician model', { exact: true }).inputValue() === 'doctor-model');
    check('NPC and physician models are independent in the UI', await page.getByLabel('NPC model', { exact: true }).inputValue() === 'gpt-6-luna');
    await page.locator('.npc-sources').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(out, 'desktop.png') });
    await page.setViewportSize({ width: 800, height: 1000 });
    await page.locator('.watch-ai').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(out, 'narrow.png') });
    check('menu fits the narrow viewport', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    // Launch a local physician with Codex NPCs through the real menu and real MCP server.
    await page.locator('.watch-ai select').selectOption('night_shift');
    await page.locator('.watch-ai').getByRole('button', { name: 'Watch the AI doctor →' }).click();
    await page.waitForSelector('.ob-panel', { timeout: 30_000 });
    let status: any;
    for (let i = 0; i < 100; i++) {
      status = await api('/api/observe', undefined, 'GET');
      if (status.current?.state !== 'running') break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    check('vLLM physician finishes through hospital MCP tools', status.current?.state === 'finished');
    const run = await api(`/api/runs/${status.current.sessionId}`, undefined, 'GET');
    check('physician uses Codex NPCs without changing its own model', run.llm === 'codex' && run.usage.agent.model === 'doctor-model');
    check('physician run includes move, talk, and end_shift actions', ['move', 'talk', 'end_shift'].every((type) => run.actions.some((a: any) => a.action.type === type)));
    check('model requests stay independent', requests.filter((r) => r.tools).every((r) => r.model === 'doctor-model') && requests.filter((r) => !r.tools).every((r) => r.model === 'npc-model'));
    // The HTTP run can finish before the spectator receives its debrief and clears its resume token.
    await page.waitForFunction(() => !!(window as any).__ac?.store.get().debrief);
    const codexDoctor = await api('/api/observe', { agent: 'codex', mapId: 'orientation', npc: { source: 'offline' }, pace: 0 });
    for (let i = 0; i < 100; i++) {
      status = await api('/api/observe', undefined, 'GET');
      if (status.current?.state !== 'running') break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    check('Codex physician finishes through the actual SDK and hospital MCP', status.current?.state === 'finished');
    const codexRun = await api(`/api/runs/${codexDoctor.sessionId}`, undefined, 'GET');
    check('Codex physician retains its model, token reporting, and independent offline NPCs', codexRun.llm === 'offline' && codexRun.usage.agent.model === CODEX_DOCTOR_MODEL && codexRun.usage.agent.inputTokens === 200);
    await page.goto(`${url}/?debug=1`);
    await page.waitForSelector('.npc-sources');
    await page.locator('.watch-ai').getByRole('button', { name: 'Clinical actions', exact: true }).click();
    check('physician selection survives a reload without Claude consent', await page.getByLabel('Physician model', { exact: true }).inputValue() === 'doctor-model');
    check('NPC selection survives a reload', await page.getByLabel('NPC source', { exact: true }).inputValue() === 'codex');
    await page.getByLabel('NPC source', { exact: true }).selectOption('vllm');
    await page.getByLabel('NPC server URL').fill(vllmUrl);
    await page.getByLabel('NPC model', { exact: true }).fill('npc-model');
    await page.getByRole('button', { name: 'New game →', exact: true }).click();
    await page.waitForFunction(() => (window as any).__ac?.store.get().view?.llm.provider === 'vllm');
    const human = await page.evaluate(() => (window as any).__ac.store.get().view);
    check('human physician starts with the selected NPC model', human.llm.model === 'npc-model' && human.driver?.kind !== 'agent');
    const badge = page.locator('.hud .llm-chip');
    await badge.getByText('● Custom API (OpenAI-compatible)', { exact: true }).waitFor();
    check('human HUD identifies the vLLM NPC connection', (await badge.getAttribute('title'))?.includes('npc-model'));
    await page.waitForSelector('.loading-screen.done', { timeout: 120_000 });
    await page.mouse.click(400, 450, { button: 'right' });
    await page.getByRole('button', { name: 'Save game', exact: true }).click();
    const slots = page.getByRole('dialog');
    await slots.locator('.slot-row').first().click();
    await slots.getByLabel('Save name').fill('Local NPC shift');
    await slots.getByRole('button', { name: 'Save game', exact: true }).click();
    await slots.waitFor({ state: 'hidden' });
    await page.evaluate(() => (window as any).__ac.client.leaveSolo());
    await page.getByLabel('NPC source', { exact: true }).selectOption('offline');
    await page.getByRole('button', { name: 'Load game', exact: true }).click();
    await slots.getByRole('button', { name: /Local NPC shift/ }).click();
    await slots.getByRole('button', { name: 'Load game', exact: true }).click();
    await badge.getByText('● Custom API (OpenAI-compatible)', { exact: true }).waitFor();
    check('loading a solo slot restores its NPC source and model independently of the new-game menu',
      (await badge.getAttribute('title'))?.includes('npc-model'));
    await page.goto(`${url}/?spectate=${codex.sessionId}`);
    await badge.getByText('● Codex SDK', { exact: true }).waitFor();
    check('Codex HUD identifies the session model', (await badge.getAttribute('title'))?.includes('gpt-6-luna'));
    check('session log identifies the Codex NPC connection', log.split('\n').some(line => line.includes('[session] ' + codex.sessionId + ' ') && line.includes('npc=codex model=gpt-6-luna')));
    check('no browser runtime errors', errors.length === 0);
    await menuStoryboard(browser, out, 'Independent NPC and physician sources', ['Desktop and narrow viewport controls fit', 'Provider independence and SDK protocol', 'vLLM HTTP and physician MCP loop', 'Saved selection and human-controlled shift', 'No browser runtime errors']);
  } catch (error) {
    for (const context of browser?.contexts() ?? []) for (const page of context.pages()) {
      console.error('Browser state:', await page.locator('body').innerText().catch(() => 'unavailable'));
    }
    console.error(log);
    throw error;
  } finally {
    await browser?.close();
    if (server && server.exitCode === null) {
      server.kill('SIGTERM');
      await new Promise<void>((resolve) => { server!.once('exit', () => resolve()); const timer = setTimeout(() => { server!.kill('SIGKILL'); resolve(); }, 5000); timer.unref(); });
    }
    fixture.closeAllConnections();
    await new Promise<void>((resolve) => fixture.close(() => resolve()));
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await sourceStoryboard();
