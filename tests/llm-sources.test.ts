import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CODEX_DOCTOR_MODEL, CODEX_NPC_MODEL, parseNpcSelection, vllmUrl } from '../shared/llm';
import { CodexProvider, codexCommand, codexUsage, gameCodexOptions, strictOutputSchema } from '../server/llm/codex';
import { schemaFor } from '../server/npc/prompts';
import { VllmClient, VllmProvider } from '../server/llm/vllm';
import { codexReady, selectedProvider, requireLocalSelection } from '../server/llm/selection';
import { validateObserve, ObserveManager, type ObserveHooks } from '../server/observe';
import { UsageLedger, emptyTotals, sanitizeAgentReport } from '../server/usage';
import type { ChatRequest } from '../server/llm/provider';

const dir = mkdtempSync(path.join(tmpdir(), 'ac-sources-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
afterEach(() => vi.unstubAllEnvs());
const request = (key: string, message: string): ChatRequest => ({ key, system: 'You are a simulated patient.', history: [], message, schema: { type: 'object', properties: { say: { type: 'string' } }, required: ['say'], additionalProperties: false } });

describe('independent source selections', () => {
  it('adapts optional nurse action fields without changing Claude schemas', () => {
    const schema = schemaFor({ factIds: [], counselIds: [], actionIds: ['order'], withOrder: true, withPatient: true });
    const converted = strictOutputSchema(schema) as any;
    expect(converted.properties.actions.items.required).toEqual(['id', 'patient', 'code', 'dose']);
    expect(converted.properties.actions.items.properties.dose.anyOf).toContainEqual({ type: 'null' });
    expect((schema as any).properties.actions.items.required).toEqual(['id']);
  });
  it('keeps old defaults, resolves Luna for NPCs and Sol for physicians', () => {
    expect(parseNpcSelection(undefined)).toEqual({ source: 'default' });
    expect(parseNpcSelection({ source: 'codex' })).toEqual({ source: 'codex', model: CODEX_NPC_MODEL });
    expect(validateObserve({ agent: 'codex', npc: { source: 'vllm', model: 'local-a' } }, ['night_shift'])).toMatchObject({ ok: true, model: CODEX_DOCTOR_MODEL, npc: { source: 'vllm', model: 'local-a' } });
    expect(validateObserve({ agent: 'vllm', model: 'local-b', npc: { source: 'codex' } }, ['night_shift'])).toMatchObject({ ok: true, model: 'local-b', npc: { source: 'codex', model: CODEX_NPC_MODEL } });
    expect(validateObserve({ agent: 'claude' }, ['night_shift'])).toMatchObject({ ok: true, model: 'sonnet' });
  });
  it('preserves embodied controls with independent NPCs and clinical providers', () => {
    expect(validateObserve({ agent: 'claude', controlMode: 'embodied', camera: 'first', npc: { source: 'codex' } }, ['night_shift']))
      .toMatchObject({ ok: true, controlMode: 'embodied', camera: 'first', maxTurns: 60, npc: { source: 'codex' } });
    for (const agent of ['codex', 'vllm', 'demo']) {
      expect(validateObserve({ agent, controlMode: 'embodied' }, ['night_shift']).ok).toBe(false);
      expect(validateObserve({ agent }, ['night_shift'])).toMatchObject({ ok: true, controlMode: 'clinical' });
    }
  });
  it('rejects malformed selections and URLs containing credentials', () => {
    expect(() => parseNpcSelection({ source: 'other' })).toThrow();
    expect(() => parseNpcSelection({ source: 'codex', model: '--bad option' })).toThrow();
    expect(() => vllmUrl('file:///tmp/model')).toThrow();
    expect(() => vllmUrl('http://user:pass@localhost:8000/v1')).toThrow();
    expect(() => vllmUrl('http://localhost:8000/v1?token=secret')).toThrow();
    expect(vllmUrl('http://127.0.0.1:8000/v1/')).toBe('http://127.0.0.1:8000/v1');
    expect(validateObserve({ agent: 'vllm', baseUrl: 'bad' }, ['night_shift']).ok).toBe(false);
  });
  it('limits explicit model connections to the local computer', () => {
    expect(() => requireLocalSelection({ source: 'codex' }, '192.168.1.3')).toThrow();
    expect(() => requireLocalSelection({ source: 'vllm' }, '::1')).not.toThrow();
    expect(() => requireLocalSelection({ source: 'offline' }, '192.168.1.3')).not.toThrow();
  });
  it('returns the old server default or offline without opening a model connection', async () => {
    expect(await selectedProvider(undefined)).toBeUndefined();
    expect(await selectedProvider({ source: 'offline' })).toBeNull();
  });
});

describe('Codex SDK provider through the actual SDK process protocol', () => {
  const log = path.join(dir, 'calls.jsonl');
  const bin = path.join(dir, 'codex-fixture.mjs');
  beforeAll(() => {
    writeFileSync(bin, `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
if (args[0] === 'login') process.exit(0);
let prompt = '';
for await (const chunk of process.stdin) prompt += chunk;
appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args, prompt, inheritedKey: !!process.env.ANTHROPIC_API_KEY, preloadLeft: !!(process.env.NODE_OPTIONS || process.env.AGENTCLINIC_CODEX_PRELOAD) }) + '\\n');
const message = JSON.parse(prompt).message;
if (message === 'slow') await new Promise(r => setTimeout(r, 30000));
console.log(JSON.stringify({ type: 'thread.started', thread_id: 'fixture' }));
console.log(JSON.stringify({ type: 'item.completed', item: { id: 'reply', type: 'agent_message', text: JSON.stringify({ say: message }) } }));
console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 25, output_tokens: 12 } }));
`);
    chmodSync(bin, 0o755);
  });
  it('uses isolated SDK calls, model selection, structured output, and token counts', async () => {
    vi.stubEnv('AGENTCLINIC_CODEX_BIN', bin);
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-only-not-a-secret');
    const provider = await selectedProvider({ source: 'codex' });
    expect(provider).toBeInstanceOf(CodexProvider);
    const requests = [
      { ...request('s_a:pt_1', 'patient A'), system: 'Patient A: three days of cough.\nOnly report the supplied facts.' },
      { ...request('s_b:pt_1', 'patient B'), system: 'Patient B: brief spinning when rolling right.\nNo hearing change.' },
    ];
    const [a, b] = await Promise.all(requests.map(req => provider!.chat(req)));
    expect(a.json).toEqual({ say: 'patient A' });
    expect(b.json).toEqual({ say: 'patient B' });
    expect(a.usage).toMatchObject({ inputTokens: 75, cacheReadTokens: 25, outputTokens: 12, costSource: 'price-table', codexPricedCalls: 1 });
    const calls = readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      const req = requests.find(req => req.message === JSON.parse(call.prompt).message)!;
      expect(call.args).toContain(`developer_instructions=${JSON.stringify(req.system)}`);
      expect(call.args.some((arg: string) => arg.startsWith('base_instructions='))).toBe(false);
      expect(call.args).toEqual(expect.arrayContaining(['--ignore-user-config', '--ephemeral', '--output-schema', CODEX_NPC_MODEL]));
      expect(call.args.join(' ')).toContain('features.shell_tool=false');
      expect(call.args.join(' ')).toContain('mcp_servers={}');
      expect(call.inheritedKey).toBe(false);
    }
    provider!.dispose();
  });
  it('uses an instruction field accepted by the installed CLI for NPCs and the AI physician', () => {
    for (const mcpServers of [{}, { agentclinic: { command: process.execPath, args: ['unused-fixture'] } }]) {
      const options = gameCodexOptions('Follow the supplied simulation instructions.', mcpServers);
      expect(options.config?.developer_instructions).toBe('Follow the supplied simulation instructions.');
      expect(options.config).not.toHaveProperty('base_instructions');
      // An unknown final setting stops configuration parsing before authentication or a model call.
      const stop = 'zz_instruction_test_stop';
      const overrides = Object.entries(options.config!).flatMap(([key, value]) =>
        key.endsWith('_instructions') ? ['-c', `${key}=${JSON.stringify(value)}`] : []);
      const child = spawnSync(process.execPath, [createRequire(import.meta.url).resolve('@openai/codex/bin/codex.js'),
        'exec', '--ignore-user-config', '--strict-config', '--skip-git-repo-check', '--ephemeral',
        ...overrides, '-c', `${stop}=true`, 'No model request'],
      { cwd: dir, env: options.env, encoding: 'utf8', timeout: 5000 });
      expect(child.status).toBe(1);
      expect(child.stderr).toContain(`unknown configuration field \`${stop}\``);
    }
  });
  it('aborts an active SDK call on disposal', async () => {
    vi.stubEnv('AGENTCLINIC_CODEX_BIN', bin);
    const provider = new CodexProvider();
    const pending = provider.chat(request('s_cancel:pt_1', 'slow'));
    const rejected = expect(pending).rejects.toThrow();
    // Wait for the fixture to receive the request before testing cancellation in flight.
    await vi.waitFor(() => expect(readFileSync(log, 'utf8')).toContain('slow'), { timeout: 5000 });
    provider.dispose();
    await rejected;
  });
  it('starts through the launcher on every system: as a program, or on Windows as a Node preload', () => {
    const launcher = fileURLToPath(new URL('../scripts/codex-game.mjs', import.meta.url));
    const unix = gameCodexOptions('patient', {}, 'linux');
    expect(unix.codexPathOverride).toBe(launcher);
    expect(unix.env).not.toHaveProperty('NODE_OPTIONS');
    const windows = gameCodexOptions('patient', {}, 'win32');
    expect(windows.codexPathOverride).toBe(process.execPath);
    expect(windows.env).toMatchObject({ NODE_OPTIONS: `--import=${pathToFileURL(launcher).href}`, AGENTCLINIC_CODEX_PRELOAD: '1' });
    // Windows cannot start a .js file: Node runs such an override, and the installed CLI everywhere
    expect(codexCommand({ AGENTCLINIC_CODEX_BIN: 'C:\\tools\\codex.exe' }, 'win32')).toEqual({ cmd: 'C:\\tools\\codex.exe', pre: [] });
    expect(codexCommand({ AGENTCLINIC_CODEX_BIN: bin }, 'win32')).toEqual({ cmd: process.execPath, pre: [bin] });
    expect(codexCommand({ AGENTCLINIC_CODEX_BIN: bin }, 'linux')).toEqual({ cmd: bin, pre: [] });
    expect(codexCommand({ AGENTCLINIC_CODEX_BIN: 'C:\\tools\\codexjs' }, 'win32')).toEqual({ cmd: 'C:\\tools\\codexjs', pre: [] });
    expect(codexCommand({}, 'win32')).toEqual({ cmd: process.execPath, pre: [expect.stringMatching(/codex\.js$/)] });
  });
  it('as a Node preload, the launcher adds the isolation flags, clears its own variables and returns the exit code', () => {
    // (run here on every system, the way the SDK starts it on Windows: node exec --experimental-json …)
    const { env } = gameCodexOptions('patient', {}, 'win32');
    // (no log yet when this test runs alone)
    const read = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line)) : []);
    const before = read().length;
    const child = spawnSync(process.execPath, ['exec', '--experimental-json', '--model', 'preload-check'], { cwd: dir, env: { ...env, AGENTCLINIC_CODEX_BIN: bin }, input: JSON.stringify({ message: 'preload' }), encoding: 'utf8', timeout: 20_000 });
    expect(child.status, child.stderr).toBe(0);
    expect(child.stdout).toContain('"thread.started"');
    const calls = read();
    expect(calls).toHaveLength(before + 1);
    expect(calls.at(-1).args).toEqual(['exec', '--ignore-user-config', '--ephemeral', '--experimental-json', '--model', 'preload-check']);
    expect(calls.at(-1).preloadLeft).toBe(false);
    // a failing Codex fails the call, and another Node program that inherits the variables runs as itself
    const failing = path.join(dir, 'codex-fails.mjs');
    writeFileSync(failing, '#!/usr/bin/env node\nprocess.exit(3);\n');
    chmodSync(failing, 0o755);
    expect(spawnSync(process.execPath, ['exec', '--experimental-json'], { cwd: dir, env: { ...env, AGENTCLINIC_CODEX_BIN: failing }, input: '', encoding: 'utf8', timeout: 20_000 }).status).toBe(3);
    expect(spawnSync(process.execPath, ['-e', 'console.log("untouched")'], { cwd: dir, env, encoding: 'utf8', timeout: 20_000 }).stdout.trim()).toBe('untouched');
  });
  it('tells a Codex that cannot start from one that is not signed in', async () => {
    vi.stubEnv('AGENTCLINIC_CODEX_BIN', path.join(dir, 'no-such-codex.exe'));
    await expect(codexReady()).rejects.toThrow(/AGENTCLINIC_CODEX_BIN .* could not be started/);
    if (process.platform === 'win32') {
      // (what npm puts on the PATH there: Node will not start it without a shell)
      const shim = path.join(dir, 'codex.cmd');
      writeFileSync(shim, '@exit /b 0\r\n');
      vi.stubEnv('AGENTCLINIC_CODEX_BIN', shim);
      await expect(codexReady()).rejects.toThrow(/must be an \.exe, or a \.js or \.mjs file/);
    }
    const signedOut = path.join(dir, 'codex-signed-out.mjs');
    writeFileSync(signedOut, '#!/usr/bin/env node\nprocess.exit(1);\n');
    chmodSync(signedOut, 0o755);
    vi.stubEnv('AGENTCLINIC_CODEX_BIN', signedOut);
    await expect(codexReady()).rejects.toThrow(/not signed in/);
  });
  it('does not pass secret-bearing environment variables or enable personal tools', () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-only-not-a-secret');
    const options = gameCodexOptions('patient');
    expect(options.env).not.toHaveProperty('OPENAI_API_KEY');
    expect(options.config?.project_doc_max_bytes).toBe(0);
  });
});

describe('vLLM HTTP provider', () => {
  let server: http.Server;
  let baseUrl: string;
  const bodies: Record<string, any>[] = [];
  beforeAll(async () => {
    server = http.createServer(async (req, res) => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'test-model' }] }));
      let raw = ''; for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw); bodies.push(body);
      if (body.messages.at(-1).content === 'error') { res.statusCode = 503; return res.end('{}'); }
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify({ say: body.messages.at(-1).content }) } }], usage: { prompt_tokens: 80, completion_tokens: 10 } }));
    });
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
  });
  afterAll(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });
  it('discovers the served model and passes conversation and JSON schema', async () => {
    const provider = await selectedProvider({ source: 'vllm', baseUrl });
    expect(provider).toBeInstanceOf(VllmProvider);
    const reply = await provider!.chat(request('s_local:pt_1', 'my ankle hurts'));
    expect(reply.json).toEqual({ say: 'my ankle hurts' });
    expect(bodies.at(-1)).toMatchObject({ model: 'test-model', response_format: { type: 'json_schema' } });
    expect(reply.usage).toMatchObject({ inputTokens: 80, outputTokens: 10, costSource: 'unpriced' });
    provider!.dispose();
  });
  it('reports unavailable models and server errors', async () => {
    const client = new VllmClient(baseUrl);
    await expect(client.model('missing')).rejects.toThrow('does not serve');
    const provider = new VllmProvider(client, 'test-model');
    await expect(provider.chat(request('s_local:pt_1', 'error'))).rejects.toThrow('HTTP 503');
  });
});

describe('usage stays accurate across sources', () => {
  it('marks unpriced usage and keeps per-session Claude billing independent', () => {
    const ledger = new UsageLedger().configure({ provider: 'offline', apiEquivalent: false });
    ledger.registerSession('sub', { apiEquivalent: true });
    ledger.registerSession('api', { apiEquivalent: false });
    expect(ledger.sessionView('sub', 'claude-code').apiEquivalent).toBe(true);
    expect(ledger.sessionView('api', 'claude-code').apiEquivalent).toBe(false);
    expect(ledger.sessionView('local', 'vllm').costAvailable).toBe(false);
    expect(ledger.sessionView('codex', 'codex').costAvailable).toBe(false);
    const report = sanitizeAgentReport({ ...emptyTotals(), calls: 1, inputTokens: 1, costAvailable: false });
    expect(report?.costAvailable).toBe(false);
    expect(ledger.recordAgent('codex', report!).costAvailable).toBe(false);
    expect(codexUsage('test', null, 10)).toBeUndefined();
  });
});

describe('observe startup concurrency', () => {
  it('reserves startup while asynchronous readiness is pending', async () => {
    let resolve!: (result: { ok: boolean }) => void;
    const hooks: ObserveHooks = { root: dir, runsDir: dir, baseUrl: 'http://127.0.0.1:7001', maps: () => ['night_shift'], createSession: () => 's_test', endSession() {}, note() {}, claudeOptIn: () => true, claudeReady: () => new Promise((r) => { resolve = r; }) };
    const manager = new ObserveManager(hooks);
    const first = manager.start({ agent: 'claude' });
    expect((await manager.start({ agent: 'demo' })).status).toBe(409);
    resolve({ ok: false });
    expect((await first).status).toBe(503);
    manager.dispose();
  });
});

describe('separate OpenAI and custom API connections', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses only the selected connection key, fixed OpenAI URL, chosen model, and full role context', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-openai');
    vi.stubEnv('LOCAL_API_KEY', 'test-custom');
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-anthropic');
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(url.endsWith('/models') ? { data: [{ id: 'chosen-model' }] } : {
        choices: [{ message: { content: '{"say":"hello"}' } }],
        usage: { prompt_tokens: 100, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 25 } },
      }), { status: 200 });
    }));
    const openai = await selectedProvider({ source: 'openai-api', model: 'chosen-model', baseUrl: 'https://ignored.example/v1' });
    const custom = await selectedProvider({ source: 'vllm', model: 'chosen-model', baseUrl: 'https://custom.example:8443/api/v1' });
    try {
      const req = { ...request('shift:patient', 'where?'), system: 'Use only this patient history.', history: [{ role: 'assistant' as const, content: 'Hello.' }] };
      const result = await openai!.chat(req);
      await custom!.chat(req);
      expect(openai!.status).toMatchObject({ provider: 'openai-api', model: 'chosen-model' });
      expect(custom!.status.provider).toBe('vllm');
      expect(result.usage).toMatchObject({ inputTokens: 75, outputTokens: 10, cacheReadTokens: 25, costSource: 'unpriced' });
      expect(calls).toHaveLength(4);
      for (const call of calls) {
        const isOpenAI = call.url.startsWith('https://api.openai.com/v1/');
        expect(call.init.headers).toMatchObject({ authorization: `Bearer ${isOpenAI ? 'test-openai' : 'test-custom'}` });
        expect(call.init.redirect).toBe('error');
        if (!isOpenAI) expect(call.url).toMatch(/^https:\/\/custom.example:8443\/api\/v1\//);
        if (call.init.body) {
          const body = JSON.parse(String(call.init.body));
          expect(body.model).toBe('chosen-model');
          expect(body.messages).toEqual([{ role: 'system', content: req.system }, ...req.history, { role: 'user', content: req.message }]);
          expect(body.max_completion_tokens).toBe(1024);
          if (isOpenAI) expect(body.service_tier).toBe('default');
          else expect(body).not.toHaveProperty('service_tier');
          expect(body).not.toHaveProperty('max_tokens');
          expect(body.response_format.json_schema.strict).toBe(true);
        }
      }
      expect(process.env.LOCAL_API_KEY).toBe('test-custom');
      const parsed = parseNpcSelection(JSON.parse(JSON.stringify({ source: 'openai-api', model: 'chosen-model' })));
      expect(parsed).toEqual({ source: 'openai-api', model: 'chosen-model' });
      const ledger = new UsageLedger();
      expect(ledger.sessionView('empty', 'openai-api').costAvailable).toBe(false);
    } finally { openai?.dispose(); custom?.dispose(); }
  });

  it('does not fall back to another API key and reports rejected model access', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('LOCAL_API_KEY', '');
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-anthropic');
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => new Response('{}', { status: 401 }));
    vi.stubGlobal('fetch', fetch);
    await expect(selectedProvider({ source: 'openai-api' })).rejects.toThrow('OPENAI_API_KEY');
    expect(fetch).not.toHaveBeenCalled();
    await expect(new VllmClient('http://custom.example/v1').model()).rejects.toThrow('HTTP 401');
    expect(fetch.mock.calls[0][1].headers).not.toHaveProperty('authorization');
    vi.stubEnv('OPENAI_API_KEY', 'test-openai');
    await expect(selectedProvider({ source: 'openai-api' })).rejects.toThrow('HTTP 401');
  });
});
