/**
 * The first-run question in `npm start` (server/firstRun.ts): when it is asked (a terminal, no brain
 * chosen yet), what each answer saves in agentclinic.local.json, and that it never runs the real
 * `claude` (checkClaudeCode is a stub here). Plus --exit-when-idle (server/idleExit.ts).
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { answerConfig, firstRunSkip, parseAnswer, planFirstRun, planLabel, questionText, runFirstRun, type FirstRunInput } from '../server/firstRun';
import { DEFAULT_IDLE_MS, IdleExit, idleExitMs } from '../server/idleExit';
import type { ClaudeAuth } from '../server/llm/provider';
import { localConfigFile, readLocalConfig, writeLocalConfig, type LocalConfigFile } from '../server/localConfig';

const tmp = mkdtempSync(path.join(tmpdir(), 'ac-firstrun-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
let n = 0;
/** a fresh checkout folder, optionally with an agentclinic.local.json */
function checkout(local?: string | object): string {
  const dir = path.join(tmp, `c${++n}`);
  mkdirSync(dir);
  if (local !== undefined) writeFileSync(path.join(dir, 'agentclinic.local.json'), typeof local === 'string' ? local : JSON.stringify(local, null, 2));
  return dir;
}
const localJson = (dir: string) => JSON.parse(readFileSync(path.join(dir, 'agentclinic.local.json'), 'utf8'));

const MAX: ClaudeAuth = { installed: true, loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'max' };
const LOGGED_OUT: ClaudeAuth = { installed: true, loggedIn: false };
const MISSING: ClaudeAuth = { installed: false, loggedIn: false };
const NONE: LocalConfigFile = { state: 'missing' };

describe('when the first-run question is asked', () => {
  const base: Omit<FirstRunInput, 'check'> = { interactive: true, env: {}, local: NONE };

  it('asks only in a terminal, outside CI, with no brain chosen yet', () => {
    expect(firstRunSkip(base)).toBeNull();
    expect(firstRunSkip({ ...base, interactive: false })).toBe('not-interactive');
    expect(firstRunSkip({ ...base, env: { CI: 'true' } })).toBe('ci');
    expect(firstRunSkip({ ...base, env: { CI: '1' } })).toBe('ci');
    expect(firstRunSkip({ ...base, env: { CI: 'false' } })).toBeNull();
  });

  it('never asks over an earlier choice: --llm, AGENTCLINIC_LLM, the local file, an API key', () => {
    expect(firstRunSkip({ ...base, llmFlag: 'offline' })).toBe('llm-flag');
    expect(firstRunSkip({ ...base, env: { AGENTCLINIC_LLM: 'api' } })).toBe('llm-env');
    expect(firstRunSkip({ ...base, local: { state: 'ok', data: { llm: 'offline' } } })).toBe('local-config');
    expect(firstRunSkip({ ...base, local: { state: 'ok', data: { claudeCode: true } } })).toBe('local-config');
    expect(firstRunSkip({ ...base, local: { state: 'ok', data: { claudeCode: false } } })).toBe('local-config');
    // ("codex": true alone picks no brain: auto startup stays offline, so it still asks)
    expect(firstRunSkip({ ...base, local: { state: 'ok', data: { codex: true } } })).toBeNull();
    expect(firstRunSkip({ ...base, env: { ANTHROPIC_API_KEY: 'test-placeholder' } })).toBe('api-key');
    // a file without a choice (just a note, or an empty "llm") still asks; a broken one is never overwritten
    expect(firstRunSkip({ ...base, local: { state: 'ok', data: { '//': 'note', llm: ' ' } } })).toBeNull();
    expect(firstRunSkip({ ...base, local: { state: 'broken', error: 'x' } })).toBe('local-config-broken');
  });

  it('checks Claude Code only when it may ask, and picks the right path per auth state', async () => {
    for (const [auth, kind] of [[MAX, 'ask'], [LOGGED_OUT, 'log-in'], [MISSING, 'install']] as const) {
      const check = vi.fn(async () => auth);
      expect((await planFirstRun({ ...base, check })).kind).toBe(kind);
      expect(check).toHaveBeenCalledTimes(1);
    }
    for (const skip of [{ interactive: false }, { llmFlag: 'claude-code' }, { env: { ANTHROPIC_API_KEY: 'test-placeholder' } }, { local: { state: 'ok', data: { claudeCode: true } } as LocalConfigFile }]) {
      const check = vi.fn(async () => MAX);
      expect((await planFirstRun({ ...base, ...skip, check })).kind).toBe('skip');
      expect(check).not.toHaveBeenCalled();
    }
  });
});

describe('the question and its answers', () => {
  it('parses answers; Enter alone is the default yes', () => {
    for (const a of ['', ' ', 'y', 'Y', 'yes', 'YES ']) expect(parseAnswer(a)).toBe('yes');
    for (const a of ['n', 'N', 'no']) expect(parseAnswer(a)).toBe('no');
    for (const a of ['k', 'K', 'key']) expect(parseAnswer(a)).toBe('key');
    for (const a of ['maybe', 'yn', '1']) expect(parseAnswer(a)).toBeNull();
  });

  it('saves a brain choice for yes and no, and nothing for the API key', () => {
    expect(answerConfig('yes')).toEqual({ claudeCode: true, llm: 'claude-code' });
    expect(answerConfig('no')).toEqual({ llm: 'offline' });
    expect(answerConfig('key')).toBeNull();
  });

  it('names the plan and what each line costs', () => {
    expect(planLabel(MAX)).toBe('Max plan');
    expect(planLabel({ installed: true, loggedIn: true, authMethod: 'claude.ai' })).toBe('claude.ai login');
    const q = questionText(MAX, {});
    expect(q[0]).toBe('Claude Code is installed and logged in (Max plan).');
    expect(q[1]).toContain('They use Claude Haiku');
    expect(q[2]).toContain("counts toward your own plan's usage, shown in game (◆ chip)");
    expect(q[3]).toBe('[Y]es / [n]o (offline scripted characters) / [k] I have an API key');
    expect(questionText({ installed: true, loggedIn: true, authMethod: 'console' }, { AGENTCLINIC_MODEL: 'sonnet' }).join(' ')).toMatch(/They use sonnet.*billed to your own Console account/);
  });
});

/** run the question with typed input; returns the result and everything printed */
async function ask(root: string, typed: string, auth: ClaudeAuth = MAX, opts: { interactive?: boolean; end?: boolean } = {}) {
  const input = new PassThrough();
  const output = new PassThrough();
  let printed = '';
  output.on('data', (d) => (printed += d));
  const check = vi.fn(async () => auth);
  input.write(typed);
  if (opts.end !== false) input.end();
  const r = await runFirstRun({ root, env: {}, interactive: opts.interactive ?? true, input, output, check, color: false, platform: 'darwin' });
  return { r, printed, check };
}

describe('runFirstRun end to end (stub claude, temp checkout)', () => {
  it('yes: saves the Claude Code brain, keeps other keys, and says how to change it', async () => {
    const dir = checkout({ '//': 'my note' });
    const { r, printed } = await ask(dir, 'y\n');
    expect(r).toMatchObject({ plan: 'ask', answer: 'yes', offlineHint: null });
    expect(r.llm).toBeUndefined();
    expect(localJson(dir)).toEqual({ '//': 'my note', claudeCode: true, llm: 'claude-code' });
    expect(readLocalConfig(dir)).toEqual({ claudeCode: true, llm: 'claude-code' });
    expect(printed).toContain('Claude Code is installed and logged in (Max plan).');
    expect(printed).toContain('Saved in agentclinic.local.json: the characters run on your Claude Code login (Claude Haiku).');
    expect(printed).toContain('To change it: npm start -- --llm claude-code|api|offline');
  });

  it('Enter alone means yes; no saves offline characters', async () => {
    const a = checkout();
    expect((await ask(a, '\n')).r.answer).toBe('yes');
    expect(localJson(a)).toEqual({ claudeCode: true, llm: 'claude-code' });
    const b = checkout();
    const { r, printed } = await ask(b, 'n\n');
    expect(r.answer).toBe('no');
    expect(localJson(b)).toEqual({ llm: 'offline' });
    expect(printed).toContain('offline scripted characters');
  });

  it('asks again after an unclear answer (lines typed in one go are not lost)', async () => {
    const dir = checkout();
    const { r, printed } = await ask(dir, 'maybe\nn\n');
    expect(r.answer).toBe('no');
    expect(printed).toContain('Please type y (yes), n (no) or k (API key)');
    expect(localJson(dir)).toEqual({ llm: 'offline' });
  });

  it('k: explains the env var and .env, and saves nothing', async () => {
    const dir = checkout();
    const { r, printed } = await ask(dir, 'k\n');
    expect(r).toMatchObject({ answer: 'key', offlineHint: null });
    expect(existsSync(path.join(dir, 'agentclinic.local.json'))).toBe(false);
    expect(printed).toContain('export ANTHROPIC_API_KEY="sk-ant-..."');
    expect(printed).toContain('node --env-file=.env bin/agentclinic.mjs');
    expect(printed).toContain('your key never goes into agentclinic.local.json');
  });

  it('no answer (end of input): nothing saved, asked again next time', async () => {
    const dir = checkout();
    const { r } = await ask(dir, '');
    expect(r.answer).toBeUndefined();
    expect(existsSync(path.join(dir, 'agentclinic.local.json'))).toBe(false);
  });

  it('logged out: says how to log in, saves nothing; not installed: one line on installing', async () => {
    const a = checkout();
    const out = await ask(a, '', LOGGED_OUT);
    expect(out.r.plan).toBe('log-in');
    expect(out.printed).toContain('Run `claude` once and log in, then `npm start` again.');
    expect(out.printed).not.toContain('[Y]es');
    expect(existsSync(path.join(a, 'agentclinic.local.json'))).toBe(false);
    const b = checkout();
    const out2 = await ask(b, '', MISSING);
    expect(out2.r.plan).toBe('install');
    expect(out2.printed.trim().split('\n')).toHaveLength(1);
    expect(out2.printed).toContain('Install Claude Code (https://claude.com/claude-code)');
    expect(existsSync(path.join(b, 'agentclinic.local.json'))).toBe(false);
  });

  it('not interactive: silent, never runs claude, writes nothing', async () => {
    const dir = checkout();
    const { r, printed, check } = await ask(dir, 'y\n', MAX, { interactive: false });
    expect(r).toEqual({ plan: 'skip', skipped: 'not-interactive' });
    expect(printed).toBe('');
    expect(check).not.toHaveBeenCalled();
    expect(existsSync(path.join(dir, 'agentclinic.local.json'))).toBe(false);
  });

  it('an earlier offline answer: no question, and a hint that tells how to change it', async () => {
    const dir = checkout({ llm: 'offline' });
    const { r, check } = await ask(dir, '');
    expect(r.skipped).toBe('local-config');
    expect(r.offlineHint).toMatch(/as you chose in agentclinic\.local\.json/);
    expect(check).not.toHaveBeenCalled();
  });

  it('never overwrites a broken file; an unwritable folder applies the answer to this run only', async () => {
    const broken = checkout('{ "llm": ');
    const { r } = await ask(broken, 'y\n');
    expect(r.skipped).toBe('local-config-broken');
    expect(readFileSync(path.join(broken, 'agentclinic.local.json'), 'utf8')).toBe('{ "llm": ');
    const gone = path.join(tmp, 'no-such-folder');
    const out = await ask(gone, 'y\n');
    expect(out.r).toMatchObject({ answer: 'yes', llm: 'claude-code' });
    expect(out.printed).toContain("Couldn't save your answer");
  });
});

describe('writeLocalConfig', () => {
  it('merges into the file and refuses to replace one it cannot read', () => {
    const dir = checkout({ '//': 'keep me', claudeCode: true });
    writeLocalConfig({ llm: 'offline' }, dir);
    expect(localJson(dir)).toEqual({ '//': 'keep me', claudeCode: true, llm: 'offline' });
    expect(localConfigFile(dir)).toMatchObject({ state: 'ok' });
    const bad = checkout('[1, 2]');
    expect(() => writeLocalConfig({ llm: 'offline' }, bad)).toThrow(/not valid JSON/);
    expect(readFileSync(path.join(bad, 'agentclinic.local.json'), 'utf8')).toBe('[1, 2]');
  });
});

describe('--exit-when-idle', () => {
  it('parses the flag', () => {
    expect(idleExitMs([])).toBeNull();
    expect(idleExitMs(['--exit-when-idle'])).toBe(DEFAULT_IDLE_MS);
    expect(DEFAULT_IDLE_MS).toBe(120_000);
    expect(idleExitMs(['--exit-when-idle=90s'])).toBe(90_000);
    expect(idleExitMs(['--exit-when-idle=5m'])).toBe(300_000);
    expect(idleExitMs(['--exit-when-idle=30'])).toBe(30_000);
    expect(idleExitMs(['--exit-when-idle=off'])).toBeNull();
    expect(idleExitMs(['--exit-when-idle=0'])).toBeNull();
  });

  it('fires once, idleMs after the last tab closed, and never while a tab is open or an agent is active', () => {
    let t = 0;
    const onIdle = vi.fn();
    const idle = new IdleExit({ idleMs: 1000, onIdle, now: () => t });
    idle.connected();
    t = 5000;
    expect(idle.check()).toBe(false); // a tab is open
    idle.disconnected();
    t = 5900;
    expect(idle.check()).toBe(false);
    idle.activity(); // an agent called the API
    t = 6800;
    expect(idle.check()).toBe(false);
    t = 6900;
    expect(idle.check()).toBe(true);
    t = 99_000;
    expect(idle.check()).toBe(false);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('two tabs: the timer starts when the last one closes', () => {
    let t = 0;
    const onIdle = vi.fn();
    const idle = new IdleExit({ idleMs: 1000, onIdle, now: () => t });
    idle.connected();
    idle.connected();
    idle.disconnected();
    t = 10_000;
    expect(idle.check()).toBe(false);
    idle.disconnected();
    t = 10_999;
    expect(idle.check()).toBe(false);
    t = 11_000;
    expect(idle.check()).toBe(true);
  });
});
