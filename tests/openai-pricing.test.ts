import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { codexCostUSD } from '../server/llm/codexPricing';
import { codexUsage } from '../server/llm/codex';
import { openaiUsage, vllmUsage, type VllmResponse } from '../server/llm/vllm';
import { emptyTotals, UsageLedger } from '../server/usage';
import { fmtEstimatedCost, totalTokens } from '../shared/usage';

const response = (prompt = 3000, cached = 2000, written = 0): VllmResponse => ({
  model: 'gpt-6-luna', service_tier: 'default', choices: [],
  usage: { prompt_tokens: prompt, completion_tokens: 100, prompt_tokens_details: { cached_tokens: cached, cache_write_tokens: written } },
});
const usage = (r = response()) => openaiUsage('gpt-6-luna', r, 200)!;

describe('OpenAI API estimates', () => {
  it('reuses the Codex rates, while keeping API estimate coverage separate', () => {
    const u = usage();
    expect(u).toMatchObject({ inputTokens: 1000, cacheReadTokens: 2000, outputTokens: 100, costSource: 'price-table', openaiPricedCalls: 1, openaiUnpricedCalls: 0 });
    expect(u).not.toHaveProperty('codexPricedCalls');
    expect(u.costUSD).toBeCloseTo(.00017, 12);
    expect(u.costUSD).toBe(codexCostUSD(u.model, u));
  });

  it('counts cache writes and total output once, including long-context thresholds', () => {
    const u = usage(response(1000, 200, 300));
    expect(u).toMatchObject({ inputTokens: 500, cacheReadTokens: 200, cacheWriteTokens: 300 });
    expect(totalTokens(u)).toBe(1100);
    expect(u.costUSD).toBeCloseTo(.0001395, 12);
    expect(usage(response(272000)).costUSD).toBeCloseTo(.02707, 12);
    expect(usage(response(272001)).costUSD).toBeCloseTo(.0541152, 12);
  });

  it('uses the returned model and leaves unknown models and nonstandard tiers unpriced', () => {
    for (const r of [{ ...response(), model: 'unknown' }, ...['priority', 'fast', 'flex', 'scale', 'auto'].map(service_tier => ({ ...response(), service_tier }))]) {
      expect(usage(r)).toMatchObject({ costUSD: 0, costSource: 'unpriced', openaiPricedCalls: 0, openaiUnpricedCalls: 1 });
    }
    expect(openaiUsage('unknown', response(), 0)?.costUSD).toBeCloseTo(.00017, 12);
    expect(openaiUsage('gpt-6-luna', { choices: [], usage: response().usage }, 0)?.costUSD).toBeCloseTo(.00017, 12);
    expect(openaiUsage('gpt-6-luna', { choices: [] }, 0)).toBeUndefined();
    // A custom server does not acquire OpenAI prices just because its model name matches.
    expect(vllmUsage('gpt-6-luna', response(), 0)).toMatchObject({ costUSD: 0, costSource: 'unpriced' });
    expect(vllmUsage('gpt-6-luna', response(), 0)).not.toHaveProperty('openaiPricedCalls');
  });

  it('tracks NPCs, cumulative costs and the existing dollar budget without calling them API-equivalent', () => {
    const ledger = new UsageLedger().configure({ provider: 'openai-api', maxUsd: .0001 });
    ledger.recordNpc('s', 'p', 'Patient', usage());
    const view = ledger.sessionView('s', 'openai-api');
    expect(view.apiEquivalent).toBe(false);
    expect(view.costAvailable).not.toBe(false);
    expect(view.byNpc[0].totals.openaiPricedCalls).toBe(1);
    expect(view.today.costUSD).toBeCloseTo(.00017, 12);
    expect(view.process.openaiPricedCalls).toBe(1);
    expect(ledger.overBudget()).toBe(true);
    ledger.recordNpc('s', 'p', 'Patient', usage({ ...response(), model: 'unknown' }));
    const partial = ledger.sessionView('s', 'openai-api');
    expect(partial.costAvailable).toBe(false);
    expect(fmtEstimatedCost(partial.session)).toContain('estimated (partial)');
    expect(fmtEstimatedCost({ ...emptyTotals(), calls: 2 })).toBe('Unavailable');
  });

  it('preserves mixed and historical totals across flushes and save restoration without repricing or double-counting', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ac-openai-cost-'));
    try {
      const file = path.join(dir, 'usage.json');
      const ledger = new UsageLedger().configure({ provider: 'openai-api', file });
      ledger.recordNpc('old', 'p', 'Patient', vllmUsage('gpt-6-luna', response(), 0)!);
      ledger.recordNpc('s', 'p', 'Patient', usage());
      ledger.recordNpc('codex', 'p', 'Patient', codexUsage('gpt-6-luna', { input_tokens: 3000, cached_input_tokens: 2000, cache_write_input_tokens: 0, output_tokens: 100, reasoning_output_tokens: 0 }, 200)!);
      ledger.flush(); ledger.flush();
      const next = new UsageLedger().configure({ provider: 'openai-api', file });
      expect(next.allTime().npc).toMatchObject({ calls: 3, openaiPricedCalls: 1, codexPricedCalls: 1 });
      expect(next.allTime().npc.costUSD).toBeCloseTo(.00034, 12);
      expect(fmtEstimatedCost(next.allTime().npc)).toContain('estimated (partial)');
      next.restoreSessionUsage('s', ledger.sessionView('s', 'openai-api'));
      expect(next.sessionView('s', 'openai-api').costAvailable).not.toBe(false);
      expect(next.allTime().npc.costUSD).toBeCloseTo(.00034, 12);
      expect(next.summary().process.npc.calls).toBe(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
