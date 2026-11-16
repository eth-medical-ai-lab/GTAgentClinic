import type { TokenCounts } from './pricing';

/** Shared Codex and OpenAI API estimates: Standard USD per million tokens, verified 2026-11-15.
 * https://developers.openai.com/api/docs/pricing
 * Legacy rates: https://developers.openai.com/api/docs/models/gpt-5.3-codex
 * (and the corresponding gpt-5.2-codex / gpt-5.1-codex model pages).
 * Estimates only: Codex reports turn totals, not individual request sizes or cache TTL.
 * Use 30-minute cache writes and the turn's input total for the context tier.
 * No Fast, regional or subscription-allowance conversion is inferred.
 */
export const CODEX_PRICES: Readonly<Record<string, {
  input: number; cached: number; output: number; write?: number; longContext?: boolean;
}>> = {
  'gpt-6-luna': { input: 0.1, cached: 0.01, output: 0.5, write: 0.125, longContext: true },
  'gpt-6.1-sol': { input: 2, cached: 0.1, output: 10, write: 2.5, longContext: true },
  'gpt-6-astra': { input: 10, cached: 1, output: 50, write: 12.5, longContext: true },
  'gpt-5.6-sol': { input: 4, cached: 0.4, output: 20, write: 5, longContext: true },
  'gpt-5.6-terra': { input: 2, cached: 0.2, output: 12, write: 2.5, longContext: true },
  'gpt-5.6-luna': { input: 0.2, cached: 0.02, output: 1.2, write: 0.25, longContext: true },
  'gpt-5.3-codex': { input: 1.75, cached: 0.175, output: 14 },
  'gpt-5.2-codex': { input: 1.75, cached: 0.175, output: 14 },
  'gpt-5.1-codex': { input: 1.25, cached: 0.125, output: 10 },
};

export function codexCostUSD(model: string, t: TokenCounts): number | undefined {
  const p = Object.hasOwn(CODEX_PRICES, model === 'gpt-5.6' ? 'gpt-5.6-sol' : model)
    ? CODEX_PRICES[model === 'gpt-5.6' ? 'gpt-5.6-sol' : model] : undefined;
  if (!p || (t.cacheWriteTokens > 0 && p.write === undefined)) return undefined;
  const long = p.longContext && t.inputTokens + t.cacheReadTokens + t.cacheWriteTokens > 272_000;
  const input = t.inputTokens * p.input + t.cacheReadTokens * p.cached + t.cacheWriteTokens * (p.write ?? 0);
  return (input * (long ? 2 : 1) + t.outputTokens * p.output * (long ? 1.5 : 1)) / 1e6;
}
