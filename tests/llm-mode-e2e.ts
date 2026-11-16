/**
 * The title screen's switch on a real server, with a fixture vLLM (no paid calls, runs on Windows too):
 * from Offline, pick the local model as the default; while Online, change it (no default, then the
 * local model again) with no restart and no trip through Offline; a new shift's NPCs and the Quiz
 * Duel rival follow it. Both CLI logins are stubs; no real login or model generation is used.
 *
 *   npx tsx tests/llm-mode-e2e.ts
 */
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const tmp = mkdtempSync(path.join(tmpdir(), 'ac-llm-mode-e2e-'));
let server: ChildProcess | undefined;
let log = '';
let calls = 0;
/** the one model the fixture serves (vLLM restarted with another: set it) */
let served = 'npc-model';
/** the model the game last asked the fixture for */
let asked = '';
let askedPath = '';
const fixture = http.createServer(async (req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.url?.startsWith('/unavailable/')) { res.statusCode = 401; return res.end('{}'); }
  if (req.url === '/custom/v1/models') return res.end(JSON.stringify({ data: [{ id: served }, { id: 'custom-second' }] }));
  if (req.url === '/openai/v1/models') return res.end(JSON.stringify({ data: [{ id: 'gpt-6-luna' }, { id: 'openai-second' }] }));
  if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: served }] }));
  let raw = '';
  for await (const chunk of req) raw += chunk;
  calls++;
  asked = (JSON.parse(raw) as { model: string }).model;
  askedPath = req.url ?? '';
  const message = { role: 'assistant', content: JSON.stringify({ say: 'I feel unwell.', emotion: 'neutral', revealed: [], counseled: [], actions: [] }) };
  res.end(JSON.stringify({ choices: [{ message }], usage: { prompt_tokens: 100, completion_tokens: 20 } }));
});
const check = (name: string, condition: unknown) => {
  assert.ok(condition, name);
  console.log(`✓ ${name}`);
};

try {
  await new Promise<void>((resolve, reject) => {
    fixture.once('error', reject);
    fixture.listen(0, '127.0.0.1', resolve);
  });
  const vllmUrl = `http://127.0.0.1:${(fixture.address() as { port: number }).port}/v1`;
  const port = 7600 + Math.floor(Math.random() * 90);
  const url = `http://127.0.0.1:${port}`;
  // CLI availability is controlled by this fixture, never by the player's own login.
  const readyFlag = path.join(tmp, 'logins-ready');
  const signedOut = path.join(tmp, 'codex-signed-out.mjs');
  writeFileSync(signedOut, `#!/usr/bin/env node\nimport { existsSync } from 'node:fs';\nprocess.exit(existsSync(${JSON.stringify(readyFlag)}) ? 0 : 1);\n`);
  chmodSync(signedOut, 0o755);
  // Stub Claude auth on every platform, and intercept OpenAI in this child only.
  const preload = path.join(tmp, 'openai-fixture.mjs');
  writeFileSync(preload, `import cp from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    import { existsSync } from 'node:fs';
    const execFile = cp.execFile;
    cp.execFile = function(cmd, args, options, callback) {
      if (cmd !== 'fixture-claude') return execFile.apply(this, arguments);
      queueMicrotask(() => callback(null, JSON.stringify({ loggedIn: existsSync(${JSON.stringify(readyFlag)}), authMethod: 'claude.ai', subscriptionType: 'pro' }), ''));
      return {};
    };
    syncBuiltinESMExports();
    const original = globalThis.fetch;
    globalThis.fetch = (url, init) => String(url).startsWith('https://api.openai.com/v1/')
      ? original(String(url).replace('https://api.openai.com/v1', ${JSON.stringify(vllmUrl.replace('/v1', '/openai/v1'))}), init)
      : String(url).startsWith('http://127.0.0.1:') ? original(url, init) : Promise.reject(new Error('Unexpected external request in fixture'));`);
  const env: Record<string, string | undefined> = { ...process.env, ANTHROPIC_API_KEY: 'fixture-anthropic', AGENTCLINIC_CLAUDE_BIN: 'fixture-claude', OPENAI_API_KEY: 'fixture-openai', LOCAL_API_KEY: 'fixture-custom', AGENTCLINIC_CODEX_BIN: signedOut, LOCAL_API_URL: vllmUrl, AGENTCLINIC_SAVE_DIR: path.join(tmp, 'saves'), AGENTCLINIC_USAGE_FILE: path.join(tmp, 'usage.json') };
  delete env.AGENTCLINIC_MODEL;
  delete env.AGENTCLINIC_CODEX_NPC_MODEL;
  delete env.LOCAL_API_MODEL;
  server = spawn(process.execPath, ['--import', pathToFileURL(preload).href, '--import', 'tsx', 'server/index.ts', '--dev', '--port', String(port), '--llm', 'offline', '--tts', 'off'], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env });
  server.stdout?.on('data', (d) => (log += d));
  server.stderr?.on('data', (d) => (log += d));
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(log || 'Server startup timed out.')), 30_000);
    server!.once('error', reject);
    server!.on('message', () => {
      clearTimeout(timer);
      resolve();
    });
    server!.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Server exited ${code}: ${log}`));
    });
  });
  const call = async (route: string, body?: unknown) => {
    const r = await fetch(url + route, body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, body: (await r.json()) as any };
  };
  const ok = async (route: string, body?: unknown) => {
    const r = await call(route, body);
    assert.ok(r.status >= 200 && r.status < 300, `${route}: HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
    return r.body;
  };

  let mode = await ok('/api/llm-mode');
  check('starts offline, with the local model ready in the list', mode.online === false && mode.current === null && mode.options.vllm.ready && mode.options.vllm.use === 'vllm');
  check('"No default" is offered (a shift could pick the local model)', mode.options.none.ready === true);
  check('startup API priority is unchanged', mode.onlineWith?.use === 'api' && !mode.onlineWith.needsConsent);

  mode = await ok('/api/llm-mode', { online: true, use: 'vllm' });
  check('Use on the local model goes online with it as the default', mode.online === true && mode.current === 'vllm' && mode.status.provider === 'vllm' && mode.status.model === 'npc-model');
  check('the answer to a switch carries the list, with the default marked', mode.options?.vllm.ready === true);
  check('online with a default, a plain menu load checks nothing', (await ok('/api/llm-mode')).options === null);
  check('opening the picker online lists the options', (await ok('/api/llm-mode?options=1')).options?.vllm.ready === true);

  check('removed Duel endpoint stays unavailable', (await call('/api/duel')).status === 404);

  const shift = await ok('/api/sessions', { mapId: 'night_shift' });
  await ok(`/api/sessions/${shift.sessionId}/act`, { action: { type: 'wait', minutes: 6 } });
  await ok(`/api/sessions/${shift.sessionId}/act`, { action: { type: 'move', to: 'bed_4' } });
  const before = calls;
  const talked = await ok(`/api/sessions/${shift.sessionId}/act`, { action: { type: 'talk', npcId: 'pt_p_brunner', text: 'Does it burn when you pass urine?' } });
  const usage = await ok(`/api/sessions/${shift.sessionId}/usage`);
  check('a new shift talks through the default local model', talked.result.ok && calls > before && usage.provider === 'vllm');

  mode = await ok('/api/llm-mode', { online: true, use: 'none' });
  check('while online, No default takes effect at once (no Offline in between)', mode.online === true && mode.current === 'none' && mode.status.label === 'Online · no default LLM');
  check('online with no default, the list shows anyway', mode.options?.vllm.ready === true && (await ok('/api/llm-mode')).options !== null);
  const scripted = await ok('/api/sessions', { mapId: 'night_shift' });
  check('the shift started before keeps its brain', (await ok(`/api/sessions/${shift.sessionId}/usage`)).provider === 'vllm');
  check('a shift started now has scripted NPCs', (await ok(`/api/sessions/${scripted.sessionId}/usage`)).provider === 'offline');

  mode = await ok('/api/llm-mode', { online: true, use: 'vllm' });
  check('and back to the local model, still online', mode.current === 'vllm');
  check('the same pick again changes nothing', (await ok('/api/llm-mode', { online: true, use: 'vllm' })).current === 'vllm');

  // vLLM restarted with another model: the default still runs the old one until Use takes the new one
  served = 'other-model';
  mode = await ok('/api/llm-mode?options=1&refresh=1');
  check('vLLM serves another model now: the list names it, the default is still the old one', mode.options.vllm.label === 'other-model' && mode.status.model === 'npc-model');
  mode = await ok('/api/llm-mode', { online: true, use: 'vllm' });
  check('Use on it takes the new model (it used to keep asking vLLM for the old one)', mode.current === 'vllm' && mode.status.model === 'other-model');
  const talk = async (sessionId: string) => {
    asked = '';
    await ok(`/api/sessions/${sessionId}/act`, { action: { type: 'talk', npcId: 'pt_p_brunner', text: 'Any fever or chills?' } });
    return asked;
  };
  const swapped = await ok('/api/sessions', { mapId: 'night_shift' });
  await ok(`/api/sessions/${swapped.sessionId}/act`, { action: { type: 'wait', minutes: 6 } });
  await ok(`/api/sessions/${swapped.sessionId}/act`, { action: { type: 'move', to: 'bed_4' } });
  check('a new shift asks vLLM for the new model', (await talk(swapped.sessionId)) === 'other-model');
  check('the shift started before keeps the model it started with', (await talk(shift.sessionId)) === 'npc-model');

  check('OpenAI key is detected separately from both CLI logins', mode.options.openai.ready && mode.options.openai.use === 'openai-api' && mode.options.api.ready);
  check('invalid OpenAI model input is rejected', (await call('/api/llm-mode', { online: true, use: 'openai-api', model: '--bad model' })).status === 400);
  mode = await ok('/api/llm-mode', { online: true, use: 'openai-api', model: 'gpt-6-luna' });
  check('OpenAI is a distinct default', mode.current === 'openai-api' && mode.status.model === 'gpt-6-luna');
  const openaiShift = await ok('/api/sessions', { mapId: 'night_shift' });
  await ok(`/api/sessions/${openaiShift.sessionId}/act`, { action: { type: 'wait', minutes: 6 } });
  await ok(`/api/sessions/${openaiShift.sessionId}/act`, { action: { type: 'move', to: 'bed_4' } });
  check('OpenAI default reaches patient dialogue', (await talk(openaiShift.sessionId)) === 'gpt-6-luna');
  const openaiUsage = await ok(`/api/sessions/${openaiShift.sessionId}/usage`);
  check('OpenAI reports estimated API cost with token usage', openaiUsage.provider === 'openai-api' && openaiUsage.costAvailable !== false && openaiUsage.session.costUSD > 0 && openaiUsage.session.openaiPricedCalls > 0 && !openaiUsage.apiEquivalent);
  mode = await ok('/api/llm-mode', { online: true, use: 'openai-api', model: 'openai-second' });
  check('changing the OpenAI default model takes effect', mode.status.model === 'openai-second');
  check('existing OpenAI shift keeps its original model', (await talk(openaiShift.sessionId)) === 'gpt-6-luna');
  check('existing custom shift remains independent of OpenAI', (await talk(shift.sessionId)) === 'npc-model');
  const explicit = await ok('/api/sessions', { mapId: 'night_shift', npc: { source: 'openai-api', model: 'gpt-6-luna' } });
  check('per-shift OpenAI selection overrides the default model', (await ok(`/api/sessions/${explicit.sessionId}/usage`)).provider === 'openai-api');

  const codex = await call('/api/llm-mode', { online: true, use: 'codex' });
  check('Codex when it is not ready: refused with the reason, and the default stays', codex.status === 503 && typeof codex.body.error === 'string' && (await ok('/api/llm-mode')).current === 'openai-api');
  check('a bad pick is refused', (await call('/api/llm-mode', { online: true, use: 'gpt' })).status === 400);
  check('a bad consent is refused', (await call('/api/llm-mode', { online: true, use: 'vllm', consent: 'yes' })).status === 400);

  mode = await ok('/api/llm-mode', { online: false });
  check('Offline again', mode.online === false && mode.current === null);
  // (and the same from Offline: the model vLLM serves now, not the provider made before)
  served = 'npc-model';
  mode = await ok('/api/llm-mode', { online: true, use: 'vllm' });
  check('going online again runs the model vLLM serves now', mode.status.model === 'npc-model');
  await ok('/api/llm-mode', { online: false });
  check('the switch was logged', /Default LLM changed on the title screen: Online · no default LLM/.test(log) && /Switched online on the title screen: Custom API · npc-model/.test(log));

  const customUrl = vllmUrl.replace('/v1', '/custom/v1');
  const unchangedCalls = calls;
  mode = await ok('/api/llm-mode', { online: true, use: 'vllm', baseUrl: customUrl + '/', model: 'npc-model' });
  check('custom URL and model can be entered while offline, with a metadata-only check', mode.current === 'vllm' && mode.custom.baseUrl === customUrl && calls === unchangedCalls);
  check('Check again retains the custom URL rather than reverting to the environment', (await ok('/api/llm-mode?options=1&refresh=1')).custom.baseUrl === customUrl);
  const customShift = await ok('/api/sessions', { mapId: 'night_shift' });
  await ok(`/api/sessions/${customShift.sessionId}/act`, { action: { type: 'wait', minutes: 6 } });
  await ok(`/api/sessions/${customShift.sessionId}/act`, { action: { type: 'move', to: 'bed_4' } });
  await talk(customShift.sessionId);
  check('a new endpoint with the same model creates a new connection', askedPath === '/custom/v1/chat/completions');
  await talk(shift.sessionId);
  check('an existing shift keeps its old URL', askedPath === '/v1/chat/completions');
  for (const baseUrl of ['file:///tmp/model', 'https://user:password@example.com/v1', customUrl + '?key=example']) {
    check('invalid or credential-bearing custom URL is rejected', (await call('/api/llm-mode', { online: true, use: 'vllm', baseUrl })).status === 400);
  }
  check('a custom URL cannot redirect the OpenAI connection', (await call('/api/llm-mode', { online: true, use: 'openai-api', baseUrl: customUrl })).status === 400);
  check('an unavailable model is refused', (await call('/api/llm-mode', { online: true, use: 'vllm', baseUrl: customUrl, model: 'missing-model' })).status === 503);
  check('multiple models require a choice', (await call('/api/llm-mode', { online: true, use: 'vllm', baseUrl: customUrl, model: '' })).status === 503);
  check('a failed connection is refused', (await call('/api/llm-mode', { online: true, use: 'vllm', baseUrl: vllmUrl.replace('/v1', '/unavailable/v1') })).status === 503);
  mode = await ok('/api/llm-mode?options=1');
  check('failed changes keep the working default and configuration', mode.status.model === 'npc-model' && mode.custom.baseUrl === customUrl);
  await talk(customShift.sessionId);
  check('the working shift still reaches its API after failed changes', askedPath === '/custom/v1/chat/completions');
  mode = await ok('/api/llm-mode', { online: true, use: 'vllm', baseUrl: customUrl, model: 'custom-second' });
  check('the model can be changed on the same custom endpoint', mode.status.model === 'custom-second');
  await ok('/api/llm-mode', { online: false });
  mode = await ok('/api/llm-mode', { online: true, use: 'vllm' });
  check('Offline and Online retain the selected custom URL and model', mode.custom.baseUrl === customUrl && mode.status.model === 'custom-second');
  await ok('/api/llm-mode', { online: false });
  // Model edits must replace the cached provider for each login/API, not just OpenAI/custom.
  writeFileSync(readyFlag, 'ready');
  mode = await ok('/api/llm-mode?options=1&refresh=1');
  check('Claude editable default is an ID rather than the display label', mode.options.claude.model === 'haiku');
  const beforeModels = calls;
  for (const [use, key, first, second, firstStatus] of [
    ['api', 'api', 'haiku', 'sonnet', 'claude-haiku-5-5'],
    ['claude-code', 'claude', 'haiku', 'opus', 'Claude Haiku (latest)'],
    ['codex', 'codex', 'gpt-6-luna', 'gpt-6.1-sol', 'gpt-6-luna'],
  ]) {
    const consent = use === 'api' ? undefined : use;
    if (mode.options[key].needsConsent) {
      const refused = await call('/api/llm-mode', { online: true, use, model: first });
      check(`${use}: choosing a model does not bypass consent`, refused.status === 409 && refused.body.needsConsent);
    }
    mode = await ok('/api/llm-mode', { online: true, use, model: first, consent });
    check(`${use}: first model applied`, mode.status.model === firstStatus);
    const pinned = await ok('/api/sessions', { mapId: 'night_shift' });
    mode = await ok('/api/llm-mode', { online: true, use, model: second });
    check(`${use}: model edit replaces the cached provider`, mode.status.model === (use === 'api' ? 'claude-sonnet-5-5' : second));
    check(`${use}: the editor receives the selected model ID`, mode.options[key].model === (use === 'api' ? 'claude-sonnet-5-5' : second));
    check(`${use}: existing shift retains its original model`, (await ok(`/api/sessions/${pinned.sessionId}`)).view.llm.model === firstStatus);
    const next = await ok('/api/sessions', { mapId: 'night_shift' });
    check(`${use}: new shift uses the edited model`, (await ok(`/api/sessions/${next.sessionId}`)).view.llm.model === mode.status.model);
    check(`${use}: invalid model is rejected`, (await call('/api/llm-mode', { online: true, use, model: 'invalid model!' })).status === 400);
    await ok('/api/llm-mode', { online: false });
    check(`${use}: Offline preserves existing shifts`, (await ok(`/api/sessions/${next.sessionId}`)).view.llm.model === mode.status.model);
    mode = await ok('/api/llm-mode?options=1');
  }
  check('model setup made no generation calls', calls === beforeModels);
  console.log('llm-mode e2e: all checks passed');
} catch (e) {
  console.error(log);
  throw e;
} finally {
  // (stopped by its own handle, then the temp folder: Windows holds files until the process is gone)
  if (server && server.exitCode === null) {
    const gone = new Promise((r) => server!.once('exit', r));
    server.kill();
    await Promise.race([gone, new Promise((r) => setTimeout(r, 5000))]);
  }
  fixture.close();
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* left in the temp folder */
  }
}
