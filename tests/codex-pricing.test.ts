import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { codexCostUSD } from '../server/llm/codexPricing';
import { codexUsage } from '../server/llm/codex';
import { UsageLedger, emptyTotals, sanitizeAgentReport } from '../server/usage';
import { fmtCodexCost, hasCodexCost, totalTokens } from '../shared/usage';

const tokens = { inputTokens: 1000, cacheReadTokens: 2000, cacheWriteTokens: 0, outputTokens: 100 };
const usage = (model = 'gpt-6-luna') => codexUsage(model, { input_tokens: 3000, cached_input_tokens: 2000, cache_write_input_tokens: 0, output_tokens: 100, reasoning_output_tokens: 50 }, 200)!;

describe('Codex API-equivalent estimates', () => {
  it.each([
    ['gpt-6-luna', .00017], ['gpt-6.1-sol', .0032], ['gpt-6-astra', .017],
    ['gpt-5.6-sol', .0068], ['gpt-5.6', .0068], ['gpt-5.6-terra', .0036], ['gpt-5.6-luna', .00036],
    ['gpt-5.3-codex', .0035], ['gpt-5.2-codex', .0035], ['gpt-5.1-codex', .0025],
  ])('prices %s at published Standard rates', (model, expected) => {
    expect(codexCostUSD(model as string, tokens)).toBeCloseTo(expected as number, 12);
  });

  it('counts cache writes and reasoning once', () => {
    const u = codexUsage('gpt-6-luna', { input_tokens: 1000, cached_input_tokens: 200, cache_write_input_tokens: 300, output_tokens: 100, reasoning_output_tokens: 70 }, 20)!;
    expect(u).toMatchObject({ inputTokens: 500, cacheReadTokens: 200, cacheWriteTokens: 300, outputTokens: 100, costSource: 'price-table' });
    expect(totalTokens(u)).toBe(1100);
    expect(u.costUSD).toBeCloseTo(.0001395, 12);
  });

  it('applies the long-context tier strictly above 272K, including cached input', () => {
    expect(codexCostUSD('gpt-6-luna', { ...tokens, inputTokens: 270000 })).toBeCloseTo(.02707, 12);
    expect(codexCostUSD('gpt-6-luna', { ...tokens, inputTokens: 270001 })).toBeCloseTo(.0541152, 12);
    expect(codexCostUSD('gpt-5.3-codex', { ...tokens, inputTokens: 300000 })).toBeCloseTo(.52675, 12);
  });

  it('does not invent prices for unknown models or unsupported legacy cache writes', () => {
    for (const model of ['gpt-unknown', 'gpt-6-luna-custom', 'toString', 'claude-sonnet-5-5']) {
      expect(usage(model)).toMatchObject({ costUSD: 0, costSource: 'unpriced', codexUnpricedCalls: 1 });
    }
    expect(codexCostUSD('gpt-5.3-codex', { ...tokens, cacheWriteTokens: 1 })).toBeUndefined();
    expect(codexUsage('gpt-6-luna', null, 20)).toBeUndefined();
  });

  it('records NPC estimates, preserves unknown coverage and uses the existing dollar budget', () => {
    const ledger = new UsageLedger().configure({ provider: 'codex', maxUsd: .0001 });
    ledger.recordNpc('s', 'p', 'Patient', usage());
    expect(ledger.overBudget()).toBe(true);
    let view = ledger.sessionView('s', 'codex');
    expect(view.apiEquivalent).toBe(true);
    expect(view.costAvailable).not.toBe(false);
    expect(view.session.costUSD).toBeCloseTo(.00017, 12);
    ledger.recordNpc('s', 'p', 'Patient', usage('unknown'));
    view = ledger.sessionView('s', 'codex');
    expect(view.costAvailable).toBe(false);
    expect(fmtCodexCost(view.session)).toContain('estimated (partial)');
    expect(view.process.codexUnpricedCalls).toBe(1);
    expect(view.byNpc[0].totals.codexPricedCalls).toBe(1);
    expect(fmtCodexCost({ ...emptyTotals(), calls: 2 })).toBe('Unavailable');
  });

  it('preserves Codex coverage across persistence and restored sessions', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ac-codex-cost-'));
    try {
      const file = path.join(dir, 'usage.json');
      const ledger = new UsageLedger().configure({ provider: 'codex', file });
      ledger.recordNpc('s', 'p', 'Patient', usage());
      ledger.flush();
      expect(JSON.parse(readFileSync(file, 'utf8')).allTime.npc.codexPricedCalls).toBe(1);
      const next = new UsageLedger().configure({ provider: 'codex', file });
      next.restoreSessionUsage('s', ledger.sessionView('s', 'codex'));
      expect(next.sessionView('s', 'codex').costAvailable).not.toBe(false);
      expect(next.allTime().npc.costUSD).toBeCloseTo(.00017, 12);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('counts cumulative AI-physician estimates once and validates coverage', () => {
    const ledger = new UsageLedger();
    const report = sanitizeAgentReport({ ...emptyTotals(), ...usage(), calls: 1, label: 'Codex', billing: 'unknown', final: false, costAvailable: true })!;
    expect(report.codexPricedCalls).toBe(1);
    ledger.recordAgent('s', report); ledger.recordAgent('s', report);
    expect(ledger.summary().process.agent.costUSD).toBeCloseTo(.00017, 12);
    expect(ledger.summary().process.agent.codexPricedCalls).toBe(1);
    const second = { ...report, calls: 2, costUSD: report.costUSD * 2, codexPricedCalls: 2 };
    ledger.recordAgent('s', second);
    expect(ledger.summary().process.agent.codexPricedCalls).toBe(2);
    expect(sanitizeAgentReport({ ...report, codexPricedCalls: 2 })).toBeNull();
    expect(hasCodexCost(emptyTotals())).toBe(false);
    expect(ledger.sessionView('s', 'vllm').costAvailable).toBe(false);
    expect(ledger.sessionView('s', 'claude-code').apiEquivalent).toBe(false);
  });
});
