/**
 * Claude list prices and cost math (pure, no I/O — shared by the server, the AI-doctor
 * launcher and tests).
 *
 * Prices are USD per million tokens, Anthropic first-party list prices as published in
 * the claude-api skill's model table (cached 2026-10-06) and its prompt-caching guide:
 *   • cache writes: 1.25× the input price with the default 5-minute TTL, 2× with the
 *     1-hour TTL (Claude Code writes its prompt cache with the 1-hour TTL);
 *   • cache reads: 0.1× input — except Claude Opus 5.5 (0.05×, $0.20) and Claude Fable 5.1
 *     (0.025×, $0.25);
 *   • Claude Haiku 5.5: $0.10 / $0.50 for prompts ≤ 100K tokens, $0.50 / $2.50 above.
 * Cross-checked against the `costUSD` Claude Code 2.1.319 reports for Haiku 5.5 turns
 * (tests/usage.test.ts). For a subscription login (Claude Code on a claude.ai plan) these
 * are *API-equivalent* figures: nobody pays per token, but it is the best proxy for load.
 */

export interface ModelPrice {
  /** canonical model id, e.g. "claude-haiku-5-5" */
  id: string;
  label: string;
  input: number;
  output: number;
  cacheRead: number;
  /** requests whose prompt exceeds `threshold` tokens are billed at these rates instead */
  longContext?: { threshold: number; input: number; output: number; cacheRead: number };
}

export const CACHE_WRITE_5M = 1.25;
export const CACHE_WRITE_1H = 2;

export const PRICES: readonly ModelPrice[] = [
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', input: 0.1, output: 0.5, cacheRead: 0.01, longContext: { threshold: 100_000, input: 0.5, output: 2.5, cacheRead: 0.05 } },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', input: 2, output: 10, cacheRead: 0.2 },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', input: 4, output: 20, cacheRead: 0.2 },
  { id: 'claude-fable-5-1', label: 'Claude Fable 5.1', input: 10, output: 50, cacheRead: 0.25 },
  { id: 'claude-mythos-5-1', label: 'Claude Mythos 5.1', input: 10, output: 50, cacheRead: 0.25 },
  { id: 'claude-fable-5', label: 'Claude Fable 5', input: 10, output: 50, cacheRead: 1 },
  { id: 'claude-opus-5', label: 'Claude Opus 5', input: 5, output: 25, cacheRead: 0.5 },
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', input: 5, output: 25, cacheRead: 0.5 },
  { id: 'claude-opus-4-7', label: 'Claude Opus 4.7', input: 5, output: 25, cacheRead: 0.5 },
  { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', input: 5, output: 25, cacheRead: 0.5 },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', input: 2, output: 10, cacheRead: 0.2 },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', input: 3, output: 15, cacheRead: 0.3 },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', input: 1, output: 5, cacheRead: 0.1 },
];

/** unknown ids fall back to the current model of the same family (cost flagged as estimated) */
const FAMILY_DEFAULT: [RegExp, string][] = [
  [/haiku/, 'claude-haiku-5-5'],
  [/sonnet/, 'claude-sonnet-5-5'],
  [/opus/, 'claude-opus-5-5'],
  [/fable|mythos/, 'claude-fable-5-1'],
];

/** "us.anthropic.claude-opus-5-5-20260101[1m]" → "claude-opus-5-5" (best effort) */
export function normalizeModelId(model: string): string {
  let m = model.trim().toLowerCase();
  m = m.replace(/\[[^\]]*\]$/, ''); // [1m] context suffix
  m = m.replace(/^(?:[a-z]{2,4}\.)?anthropic\./, ''); // Bedrock prefixes
  m = m.replace(/@.*$/, ''); // Vertex "@20251101"
  m = m.replace(/-(?:v\d+(?::\d+)?)$/, ''); // Bedrock "-v1:0"
  m = m.replace(/-20\d{6}$/, ''); // dated snapshot
  return m;
}

export function priceFor(model: string): { price: ModelPrice; estimated: boolean } | null {
  const id = normalizeModelId(model);
  const exact = PRICES.find((p) => p.id === id);
  if (exact) return { price: exact, estimated: false };
  const prefix = PRICES.filter((p) => id.startsWith(p.id + '-')).sort((a, b) => b.id.length - a.id.length)[0];
  if (prefix) return { price: prefix, estimated: false };
  const fam = FAMILY_DEFAULT.find(([re]) => re.test(id));
  if (fam) return { price: PRICES.find((p) => p.id === fam[1])!, estimated: true };
  return null;
}

export function modelLabel(model: string): string {
  const id = normalizeModelId(model);
  return PRICES.find((p) => p.id === id)?.label ?? model;
}

export interface TokenCounts {
  /** uncached input tokens */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  /** all cache writes (5-minute + 1-hour TTL) */
  cacheWriteTokens: number;
  /** the part of cacheWriteTokens written with the 1-hour TTL (2×); the rest is billed at 1.25× */
  cacheWrite1hTokens?: number;
}

/**
 * Cost of ONE request (the long-context tier is decided per request). For aggregates over
 * many short requests this is exact as long as none of them crossed the tier threshold.
 */
export function costUSD(model: string, t: TokenCounts): { usd: number; estimated: boolean; known: boolean } {
  const hit = priceFor(model);
  if (!hit) return { usd: 0, estimated: true, known: false };
  const p = hit.price;
  const prompt = t.inputTokens + t.cacheReadTokens + t.cacheWriteTokens;
  const tier = p.longContext && prompt > p.longContext.threshold ? p.longContext : p;
  const w1h = Math.min(t.cacheWriteTokens, Math.max(0, t.cacheWrite1hTokens ?? 0));
  const w5m = t.cacheWriteTokens - w1h;
  const usd = (t.inputTokens * tier.input + t.outputTokens * tier.output + t.cacheReadTokens * tier.cacheRead + w5m * tier.input * CACHE_WRITE_5M + w1h * tier.input * CACHE_WRITE_1H) / 1e6;
  return { usd, estimated: hit.estimated, known: true };
}
