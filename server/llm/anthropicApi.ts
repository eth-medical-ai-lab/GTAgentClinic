/**
 * Anthropic API provider (API key or `ant auth login` profile). This is the path for a
 * hosted/public deployment: the operator's key on a server, players need no account.
 * Claude Haiku 5.5: $0.10 / $0.50 per MTok (≤100K prompt) — a whole shift of NPC
 * dialogue costs on the order of cents.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { LlmStatus } from '../../shared/types';
import { costUSD, type TokenCounts } from './pricing';
import { userContent, extractJson, HAIKU_MODEL, type ChatRequest, type ChatResult, type LlmCallUsage, type LlmProvider } from './provider';

/** `res.usage` → per-call usage priced with server/llm/pricing.ts (cache writes here use the default 5-min TTL) */
export function usageFromApi(model: string, u: Anthropic.Usage, latencyMs: number): LlmCallUsage {
  const t: TokenCounts = {
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
    cacheWrite1hTokens: u.cache_creation?.ephemeral_1h_input_tokens ?? 0,
  };
  return { model, ...t, costUSD: costUSD(model, t).usd, costSource: 'price-table', requests: 1, latencyMs };
}

export class AnthropicApiProvider implements LlmProvider {
  readonly status: LlmStatus;
  readonly billing = 'api' as const;
  private client: Anthropic;
  private model: string;

  constructor(model?: string) {
    this.client = new Anthropic();
    this.model = model ?? (process.env.AGENTCLINIC_MODEL && process.env.AGENTCLINIC_MODEL.startsWith('claude-') ? process.env.AGENTCLINIC_MODEL : HAIKU_MODEL);
    this.status = { provider: 'anthropic-api', label: 'Anthropic API (API key)', model: this.model, ok: true, detail: 'NPCs run on the Claude API.' };
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    const t0 = Date.now();
    const model = req.model?.startsWith('claude-') ? req.model : this.model;
    const res = await this.client.messages.create({
      model,
      max_tokens: 1024,
      // stable persona prefix first → cacheable across turns of the same NPC
      system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
      messages: [...req.history.map((h) => ({ role: h.role, content: h.content })), { role: 'user' as const, content: userContent(req.message, req.screenshot) }],
      output_config: { effort: 'low', format: { type: 'json_schema', schema: req.schema } },
    });
    const latencyMs = Date.now() - t0;
    const usage = res.usage ? usageFromApi(res.model ?? model, res.usage, latencyMs) : undefined;
    if (res.stop_reason === 'refusal') return { json: null, text: '', latencyMs, usage };
    let text = '';
    for (const block of res.content) if (block.type === 'text') text += block.text;
    return { json: extractJson(text), text, latencyMs, usage };
  }

  forget() {}
  dispose() {}
}
