import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_LABEL, connectionModel, CLAUDE_NOT_INSTALLED, CLAUDE_NOT_LOGGED_IN, CODEX_LABEL, llmOptions, NO_DEFAULT_LABEL, NO_DEFAULT_NEEDS, NOTHING_ONLINE, planOnline, planPick, planWithoutClaude, startOnline, vllmFacts, type Consent, type LlmFacts } from '../server/llm/mode';
import { isLocalAddress } from '../server/llm/selection';

/** a machine with nothing set up; each test adds what it needs */
const facts = (o: Partial<LlmFacts> = {}): LlmFacts => ({
  apiKey: false,
  openaiKey: false,
  claude: { installed: false, loggedIn: false },
  optIn: false,
  codexOptIn: false,
  preferClaudeCode: false,
  codex: { ready: false, why: 'Codex is not signed in. Run `npx codex login` in this folder, then try again.' },
  vllm: { ready: false, url: 'http://127.0.0.1:8000/v1', models: [], why: 'No local model: nothing answers at http://127.0.0.1:8000/v1.' },
  ...o,
});
const loggedIn = { installed: true, loggedIn: true, subscriptionType: 'pro' };
const vllmUp = { ready: true, url: 'http://127.0.0.1:8000/v1', models: ['qwen3-8b'], model: 'qwen3-8b' };

/** the player's yes on the title screen, for this server run */
const no: Consent = { claude: false, codex: false };
const yesClaude: Consent = { claude: true, codex: false };
const yesCodex: Consent = { claude: false, codex: true };
const codexUp = { ready: true };

describe('going online from the title screen: what it uses, and what it says when it cannot', () => {
  it('nothing set up: stays offline and says how to set something up', () => {
    expect(planOnline('auto', facts(), no)).toEqual({ ok: false, error: NOTHING_ONLINE });
    // (started with --llm offline: the switch still works, by the same order as auto)
    expect(planOnline('offline', facts(), no)).toEqual({ ok: false, error: NOTHING_ONLINE });
  });

  it('Claude Code installed but not logged in: says to log in (not "nothing set up")', () => {
    const p = planOnline('auto', facts({ claude: { installed: true, loggedIn: false } }), no);
    expect(p.ok).toBe(false);
    expect(!p.ok && p.error).toMatch(/not logged in.*run `claude`/);
  });

  it('your API key comes first, and never asks about Claude Code', () => {
    expect(planOnline('auto', facts({ apiKey: true, claude: loggedIn, vllm: vllmUp, codex: codexUp }), no)).toMatchObject({ ok: true, use: 'api' });
  });

  it('AGENTCLINIC_PREFER_CLAUDE_CODE puts your Claude Code login ahead of the key, as at startup (only with your yes)', () => {
    expect(planOnline('auto', facts({ apiKey: true, claude: loggedIn, optIn: true, preferClaudeCode: true }), no)).toMatchObject({ ok: true, use: 'claude-code' });
    expect(planOnline('auto', facts({ apiKey: true, claude: loggedIn, preferClaudeCode: true }), yesClaude)).toMatchObject({ ok: true, use: 'claude-code' });
    // (without the yes it never asks: the key, as before)
    expect(planOnline('auto', facts({ apiKey: true, claude: loggedIn, preferClaudeCode: true }), no)).toMatchObject({ ok: true, use: 'api' });
    // (not logged in: the key)
    expect(planOnline('auto', facts({ apiKey: true, claude: { installed: true, loggedIn: false }, optIn: true, preferClaudeCode: true }), no)).toMatchObject({ ok: true, use: 'api' });
  });

  it('the options list and "Online would use" name each LLM the same way, and say what is missing', () => {
    const p = planOnline('auto', facts({ claude: loggedIn, optIn: true }), no);
    expect(llmOptions(facts({ claude: loggedIn, optIn: true }), no).claude).toEqual({ ready: true, use: 'claude-code', label: p.ok ? p.label : '', needsConsent: false, plan: true });
    expect(llmOptions(facts({ claude: loggedIn }), no).claude.needsConsent).toBe(true);
    expect(llmOptions(facts({ claude: loggedIn }), yesClaude).claude.needsConsent).toBe(false);
    expect(llmOptions(facts(), no).claude).toEqual({ ready: false, use: 'claude-code', hint: CLAUDE_NOT_INSTALLED });
    expect(llmOptions(facts({ claude: { installed: true, loggedIn: false } }), no).claude).toEqual({ ready: false, use: 'claude-code', hint: CLAUDE_NOT_LOGGED_IN });
    expect(llmOptions(facts({ apiKey: true, claude: loggedIn }), no).api).toMatchObject({ ready: true, use: 'api', label: 'Key configured · ANTHROPIC_API_KEY' });
    expect(llmOptions(facts({ vllm: vllmUp }), no).vllm).toEqual({ ready: true, use: 'vllm', label: 'qwen3-8b' });
    const codexPlan = planOnline('auto', facts({ codex: codexUp }), yesCodex);
    expect(llmOptions(facts({ codex: codexUp }), no).codex).toEqual({ ready: true, use: 'codex', label: codexPlan.ok ? codexPlan.label : '', needsConsent: true });
    expect(llmOptions(facts({ codex: codexUp }), yesCodex).codex.needsConsent).toBe(false);
  });

  it('shows Claude login and Anthropic API independently, without changing startup priority', () => {
    const both = facts({ apiKey: true, claude: loggedIn, optIn: true });
    expect(planOnline('claude-code', both, no)).toMatchObject({ ok: true, use: 'claude-code' });
    expect(llmOptions(both, no).claude).toMatchObject({ ready: true, use: 'claude-code', needsConsent: false });
    expect(llmOptions(both, no).api).toMatchObject({ ready: true, use: 'api', label: 'Key configured · ANTHROPIC_API_KEY' });
    expect(llmOptions(facts({ apiKey: true }), no).claude.ready).toBe(false);
    expect(llmOptions(facts({ claude: loggedIn }), no).api.ready).toBe(false);
  });

  it('keeps API-key detection distinct from login detection and supports API-only setups', () => {
    const apiOnly = facts({ openaiKey: true });
    const options = llmOptions(apiOnly, no);
    expect(options.openai).toMatchObject({ ready: true, use: 'openai-api', label: expect.stringContaining('Key configured') });
    expect(options.api.ready).toBe(false);
    expect(options.codex.ready).toBe(false);
    expect(options.none.ready).toBe(true);
    expect(planPick('openai-api', apiOnly, no)).toMatchObject({ ok: true, use: 'openai-api' });
    expect(planPick('openai-api', facts(), no)).toMatchObject({ ok: false });
    // Detecting a new API key does not silently select a billed default.
    expect(planOnline('auto', apiOnly, no)).toMatchObject({ ok: true, use: 'none' });
    expect(planPick('none', facts({ apiKey: true }), no)).toMatchObject({ ok: true });
  });

  it('"no default" is a choice only when a shift could pick Codex or a local model', () => {
    expect(llmOptions(facts(), no).none).toEqual({ ready: false, use: 'none', hint: NO_DEFAULT_NEEDS });
    expect(llmOptions(facts({ vllm: vllmUp }), no).none).toMatchObject({ ready: true, use: 'none' });
    expect(llmOptions(facts({ codex: codexUp }), no).none).toMatchObject({ ready: true, use: 'none' });
  });

  it('Claude Code logged in with your standing choice: straight online', () => {
    expect(planOnline('auto', facts({ claude: loggedIn, optIn: true }), no)).toMatchObject({ ok: true, use: 'claude-code', label: expect.stringMatching(/Pro plan/) });
  });

  it('Claude Code logged in without that choice: asks first (even with Codex or a local model ready), and a yes goes online', () => {
    expect(planOnline('auto', facts({ claude: loggedIn }), no)).toMatchObject({ ok: false, consent: true, use: 'claude-code' });
    expect(planOnline('auto', facts({ claude: loggedIn, vllm: vllmUp }), no)).toMatchObject({ ok: false, consent: true, use: 'claude-code' });
    expect(planOnline('auto', facts({ claude: loggedIn }), yesClaude)).toMatchObject({ ok: true, use: 'claude-code' });
    // (a yes to Codex is not a yes to Claude Code)
    expect(planOnline('auto', facts({ claude: loggedIn }), yesCodex)).toMatchObject({ ok: false, consent: true, use: 'claude-code' });
  });

  it('no Claude: a local model is the default, with no question', () => {
    expect(planOnline('auto', facts({ vllm: vllmUp }), no)).toEqual({ ok: true, use: 'vllm', label: 'Custom API · qwen3-8b' });
    // (Claude not logged in doesn't block that)
    expect(planOnline('auto', facts({ claude: { installed: true, loggedIn: false }, vllm: vllmUp }), no)).toMatchObject({ ok: true, use: 'vllm' });
  });

  it('no Claude and no local model: Codex is the default, asked first like Claude Code', () => {
    expect(planOnline('auto', facts({ codex: codexUp }), no)).toMatchObject({ ok: false, consent: true, use: 'codex', label: CODEX_LABEL });
    expect(planOnline('auto', facts({ codex: codexUp }), yesCodex)).toEqual({ ok: true, use: 'codex', label: CODEX_LABEL });
    expect(planOnline('offline', facts({ claude: { installed: true, loggedIn: false }, codex: codexUp }), yesCodex)).toMatchObject({ ok: true, use: 'codex' });
  });

  it('Codex asks like Claude Code: once per run, never with the standing choice ("codex": true or asking for codex at startup)', () => {
    // (the standing choice: no question, in the auto order and in the picker, and the list says so)
    expect(planOnline('auto', facts({ codex: codexUp, codexOptIn: true }), no)).toEqual({ ok: true, use: 'codex', label: CODEX_LABEL });
    expect(planPick('codex', facts({ codex: codexUp, codexOptIn: true }), no)).toMatchObject({ ok: true, use: 'codex' });
    expect(llmOptions(facts({ codex: codexUp, codexOptIn: true }), no).codex.needsConsent).toBe(false);
    // (as for Claude Code: the standing choice never makes it the default ahead of the order)
    expect(planOnline('auto', facts({ codex: codexUp, codexOptIn: true, vllm: vllmUp }), no)).toMatchObject({ ok: true, use: 'vllm' });
    // (one login's standing choice is not the other's)
    expect(planOnline('auto', facts({ codex: codexUp, optIn: true }), no)).toMatchObject({ ok: false, consent: true, use: 'codex' });
    expect(planOnline('auto', facts({ claude: loggedIn, codexOptIn: true }), no)).toMatchObject({ ok: false, consent: true, use: 'claude-code' });
  });

  it('Codex and a local model both ready: the local model wins (free, and much quicker per line)', () => {
    expect(planOnline('auto', facts({ codex: codexUp, vllm: vllmUp }), yesCodex)).toMatchObject({ ok: true, use: 'vllm' });
    expect(planWithoutClaude(facts({ codex: codexUp, vllm: vllmUp }), no)).toMatchObject({ ok: true, use: 'vllm' });
    expect(planWithoutClaude(facts({ codex: codexUp }), no)).toMatchObject({ ok: false, consent: true, use: 'codex' });
    expect(planWithoutClaude(facts({ claude: loggedIn }), no)).toBeNull();
  });

  it('a startup choice is honoured as asked, with its own reason when it is not ready', () => {
    expect(planOnline('api', facts({ claude: loggedIn, optIn: true }), no)).toMatchObject({ ok: false, error: expect.stringMatching(/--llm api.*ANTHROPIC_API_KEY is not set/) });
    expect(planOnline('api', facts({ apiKey: true }), no)).toMatchObject({ ok: true, use: 'api' });
    // asking for claude-code (or codex) at startup is the yes: no question
    expect(planOnline('claude-code', facts({ claude: loggedIn }), no)).toMatchObject({ ok: true, use: 'claude-code' });
    expect(planOnline('claude-code', facts(), no)).toMatchObject({ ok: false, error: expect.stringMatching(/not installed/) });
    expect(planOnline('codex', facts({ codex: codexUp, vllm: vllmUp }), no)).toEqual({ ok: true, use: 'codex', label: CODEX_LABEL });
    expect(planOnline('codex', facts({ apiKey: true }), no)).toMatchObject({ ok: false, error: expect.stringMatching(/not signed in/) });
    expect(planOnline('vllm', facts({ vllm: vllmUp }), no)).toEqual({ ok: true, use: 'vllm', label: 'Custom API · qwen3-8b' });
    expect(planOnline('vllm', facts({ apiKey: true }), no)).toMatchObject({ ok: false, error: expect.stringMatching(/nothing answers/) });
  });
});

describe('picking the default by name (the list on the title screen), offline or online', () => {
  it('any ready LLM can be picked, even when Online would pick another', () => {
    const all = facts({ apiKey: true, claude: loggedIn, optIn: true, codex: codexUp, vllm: vllmUp });
    expect(planPick('vllm', all, no)).toMatchObject({ ok: true, use: 'vllm' });
    expect(planPick('codex', all, yesCodex)).toMatchObject({ ok: true, use: 'codex' });
    expect(planPick('claude-code', all, no)).toMatchObject({ ok: true, use: 'claude-code' });
    expect(planPick('api', all, no)).toMatchObject({ ok: true, use: 'api' });
  });

  it('a login that spends your plan asks first, once per run (the standing choice counts for Claude Code)', () => {
    expect(planPick('codex', facts({ codex: codexUp }), no)).toMatchObject({ ok: false, consent: true, use: 'codex' });
    expect(planPick('claude-code', facts({ claude: loggedIn }), no)).toMatchObject({ ok: false, consent: true, use: 'claude-code' });
    expect(planPick('claude-code', facts({ claude: loggedIn }), yesClaude)).toMatchObject({ ok: true, use: 'claude-code' });
    expect(planPick('claude-code', facts({ claude: loggedIn, optIn: true }), no)).toMatchObject({ ok: true, use: 'claude-code' });
  });

  it('no default: patients and staff scripted, each shift picks Codex or a local model', () => {
    expect(planPick('none', facts({ vllm: vllmUp }), no)).toEqual({ ok: true, use: 'none', label: NO_DEFAULT_LABEL });
    expect(planPick('none', facts({ codex: codexUp }), no)).toMatchObject({ ok: true, use: 'none' });
    expect(planPick('none', facts({ apiKey: true }), no)).toMatchObject({ ok: true, use: 'none' });
  });

  it('one that is not ready says what it still needs', () => {
    expect(planPick('api', facts(), no)).toMatchObject({ ok: false, error: expect.stringMatching(/ANTHROPIC_API_KEY is not set/) });
    expect(planPick('claude-code', facts({ claude: { installed: true, loggedIn: false } }), yesClaude)).toEqual({ ok: false, error: `${CLAUDE_NOT_LOGGED_IN} Then press Check again.` });
    expect(planPick('codex', facts(), yesCodex)).toMatchObject({ ok: false, error: expect.stringMatching(/not signed in/) });
    expect(planPick('vllm', facts(), no)).toMatchObject({ ok: false, error: expect.stringMatching(/nothing answers/) });
  });
});


describe('what this computer offers', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  it('uses custom URL/model defaults and a menu override without changing the environment', async () => {
    vi.stubEnv('LOCAL_API_URL', 'https://custom.example:8443/api/v1');
    vi.stubEnv('LOCAL_API_MODEL', 'environment-model');
    vi.stubEnv('LOCAL_API_KEY', 'fixture-custom');
    const fetch = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'environment-model' }, { id: 'menu-model' }] })));
    vi.stubGlobal('fetch', fetch);
    expect((await vllmFacts()).model).toBe('environment-model');
    expect(fetch.mock.calls[0]).toEqual(['https://custom.example:8443/api/v1/models', expect.objectContaining({ headers: { authorization: 'Bearer fixture-custom' }, redirect: 'error' })]);
    const config = { baseUrl: 'https://another.example:9000/custom/v1/', model: 'menu-model' };
    const selected = await vllmFacts(config);
    expect(selected).toMatchObject({ url: 'https://another.example:9000/custom/v1', model: 'menu-model' });
    const provider = await startOnline('vllm', facts({ vllm: selected }));
    expect(provider?.status.model).toBe('menu-model');
    provider?.dispose();
    expect(process.env.LOCAL_API_URL).toBe('https://custom.example:8443/api/v1');
    expect(process.env.LOCAL_API_MODEL).toBe('environment-model');
    // An empty menu model means auto-selection, not the environment's model.
    expect((await vllmFacts({ baseUrl: config.baseUrl })).model).toBeUndefined();
    fetch.mockResolvedValue(new Response(JSON.stringify({ data: [{ id: 'only-model' }] })));
    expect((await vllmFacts({ baseUrl: config.baseUrl })).model).toBe('only-model');
  });

  it('does not read the old URL or model environment names', async () => {
    vi.stubEnv('LOCAL_API_URL', undefined);
    vi.stubEnv('LOCAL_API_MODEL', undefined);
    vi.stubEnv('AGENTCLINIC_VLLM_URL', 'https://old.example/v1');
    vi.stubEnv('AGENTCLINIC_VLLM_MODEL', 'old-model');
    const fetch = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'only-model' }] })));
    vi.stubGlobal('fetch', fetch);
    expect(await vllmFacts()).toMatchObject({ url: 'http://127.0.0.1:8000/v1', model: 'only-model' });
  });
  it('a malformed LOCAL_API_URL rules out the local model only (it used to make the whole check fail)', async () => {
    vi.stubEnv('LOCAL_API_URL', 'localhost:8000/v1');
    const v = await vllmFacts();
    expect(v).toMatchObject({ ready: false, url: 'localhost:8000/v1', models: [] });
    expect(v.why).toMatch(/LOCAL_API_URL .* is not usable/);
  });

  it('a vLLM server with several models: usable per shift, but the default model has to be named (it used to offer a default that then failed to start)', async () => {
    const served = http.createServer((_req, res) => res.end(JSON.stringify({ data: [{ id: 'qwen3-8b' }, { id: 'llama-4-scout' }] })));
    await new Promise<void>((r) => served.listen(0, '127.0.0.1', r));
    try {
      vi.stubEnv('LOCAL_API_URL', `http://127.0.0.1:${(served.address() as AddressInfo).port}/v1`);
      vi.stubEnv('LOCAL_API_MODEL', '');
      const two = await vllmFacts();
      expect(two).toMatchObject({ ready: true, models: ['qwen3-8b', 'llama-4-scout'] });
      expect(two.model).toBeUndefined();
      expect(two.modelWhy).toMatch(/serves 2 models \(qwen3-8b, llama-4-scout\).*LOCAL_API_MODEL/);
      // Online goes on to Codex instead of failing on the local model; Use on it says what to do; a shift can still pick it
      expect(planOnline('auto', facts({ vllm: two, codex: codexUp }), yesCodex)).toMatchObject({ ok: true, use: 'codex' });
      // with nothing else: online with no default, as before (not "No LLM is set up")
      expect(planOnline('auto', facts({ vllm: two }), no)).toEqual({ ok: true, use: 'none', label: NO_DEFAULT_LABEL });
      // and the Claude Code question offers that too ("Online without Claude"), not nothing
      expect(planWithoutClaude(facts({ vllm: two }), no)).toEqual({ ok: true, use: 'none', label: NO_DEFAULT_LABEL });
      expect(planWithoutClaude(facts({ vllm: two, codex: codexUp }), no)).toMatchObject({ use: 'codex' });
      expect(planPick('vllm', facts({ vllm: two }), no)).toEqual({ ok: false, error: two.modelWhy });
      expect(llmOptions(facts({ vllm: two }), no).vllm).toEqual({ ready: false, use: 'vllm', hint: two.modelWhy });
      expect(llmOptions(facts({ vllm: two }), no).none.ready).toBe(true);

      // named: that one, in the label and in the provider
      vi.stubEnv('LOCAL_API_MODEL', 'llama-4-scout');
      const named = await vllmFacts();
      expect(named.model).toBe('llama-4-scout');
      expect(planOnline('auto', facts({ vllm: named }), no)).toEqual({ ok: true, use: 'vllm', label: 'Custom API · llama-4-scout' });
      expect((await startOnline('vllm', facts({ vllm: named })))?.status.model).toBe('llama-4-scout');

      // named but not served: says so
      vi.stubEnv('LOCAL_API_MODEL', 'gpt-oss-20b');
      const wrong = await vllmFacts();
      expect(wrong).toMatchObject({ ready: true });
      expect(wrong.model).toBeUndefined();
      expect(wrong.modelWhy).toMatch(/Selected model is "gpt-oss-20b", but .* serves qwen3-8b, llama-4-scout/);
    } finally {
      served.close();
    }
  });
});

describe('default connection model selection', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('keeps defaults and editable model IDs separate from display labels', () => {
    vi.stubEnv('AGENTCLINIC_MODEL', undefined);
    vi.stubEnv('AGENTCLINIC_CODEX_NPC_MODEL', undefined);
    expect(connectionModel('claude-code')).toBe('haiku');
    expect(connectionModel('api')).toBe('claude-haiku-5-5');
    expect(connectionModel('codex')).toBe('gpt-6-luna');
    expect(connectionModel('openai-api')).toBe('gpt-6-luna');
    expect(connectionModel('api', 'sonnet')).toBe('claude-sonnet-5-5');
    expect(connectionModel('claude-code', 'sonnet')).toBe('sonnet');
    vi.stubEnv('AGENTCLINIC_MODEL', 'claude-opus-5-5');
    vi.stubEnv('AGENTCLINIC_CODEX_NPC_MODEL', 'gpt-6.1-sol');
    expect(connectionModel('api')).toBe('claude-opus-5-5');
    expect(connectionModel('claude-code')).toBe('claude-opus-5-5');
    expect(connectionModel('codex')).toBe('gpt-6.1-sol');
    expect(connectionModel('codex', 'chosen-model')).toBe('chosen-model');
  });

  it('passes chosen models to the existing adapters without generating replies', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'fixture-only');
    const f = facts({ apiKey: true, claude: loggedIn, codex: codexUp });
    const api = await startOnline('api', f, 'sonnet');
    const claude = await startOnline('claude-code', f, 'opus');
    const codex = await startOnline('codex', f, 'gpt-6.1-sol');
    try {
      expect(api?.status).toMatchObject({ provider: 'anthropic-api', model: 'claude-sonnet-5-5' });
      expect(claude?.status).toMatchObject({ provider: 'claude-code', model: 'opus' });
      expect(codex?.status).toMatchObject({ provider: 'codex', model: 'gpt-6.1-sol' });
    } finally { api?.dispose(); claude?.dispose(); codex?.dispose(); }
    // Choosing a model must not bypass the login consent decision.
    expect(planPick('claude-code', f, no)).toMatchObject({ ok: false, consent: true });
    expect(planPick('codex', f, no)).toMatchObject({ ok: false, consent: true });
  });
});

describe('only the computer running the game can switch', () => {
  it('this computer (IPv4, IPv6, IPv4-mapped) yes; another one on the network no', () => {
    for (const a of ['127.0.0.1', '127.0.0.2', '::1', '::ffff:127.0.0.1']) expect(isLocalAddress(a)).toBe(true);
    for (const a of ['10.147.154.186', '192.168.1.20', '::ffff:192.168.1.20', 'fe80::1', '', undefined]) expect(isLocalAddress(a)).toBe(false);
  });
});
