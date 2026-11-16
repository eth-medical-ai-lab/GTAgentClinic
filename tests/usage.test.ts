import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { StreamUsageMeter } from '../agents/usageMeter';
import { usageFromApi } from '../server/llm/anthropicApi';
import { usageFromClaudeResult } from '../server/llm/claudeCode';
import { costUSD, normalizeModelId, priceFor } from '../server/llm/pricing';
import type { ChatRequest, ChatResult, LlmCallUsage, LlmProvider } from '../server/llm/provider';
import { NpcBrain } from '../server/npc/brain';
import { GameSession } from '../server/sim/session';
import { buildView } from '../server/sim/views';
import { cacheHitRate, parseAmount, planFromRateLimit, sanitizeAgentReport, totalTokens, UsageLedger } from '../server/usage';
import type { GameEvent } from '../shared/types';

// Real events from a 2-turn warm `claude -p --model haiku --input-format stream-json
// --output-format stream-json --verbose --json-schema …` session (Claude Code 2.1.319), trimmed.
const RESULT_1 = {
  type: 'result',
  subtype: 'success',
  is_error: false,
  num_turns: 2,
  duration_ms: 1704,
  duration_api_ms: 1481,
  total_cost_usd: 0.0003033,
  usage: { input_tokens: 2, cache_creation_input_tokens: 1253, cache_read_input_tokens: 0, output_tokens: 105, cache_creation: { ephemeral_1h_input_tokens: 1253, ephemeral_5m_input_tokens: 0 }, iterations: [{ type: 'message' }] },
  modelUsage: { 'claude-haiku-5-5': { inputTokens: 2, outputTokens: 105, cacheReadInputTokens: 0, cacheCreationInputTokens: 1253, cacheCreationEphemeral1hInputTokens: 1253, costUSD: 0.0003033 } },
  model_usage_since_last_result: { 'claude-haiku-5-5': { inputTokens: 2, outputTokens: 105, cacheReadInputTokens: 0, cacheCreationInputTokens: 1253, cacheCreationEphemeral1hInputTokens: 1253, costUSD: 0.0003033 } },
};
const RESULT_2 = {
  type: 'result',
  subtype: 'success',
  is_error: false,
  num_turns: 2,
  duration_ms: 1773,
  duration_api_ms: 3243,
  total_cost_usd: 0.00042793,
  usage: { input_tokens: 2, cache_creation_input_tokens: 152, cache_read_input_tokens: 1253, output_tokens: 163, cache_creation: { ephemeral_1h_input_tokens: 152, ephemeral_5m_input_tokens: 0 }, iterations: [{ type: 'message' }] },
  modelUsage: { 'claude-haiku-5-5': { inputTokens: 4, outputTokens: 268, cacheReadInputTokens: 1253, cacheCreationInputTokens: 1405, cacheCreationEphemeral1hInputTokens: 1405, costUSD: 0.00042793 } },
  model_usage_since_last_result: { 'claude-haiku-5-5': { inputTokens: 2, outputTokens: 163, cacheReadInputTokens: 1253, cacheCreationInputTokens: 152, cacheCreationEphemeral1hInputTokens: 152, costUSD: 0.00012463 } },
};
const RATE_LIMIT_INFO = {
  status: 'allowed',
  resetsAt: 1794499200,
  rateLimitType: 'seven_day',
  overageStatus: 'rejected',
  isUsingOverage: false,
  unifiedWindows: { seven_day: { utilization: 0.28, resetsAt: 1794499200, status: 'allowed' } },
};

const tmp = mkdtempSync(path.join(tmpdir(), 'ac-usage-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('pricing', () => {
  it('reproduces Claude Code’s own costUSD for Haiku 5.5 turns (1-h cache writes at 2×, reads at 0.1×)', () => {
    expect(costUSD('claude-haiku-5-5', { inputTokens: 2, outputTokens: 105, cacheReadTokens: 0, cacheWriteTokens: 1253, cacheWrite1hTokens: 1253 }).usd).toBeCloseTo(0.0003033, 10);
    expect(costUSD('claude-haiku-5-5', { inputTokens: 2, outputTokens: 163, cacheReadTokens: 1253, cacheWriteTokens: 152, cacheWrite1hTokens: 152 }).usd).toBeCloseTo(0.00012463, 10);
  });

  it('prices Sonnet/Opus 5.5 per MTok incl. 5-minute cache writes at 1.25×', () => {
    const M = 1_000_000;
    expect(costUSD('claude-sonnet-5-5', { inputTokens: M, outputTokens: M, cacheReadTokens: M, cacheWriteTokens: M }).usd).toBeCloseTo(2 + 10 + 0.2 + 2.5, 9);
    expect(costUSD('claude-opus-5-5', { inputTokens: M, outputTokens: M, cacheReadTokens: M, cacheWriteTokens: M, cacheWrite1hTokens: M }).usd).toBeCloseTo(4 + 20 + 0.2 + 8, 9);
    // ≤ 100K prompt tokens is still the short tier
    expect(costUSD('claude-haiku-5-5', { inputTokens: 100_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }).usd).toBeCloseTo(0.01, 12);
  });

  it('switches Haiku 5.5 to the >100K-prompt tier ($0.50 / $2.50)', () => {
    const short = costUSD('claude-haiku-5-5', { inputTokens: 90_000, outputTokens: 1000, cacheReadTokens: 0, cacheWriteTokens: 0 }).usd;
    const long = costUSD('claude-haiku-5-5', { inputTokens: 150_000, outputTokens: 1000, cacheReadTokens: 0, cacheWriteTokens: 0 }).usd;
    expect(short).toBeCloseTo((90_000 * 0.1 + 1000 * 0.5) / 1e6, 12);
    expect(long).toBeCloseTo((150_000 * 0.5 + 1000 * 2.5) / 1e6, 12);
  });

  it('normalizes provider-specific ids and flags family fallbacks as estimates', () => {
    expect(normalizeModelId('us.anthropic.claude-opus-5-5-20260101[1m]')).toBe('claude-opus-5-5');
    expect(normalizeModelId('claude-opus-4-5@20251101')).toBe('claude-opus-4-5');
    expect(priceFor('claude-opus-5')?.price.input).toBe(5); // not Opus 5.5
    expect(priceFor('claude-opus-5-5')?.price.input).toBe(4);
    expect(priceFor('haiku')).toMatchObject({ estimated: true, price: { id: 'claude-haiku-5-5' } });
    expect(priceFor('gpt-x')).toBeNull();
    expect(costUSD('gpt-x', { inputTokens: 10, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 })).toEqual({ usd: 0, estimated: true, known: false });
  });

  it('API provider: res.usage → per-call usage with computed cost', () => {
    const u = usageFromApi('claude-haiku-5-5', { input_tokens: 300, output_tokens: 80, cache_read_input_tokens: 2000, cache_creation_input_tokens: 0, cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 }, inference_geo: null, output_tokens_details: null, server_tool_use: null, service_tier: 'standard', speed: null }, 900);
    expect(u).toMatchObject({ inputTokens: 300, outputTokens: 80, cacheReadTokens: 2000, cacheWriteTokens: 0, requests: 1, latencyMs: 900, costSource: 'price-table' });
    expect(u.costUSD).toBeCloseTo((300 * 0.1 + 80 * 0.5 + 2000 * 0.01) / 1e6, 12);
  });
});

describe('Claude Code stream-json accounting', () => {
  it('reads per-turn usage from model_usage_since_last_result (not the cumulative fields)', () => {
    const t1 = usageFromClaudeResult(RESULT_1, { fallbackModel: 'haiku', latencyMs: 1700 })!;
    const t2 = usageFromClaudeResult(RESULT_2, { fallbackModel: 'haiku', latencyMs: 1800 })!;
    expect(t1).toMatchObject({ model: 'claude-haiku-5-5', inputTokens: 2, outputTokens: 105, cacheReadTokens: 0, cacheWriteTokens: 1253, costSource: 'claude-code', requests: 1 });
    expect(t2).toMatchObject({ inputTokens: 2, outputTokens: 163, cacheReadTokens: 1253, cacheWriteTokens: 152 });
    expect(t2.costUSD).toBeCloseTo(0.00012463, 12);
    // per-turn costs add up to the process's cumulative total_cost_usd
    expect(t1.costUSD + t2.costUSD).toBeCloseTo(RESULT_2.total_cost_usd, 12);
  });

  it('falls back to diffing the cumulative modelUsage, then to usage + price table', () => {
    const { model_usage_since_last_result: _a, ...old2 } = RESULT_2;
    const t2 = usageFromClaudeResult(old2, { fallbackModel: 'haiku', latencyMs: 1, prevCumulative: RESULT_1.modelUsage })!;
    expect(t2).toMatchObject({ inputTokens: 2, outputTokens: 163, cacheReadTokens: 1253, cacheWriteTokens: 152 });
    expect(t2.costUSD).toBeCloseTo(0.00012463, 12);
    const { model_usage_since_last_result: _b, modelUsage: _c, ...bare } = RESULT_2;
    const t3 = usageFromClaudeResult(bare, { fallbackModel: 'claude-haiku-5-5', latencyMs: 1 })!;
    expect(t3).toMatchObject({ inputTokens: 2, outputTokens: 163, costSource: 'price-table' });
    expect(t3.costUSD).toBeCloseTo(0.00012463, 12);
  });

  it('parses the subscription window from rate_limit_event', () => {
    const p = planFromRateLimit(RATE_LIMIT_INFO, 123)!;
    expect(p.windows).toEqual([{ id: 'seven_day', label: '7-day window', utilization: 0.28, resetsAt: 1794499200, status: 'allowed' }]);
    expect(p).toMatchObject({ status: 'allowed', limitingWindow: 'seven_day', usingOverage: false, at: 123 });
    expect(planFromRateLimit(undefined)).toBeUndefined();
  });

  it('AI-doctor meter: dedupes assistant events by id, prefers message_delta, then the result', () => {
    const m = new StreamUsageMeter();
    m.onEvent({ type: 'system', subtype: 'init', apiKeySource: 'none' });
    const start = { type: 'stream_event', event: { type: 'message_start', message: { id: 'msg_1', model: 'claude-sonnet-5-5', usage: { input_tokens: 5, cache_read_input_tokens: 10_000, cache_creation_input_tokens: 2000, output_tokens: 3 } } } };
    expect(m.onEvent(start, 1000)).toBeNull();
    // one API message, split into two assistant events with the same (snapshot) usage
    const asst = { type: 'assistant', message: { id: 'msg_1', model: 'claude-sonnet-5-5', usage: { input_tokens: 5, output_tokens: 3 } } };
    m.onEvent(asst);
    m.onEvent(asst);
    expect(m.onEvent({ type: 'stream_event', event: { type: 'message_delta', usage: { output_tokens: 240 } } }, 3500)).toBe('msg_1');
    let t = m.totals();
    expect(t).toMatchObject({ calls: 1, inputTokens: 5, cacheReadTokens: 10_000, cacheWriteTokens: 2000, outputTokens: 240, latencyMs: 2500, model: 'claude-sonnet-5-5', final: false });
    expect(t.costUSD).toBeCloseTo((5 * 2 + 10_000 * 0.2 + 2000 * 2.5 + 240 * 10) / 1e6, 12);
    expect(m.billing).toBe('subscription');
    m.onEvent({ type: 'rate_limit_event', rate_limit_info: RATE_LIMIT_INFO });
    m.onEvent({ type: 'result', total_cost_usd: 0.05, duration_api_ms: 2400, modelUsage: { 'claude-sonnet-5-5': { inputTokens: 6, outputTokens: 250, cacheReadInputTokens: 10_000, cacheCreationInputTokens: 2000, costUSD: 0.05 } } });
    t = m.totals();
    expect(t).toMatchObject({ final: true, costUSD: 0.05, outputTokens: 250, inputTokens: 6, latencyMs: 2400 });
    expect(m.plan?.windows[0].utilization).toBe(0.28);
  });

  it('AI-doctor meter without partial messages counts each new assistant message once', () => {
    const m = new StreamUsageMeter();
    const a = (id: string) => ({ type: 'assistant', message: { id, model: 'claude-sonnet-5-5', usage: { input_tokens: 1, cache_read_input_tokens: 100, output_tokens: 20 } } });
    expect(m.onEvent(a('m1'))).toBe('m1');
    expect(m.onEvent(a('m1'))).toBeNull();
    expect(m.onEvent(a('m2'))).toBe('m2');
    expect(m.totals()).toMatchObject({ calls: 2, inputTokens: 2, cacheReadTokens: 200, outputTokens: 40 });
  });
});

const call = (over: Partial<LlmCallUsage> = {}): LlmCallUsage => ({ model: 'claude-haiku-5-5', inputTokens: 10, outputTokens: 50, cacheReadTokens: 2000, cacheWriteTokens: 100, costUSD: 0.0001, costSource: 'claude-code', requests: 1, latencyMs: 1200, ...over });

describe('usage ledger', () => {
  it('totals per session, per NPC (sorted by cost) and per process', () => {
    const l = new UsageLedger();
    l.recordNpc('s_a', 'rn_rosa', 'Rosa', call());
    l.recordNpc('s_a', 'pt_p_x', 'Pat X', call({ costUSD: 0.0005 }));
    l.recordNpc('s_a', 'rn_rosa', 'Rosa', call());
    l.recordNpc('s_b', 'rn_rosa', 'Rosa', call());
    const v = l.sessionView('s_a', 'claude-code');
    expect(v.session).toMatchObject({ calls: 3, requests: 3, inputTokens: 30, outputTokens: 150, cacheReadTokens: 6000, cacheWriteTokens: 300, latencyMs: 3600 });
    expect(v.session.costUSD).toBeCloseTo(0.0007, 12);
    expect(v.byNpc.map((r) => [r.key, r.totals.calls])).toEqual([
      ['pt_p_x', 1],
      ['rn_rosa', 2],
    ]);
    expect(v.process.calls).toBe(4);
    expect(v.today.calls).toBe(4);
    expect(v.models).toEqual(['claude-haiku-5-5']);
    expect(cacheHitRate(v.session)).toBeCloseTo(6000 / 6330, 9);
    expect(totalTokens(v.session)).toBe(6480);
  });

  it('agent reports are cumulative: only growth counts, regressions never subtract', () => {
    const l = new UsageLedger();
    const r = (cost: number, tok: number) => sanitizeAgentReport({ calls: tok / 100, inputTokens: 5, cacheReadTokens: tok, outputTokens: 10, costUSD: cost, label: 'Claude sonnet', billing: 'subscription' })!;
    l.recordAgent('s_a', r(0.1, 1000));
    l.recordAgent('s_a', r(0.25, 3000));
    l.recordAgent('s_a', r(0.2, 2000)); // out-of-order report
    const s = l.summary();
    expect(s.process.agent.costUSD).toBeCloseTo(0.25, 12);
    expect(s.process.agent.cacheReadTokens).toBe(3000);
    expect(l.sessionView('s_a', 'claude-code').agent).toMatchObject({ label: 'Claude sonnet', billing: 'subscription', costUSD: 0.2 });
  });

  it('rejects malformed agent reports', () => {
    expect(sanitizeAgentReport({ inputTokens: -1 })).toBeNull();
    expect(sanitizeAgentReport({ inputTokens: 'lots' })).toBeNull();
    expect(sanitizeAgentReport({ costUSD: Number.NaN })).toBeNull();
    expect(sanitizeAgentReport({})).toBeNull();
    expect(sanitizeAgentReport({ outputTokens: 5, billing: 'free-lunch', label: 'x'.repeat(500) })).toMatchObject({ outputTokens: 5, billing: 'unknown', label: 'x'.repeat(80) });
  });

  it('persists per-day and all-time totals and merges writers sharing one file', () => {
    const file = path.join(tmp, 'usage.json');
    const a = new UsageLedger().configure({ file, flushMs: 60_000 });
    a.recordNpc('s_a', 'rn', 'Rosa', call({ costUSD: 0.001 }));
    expect(a.flush()).toBe(true);
    const b = new UsageLedger().configure({ file, flushMs: 60_000 });
    expect(b.today().npc.calls).toBe(1);
    b.recordNpc('s_b', 'rn', 'Rosa', call({ costUSD: 0.002 }));
    a.recordNpc('s_a', 'rn', 'Rosa', call({ costUSD: 0.004 }));
    a.recordAgent('s_a', sanitizeAgentReport({ calls: 3, inputTokens: 9, outputTokens: 9, costUSD: 0.5 })!);
    expect(b.flush() && a.flush()).toBe(true);
    const disk = JSON.parse(readFileSync(file, 'utf8'));
    expect(disk.allTime.npc.calls).toBe(3);
    expect(disk.allTime.npc.costUSD).toBeCloseTo(0.007, 12);
    expect(disk.allTime.agent.costUSD).toBeCloseTo(0.5, 12);
    expect(Object.keys(disk.days)).toHaveLength(1);
    const c = new UsageLedger().configure({ file });
    expect(c.summary().allTime).toMatchObject({ since: disk.since });
    expect(c.summary().today.npc.calls).toBe(3);
  });

  it('persists a final agent report that only changes latency', () => {
    const file = path.join(tmp, 'usage-latency.json');
    const l = new UsageLedger().configure({ file, flushMs: 60_000 });
    l.recordAgent('s_a', sanitizeAgentReport({ calls: 3, outputTokens: 459, costUSD: 0.002, latencyMs: 1137 })!);
    l.recordAgent('s_a', sanitizeAgentReport({ calls: 3, outputTokens: 459, costUSD: 0.002, latencyMs: 4334, final: true })!);
    expect(l.flush()).toBe(true);
    expect(JSON.parse(readFileSync(file, 'utf8')).allTime.agent).toMatchObject({ calls: 3, latencyMs: 4334 });
  });

  it('budget guard: trips on tokens or USD for this process', () => {
    const l = new UsageLedger().configure({ maxTokens: 5000 });
    expect(l.overBudget()).toBe(false);
    l.recordNpc('s_a', 'rn', 'Rosa', call()); // 2160 tokens
    l.recordNpc('s_a', 'rn', 'Rosa', call());
    expect(l.overBudget()).toBe(false);
    l.recordNpc('s_a', 'rn', 'Rosa', call());
    expect(l.overBudget()).toBe(true);
    expect(l.claimBudgetNotice('s_a')).toBe(true);
    expect(l.claimBudgetNotice('s_a')).toBe(false);
    expect(l.claimBudgetNotice('s_b')).toBe(true);
    expect(l.budgetNotice()).toMatch(/6\.5k of the 5\.0k-token budget/);
    const usd = new UsageLedger().configure({ maxUsd: 0.0002 });
    usd.recordNpc(undefined, 'rn', 'Rosa', call({ costUSD: 0.00025 }));
    expect(usd.overBudget()).toBe(true);
  });

  it('parses budget amounts', () => {
    expect(parseAmount('50k')).toBe(50_000);
    expect(parseAmount('1.5M')).toBe(1_500_000);
    expect(parseAmount('$0.50')).toBe(0.5);
    expect(parseAmount('200000')).toBe(200_000);
    expect(parseAmount('lots')).toBeUndefined();
    expect(parseAmount('0')).toBeUndefined();
    expect(parseAmount(undefined)).toBeUndefined();
  });
});

class FakeProvider implements LlmProvider {
  readonly status = { provider: 'claude-code' as const, label: 'fake', ok: true };
  readonly billing = 'subscription' as const;
  calls = 0;
  async chat(_req: ChatRequest): Promise<ChatResult> {
    this.calls++;
    return { json: { say: 'On it.', emotion: 'neutral', revealed: [], counseled: [], actions: [] }, text: '', latencyMs: 900, usage: call({ costUSD: 0.0002 }), plan: planFromRateLimit(RATE_LIMIT_INFO) };
  }
  forget() {}
  dispose() {}
}

describe('NPC brain → ledger → PlayerView', () => {
  it('records each NPC turn under its session and NPC, and falls back offline with one toast past the budget', async () => {
    const ledger = new UsageLedger().configure({ maxTokens: 4000, provider: 'claude-code', apiEquivalent: true });
    const provider = new FakeProvider();
    const brain = new NpcBrain(provider, ledger);
    const s = new GameSession({ scenarioId: 'orientation', seed: 3, playerName: 'Test', mode: 'step', brain });
    const toasts: string[] = [];
    s.on((e: GameEvent) => e.kind === 'toast' && toasts.push(e.text));

    const r1 = await s.act({ type: 'talk', npcId: 'rn_rosa', text: 'Rosa, can you get a set of vitals on bed 1?' });
    expect(r1.ok).toBe(true);
    let v = buildView(s, brain.status).usage!;
    expect(v).toMatchObject({ provider: 'claude-code', apiEquivalent: true, session: { calls: 1 } });
    expect(v.byNpc[0]).toMatchObject({ key: 'rn_rosa', totals: { calls: 1 } });
    expect(v.byNpc[0].name).toMatch(/Rosa/);
    expect(v.plan?.windows[0].id).toBe('seven_day');

    await s.act({ type: 'talk', npcId: 'rn_rosa', text: 'Thanks.' }); // 2 × 2160 tokens → over the 4000 budget
    expect(ledger.overBudget()).toBe(true);
    expect(brain.status.ok).toBe(false);
    const r3 = await s.act({ type: 'talk', npcId: 'rn_tom', text: 'Tom, anything new?' });
    await s.act({ type: 'talk', npcId: 'rn_tom', text: 'And bed 2?' });
    expect(r3.data).toMatchObject({ source: 'offline' });
    expect(provider.calls).toBe(2);
    expect(toasts.filter((t) => /budget/i.test(t))).toHaveLength(1);
    v = buildView(s, brain.status).usage!;
    expect(v.session.calls).toBe(2);
    expect(v.budget).toEqual({ maxTokens: 4000, maxUsd: undefined, exceeded: true });
  });

  it('offline sessions report zero usage', () => {
    const s = new GameSession({ scenarioId: 'orientation', seed: 3, playerName: 'Test', mode: 'step', brain: new NpcBrain(null, new UsageLedger()) });
    expect(buildView(s, s.brain.status).usage).toMatchObject({ provider: 'offline', session: { calls: 0, costUSD: 0 }, byNpc: [] });
  });
});
