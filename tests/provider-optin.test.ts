/**
 * Public-release rules for NPC brains (docs/SETUP.md#claude-code):
 * auto = your own ANTHROPIC_API_KEY, else offline; the local Claude Code CLI only as an explicit,
 * personal opt-in, which also gates "Watch an AI doctor" with Claude.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { nodeVersionProblem } from '../scripts/check-node.mjs';
import { readLocalConfig } from '../server/localConfig';
import { claudeCodeOptIn, claudeCommand, codexOptIn, detectProvider, llmPreference } from '../server/llm/provider';
import { CLAUDE_DOCTOR_OPT_IN, OFFLINE_DOCTOR, ObserveManager } from '../server/observe';

const tmp = mkdtempSync(path.join(tmpdir(), 'ac-optin-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('NPC brain preference and the Claude Code opt-in', () => {
  it('resolves --llm, then AGENTCLINIC_LLM, then agentclinic.local.json, then auto', () => {
    expect(llmPreference('API', { llm: 'offline' }, { AGENTCLINIC_LLM: 'claude-code' }).want).toBe('api');
    expect(llmPreference(undefined, { llm: 'offline' }, { AGENTCLINIC_LLM: 'claude-code' }).want).toBe('claude-code');
    expect(llmPreference(undefined, { llm: 'offline' }, {}).want).toBe('offline');
    expect(llmPreference(undefined, {}, {})).toEqual({ want: 'auto', via: 'default' });
  });

  it('is off for a fresh clone, and on only when asked for explicitly', () => {
    expect(claudeCodeOptIn(undefined, {}, {})).toEqual({ allowed: false });
    expect(claudeCodeOptIn('auto', {}, {}).allowed).toBe(false);
    expect(claudeCodeOptIn('api', {}, {}).allowed).toBe(false);
    expect(claudeCodeOptIn('claude-code', {}, {})).toEqual({ allowed: true, via: '--llm claude-code' });
    expect(claudeCodeOptIn(undefined, {}, { AGENTCLINIC_LLM: 'claude-code' }).allowed).toBe(true);
    expect(claudeCodeOptIn(undefined, { claudeCode: true }, {}).allowed).toBe(true);
    expect(claudeCodeOptIn(undefined, { llm: 'claude-code' }, {}).allowed).toBe(true);
  });

  it('Codex has the same standing choice: off for a fresh clone, on only when asked for explicitly', () => {
    expect(codexOptIn(undefined, {}, {})).toEqual({ allowed: false });
    expect(codexOptIn('auto', { claudeCode: true }, {}).allowed).toBe(false);
    expect(codexOptIn('claude-code', {}, {}).allowed).toBe(false);
    expect(codexOptIn('codex', {}, {})).toEqual({ allowed: true, via: '--llm codex' });
    expect(codexOptIn(undefined, {}, { AGENTCLINIC_LLM: 'codex' }).allowed).toBe(true);
    expect(codexOptIn(undefined, { codex: true }, {})).toEqual({ allowed: true, via: '"codex": true in agentclinic.local.json' });
    expect(codexOptIn(undefined, { llm: 'codex' }, {}).allowed).toBe(true);
    // (and it is not Claude Code's)
    expect(claudeCodeOptIn(undefined, { codex: true }, {}).allowed).toBe(false);
  });

  it('reads agentclinic.local.json strictly: only claudeCode === true opts in, a broken file is ignored', () => {
    const dir = path.join(tmp, 'cfg');
    mkdirSync(dir);
    expect(readLocalConfig(dir)).toEqual({});
    writeFileSync(path.join(dir, 'agentclinic.local.json'), JSON.stringify({ claudeCode: true, llm: 'Auto' }));
    expect(readLocalConfig(dir)).toEqual({ claudeCode: true, llm: 'auto' });
    writeFileSync(path.join(dir, 'agentclinic.local.json'), JSON.stringify({ claudeCode: 'yes' }));
    expect(readLocalConfig(dir)).toEqual({});
    // (the same for Codex: only codex === true)
    writeFileSync(path.join(dir, 'agentclinic.local.json'), JSON.stringify({ codex: true }));
    expect(readLocalConfig(dir)).toEqual({ codex: true });
    writeFileSync(path.join(dir, 'agentclinic.local.json'), JSON.stringify({ codex: 'yes' }));
    expect(readLocalConfig(dir)).toEqual({});
    writeFileSync(path.join(dir, 'agentclinic.local.json'), '{ "claudeCode": true, ');
    expect(readLocalConfig(dir)).toEqual({});
  });
});

describe.skipIf(process.platform === 'win32')('detectProvider never touches Claude Code without the opt-in', () => {
  // a stand-in `claude` that records every call and reports a logged-in subscription
  const marker = path.join(tmp, 'claude-was-called');
  const fake = path.join(tmp, 'fake-claude.sh');
  const saved = { key: process.env.ANTHROPIC_API_KEY, bin: process.env.AGENTCLINIC_CLAUDE_BIN, llm: process.env.AGENTCLINIC_LLM };
  beforeAll(() => {
    writeFileSync(fake, `#!/bin/sh\ntouch "${marker}"\necho '{"loggedIn": true, "authMethod": "claude.ai", "subscriptionType": "max"}'\n`);
    chmodSync(fake, 0o755);
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.AGENTCLINIC_LLM;
    process.env.AGENTCLINIC_CLAUDE_BIN = fake;
  });
  afterAll(() => {
    for (const [k, v] of [['ANTHROPIC_API_KEY', saved.key], ['AGENTCLINIC_CLAUDE_BIN', saved.bin], ['AGENTCLINIC_LLM', saved.llm]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('auto without an API key → offline NPCs, and claude is never run', async () => {
    expect(await detectProvider(undefined, {})).toBeNull();
    expect(await detectProvider('auto', {})).toBeNull();
    expect(existsSync(marker)).toBe(false);
  });

  it('auto with an API key → the Anthropic API, still without running claude', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-placeholder'; // never sent: no chat() call is made
    try {
      const p = await detectProvider(undefined, {});
      expect(p?.status.provider).toBe('anthropic-api');
      expect(p?.billing).toBe('api');
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
    expect(existsSync(marker)).toBe(false);
  });

  it('--llm claude-code, or "claudeCode": true in the local file, uses the logged-in CLI', async () => {
    for (const [pref, local] of [['claude-code', {}], [undefined, { claudeCode: true }]] as const) {
      const p = await detectProvider(pref, local);
      expect(p?.status.provider).toBe('claude-code');
      p?.dispose();
    }
    expect(existsSync(marker)).toBe(true);
  });
});

describe('the claude binary on Windows', () => {
  it('prefers claude.exe on PATH (native installer)', () => {
    const dir = path.join(tmp, 'win-native');
    mkdirSync(dir);
    writeFileSync(path.join(dir, 'claude.exe'), '');
    expect(claudeCommand({ PATH: `${path.join(tmp, 'nothing')};${dir}` }, 'win32')).toEqual({ cmd: path.join(dir, 'claude.exe'), pre: [] });
  });

  it('resolves an npm claude.cmd shim to its real target (a .cmd cannot be spawned without a shell)', () => {
    const dir = path.join(tmp, 'win-npm');
    const pkg = path.join(dir, 'node_modules', '@anthropic-ai', 'claude-code');
    mkdirSync(pkg, { recursive: true });
    writeFileSync(path.join(dir, 'claude.cmd'), '@echo off');
    writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ bin: { claude: 'bin/claude.exe' } }));
    expect(claudeCommand({ Path: dir }, 'win32')).toEqual({ cmd: path.join(pkg, 'bin', 'claude.exe'), pre: [] });
    writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ bin: { claude: 'cli.js' } }));
    expect(claudeCommand({ PATH: dir }, 'win32')).toEqual({ cmd: process.execPath, pre: [path.join(pkg, 'cli.js')] });
    expect(claudeCommand({ AGENTCLINIC_CLAUDE_BIN: path.join(dir, 'claude.cmd') }, 'win32')).toEqual({ cmd: process.execPath, pre: [path.join(pkg, 'cli.js')] });
  });

  it('leaves macOS and Linux alone', () => {
    expect(claudeCommand({ PATH: '/usr/bin' }, 'linux')).toEqual({ cmd: 'claude', pre: [] });
    expect(claudeCommand({ AGENTCLINIC_CLAUDE_BIN: '/opt/claude' }, 'darwin')).toEqual({ cmd: '/opt/claude', pre: [] });
  });
});

describe('observe mode respects the opt-in', () => {
  const hooks = (optIn: boolean) => ({
    root: process.cwd(),
    baseUrl: 'http://127.0.0.1:1',
    runsDir: path.join(tmp, 'runs'),
    maps: () => ['night_shift'],
    createSession: () => {
      throw new Error('must not create a session');
    },
    endSession: () => {},
    note: () => {},
    claudeOptIn: () => optIn,
    claudeReady: async () => ({ ok: false, detail: 'not logged in' }),
  });

  it('refuses Claude without the opt-in and says why; the status tells the menu', async () => {
    const m = new ObserveManager(hooks(false));
    expect(await m.start({ agent: 'claude', mapId: 'night_shift' })).toEqual({ status: 403, body: { error: CLAUDE_DOCTOR_OPT_IN } });
    expect(m.status().body).toMatchObject({ running: false, claude: { allowed: false, note: CLAUDE_DOCTOR_OPT_IN } });
  });

  it('with the opt-in, goes on to the login check', async () => {
    const m = new ObserveManager(hooks(true));
    expect(await m.start({ agent: 'claude', mapId: 'night_shift' })).toEqual({ status: 503, body: { error: 'not logged in' } });
    expect(m.status().body).toMatchObject({ claude: { allowed: true }, online: true });
  });

  it('an offline server: no LLM doctor of any kind, even with the opt-in; the scripted demo still plays', async () => {
    const m = new ObserveManager({ ...hooks(true), online: () => false });
    for (const body of [{ agent: 'claude' }, { agent: 'claude', claudeConsent: true }, { agent: 'codex' }, { agent: 'vllm', baseUrl: 'http://127.0.0.1:8000/v1' }, { agent: 'claude', controlMode: 'embodied' }])
      expect(await m.start({ ...body, mapId: 'night_shift' })).toEqual({ status: 403, body: { error: OFFLINE_DOCTOR } });
    expect(m.status().body).toMatchObject({ online: false, claude: { allowed: false, note: OFFLINE_DOCTOR } });
    // the demo gets past the gate, as far as creating its session (the test's hook refuses that)
    expect(await m.start({ agent: 'demo', mapId: 'night_shift' })).toEqual({ status: 503, body: { error: 'must not create a session' } });
  });
});

describe('Node.js version gate', () => {
  it('accepts 22.12+ and explains anything older', () => {
    for (const v of ['22.12.0', '22.22.2', '23.1.0', '24.0.0', '26.1.0']) expect(nodeVersionProblem(v)).toBeNull();
    for (const v of ['22.11.0', '20.19.0', '18.20.4']) expect(nodeVersionProblem(v)).toMatch(/needs Node\.js 22\.12 or newer, but this is Node/);
  });
});
