/**
 * Pure helpers for LLM usage numbers, shared by the server ledger, the AI-doctor launcher
 * and the client HUD/menu/debrief (no Node imports here).
 */
import type { UsageTotals, PricedUsageTotals } from './types';

/** every token the model processed: uncached input + cache reads + cache writes + output */
export function totalTokens(t: Pick<UsageTotals, 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens'>): number {
  return t.inputTokens + t.outputTokens + t.cacheReadTokens + t.cacheWriteTokens;
}

/** prompt-side tokens (what was sent to the model) */
export function promptTokens(t: Pick<UsageTotals, 'inputTokens' | 'cacheReadTokens' | 'cacheWriteTokens'>): number {
  return t.inputTokens + t.cacheReadTokens + t.cacheWriteTokens;
}

/** share of prompt tokens served from the prompt cache (0–1) */
export function cacheHitRate(t: Pick<UsageTotals, 'inputTokens' | 'cacheReadTokens' | 'cacheWriteTokens'>): number {
  const p = promptTokens(t);
  return p > 0 ? t.cacheReadTokens / p : 0;
}

export function fmtTokens(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 1e6) return `${(n / 1e3).toFixed(n < 1e4 ? 1 : 0)}k`;
  return `${(n / 1e6).toFixed(n < 1e7 ? 2 : 1)}M`;
}

export function fmtUSD(x: number): string {
  if (x === 0) return '$0';
  if (x < 0.01) return `$${x.toFixed(4)}`;
  if (x < 1) return `$${x.toFixed(3)}`;
  return `$${x.toFixed(2)}`;
}

/** Only Codex totals carry these optional fields; existing provider formatting stays unchanged. */
export function hasCodexCost(t: PricedUsageTotals): boolean {
  return t.codexPricedCalls !== undefined || t.codexUnpricedCalls !== undefined;
}

export function hasEstimatedCost(t: PricedUsageTotals): boolean {
  return hasCodexCost(t) || t.openaiPricedCalls !== undefined || t.openaiUnpricedCalls !== undefined;
}

export function fmtEstimatedCost(t: PricedUsageTotals): string {
  const priced = (t.codexPricedCalls ?? 0) + (t.openaiPricedCalls ?? 0);
  if (!priced) return t.costUSD > 0 ? `${fmtUSD(t.costUSD)} recorded subtotal` : 'Unavailable';
  const partial = (t.codexUnpricedCalls ?? 0) + (t.openaiUnpricedCalls ?? 0) > 0 || priced < t.calls;
  return `${fmtUSD(t.costUSD)} estimated${partial ? ' (partial)' : ''}`;
}

export const fmtCodexCost = fmtEstimatedCost;

/** "Haiku" for "claude-haiku-5-5" or "Claude Haiku (latest)": the first model family found, else the fallback */
export function modelFamily(names: (string | undefined)[], fallback = 'Claude'): string {
  for (const n of names) {
    const f = n && /(haiku|sonnet|opus)/i.exec(n)?.[1];
    if (f) return f[0].toUpperCase() + f.slice(1).toLowerCase();
  }
  return fallback;
}

/** "claude-haiku-5-5" → "Claude Haiku 5.5" (unknown shapes pass through) */
export function prettyModel(id: string): string {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(id);
  if (!m) return id;
  return `Claude ${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ''}`;
}
