/**
 * Token/cost meter for a Claude Code `--output-format stream-json --verbose` run (the AI
 * doctor). One entry per API message, deduplicated by message id:
 *   • with --include-partial-messages, `stream_event` message_start + message_delta give the
 *     exact final usage of every message;
 *   • otherwise `assistant` events carry `message.usage` as of message_start — one message is
 *     split over several assistant events (one per content block) with the same id and the
 *     same snapshot, and output_tokens is then only a lower bound;
 *   • the final `result` event (total_cost_usd, modelUsage — cumulative for the run) is
 *     authoritative and replaces the running estimate.
 * Costs come from server/llm/pricing.ts (list prices — "API-equivalent" on a subscription).
 */
import type { PlanUsage, UsageTotals } from '../shared/types';
import { costUSD, type TokenCounts } from '../server/llm/pricing';
import { emptyTotals, planFromRateLimit } from '../server/usage';

interface Msg {
  model: string;
  t: Required<TokenCounts>;
  startedAt: number;
  latencyMs: number;
}

type Json = Record<string, unknown>;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined);
const obj = (v: unknown): Json | undefined => (v && typeof v === 'object' ? (v as Json) : undefined);

export interface MeterTotals extends UsageTotals {
  /** the model with the largest share of the cost */
  model?: string;
  /** true once the run's `result` event replaced the running estimate */
  final: boolean;
}

export class StreamUsageMeter {
  private msgs = new Map<string, Msg>();
  /** message currently streaming, per lane (subagents stream with a parent_tool_use_id) */
  private open = new Map<string, string>();
  private result?: { costUSD: number; t: TokenCounts; apiMs: number; model?: string };
  plan?: PlanUsage;
  billing: 'subscription' | 'api' | 'unknown' = 'unknown';
  private sawStream = false;

  /** Feed one parsed event. Returns a message id when that message's usage just became known
   *  (final with partial messages; first sighting without) — the caller prints a running total. */
  onEvent(ev: Json, now = Date.now()): string | null {
    switch (ev.type) {
      case 'system':
        if (ev.subtype === 'init' && typeof ev.apiKeySource === 'string') this.billing = ev.apiKeySource === 'none' ? 'subscription' : 'api';
        return null;
      case 'rate_limit_event':
        this.plan = planFromRateLimit(ev.rate_limit_info, now) ?? this.plan;
        return null;
      case 'stream_event': {
        this.sawStream = true;
        const e = obj(ev.event) ?? {};
        const lane = typeof ev.parent_tool_use_id === 'string' ? ev.parent_tool_use_id : 'main';
        const m = obj(e.message);
        if (e.type === 'message_start' && typeof m?.id === 'string') {
          this.open.set(lane, m.id);
          this.merge(m.id, typeof m.model === 'string' ? m.model : undefined, obj(m.usage), now, false);
        } else if (e.type === 'message_delta' && obj(e.usage)) {
          const id = this.open.get(lane);
          if (id) {
            this.merge(id, undefined, obj(e.usage), now, true);
            return id;
          }
        }
        return null;
      }
      case 'assistant': {
        const m = obj(ev.message);
        if (typeof m?.id !== 'string' || this.msgs.has(m.id)) return null;
        this.merge(m.id, typeof m.model === 'string' ? m.model : undefined, obj(m.usage), now, false);
        return this.sawStream ? null : m.id;
      }
      case 'result': {
        const t: Required<TokenCounts> = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cacheWrite1hTokens: 0 };
        let model: string | undefined;
        let top = -1;
        for (const [id, mu] of Object.entries(obj(ev.modelUsage) ?? {})) {
          const e = obj(mu) ?? {};
          t.inputTokens += num(e.inputTokens) ?? 0;
          t.outputTokens += num(e.outputTokens) ?? 0;
          t.cacheReadTokens += num(e.cacheReadInputTokens) ?? 0;
          t.cacheWriteTokens += num(e.cacheCreationInputTokens) ?? 0;
          t.cacheWrite1hTokens += num(e.cacheCreationEphemeral1hInputTokens) ?? 0;
          if ((num(e.costUSD) ?? 0) > top) {
            top = num(e.costUSD) ?? 0;
            model = id;
          }
        }
        const total = num(ev.total_cost_usd);
        if (total !== undefined || model) this.result = { costUSD: total ?? costUSD(model ?? 'sonnet', t).usd, t, apiMs: num(ev.duration_api_ms) ?? 0, model };
        return null;
      }
    }
    return null;
  }

  private merge(id: string, model: string | undefined, u: Json | undefined, now: number, final: boolean) {
    let m = this.msgs.get(id);
    if (!m) {
      m = { model: model ?? 'unknown', t: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cacheWrite1hTokens: 0 }, startedAt: now, latencyMs: 0 };
      this.msgs.set(id, m);
    }
    if (model) m.model = model;
    if (u) {
      const set = (k: keyof TokenCounts, v: unknown) => {
        if (num(v) !== undefined) m!.t[k] = num(v)!;
      };
      set('inputTokens', u.input_tokens);
      set('outputTokens', u.output_tokens);
      set('cacheReadTokens', u.cache_read_input_tokens);
      set('cacheWriteTokens', u.cache_creation_input_tokens);
      set('cacheWrite1hTokens', obj(u.cache_creation)?.ephemeral_1h_input_tokens);
    }
    if (final) m.latencyMs = now - m.startedAt;
  }

  totals(): MeterTotals {
    const t = emptyTotals();
    const byModel = new Map<string, number>();
    for (const m of this.msgs.values()) {
      t.calls++;
      t.requests++;
      t.inputTokens += m.t.inputTokens;
      t.outputTokens += m.t.outputTokens;
      t.cacheReadTokens += m.t.cacheReadTokens;
      t.cacheWriteTokens += m.t.cacheWriteTokens;
      t.latencyMs += m.latencyMs;
      const usd = costUSD(m.model, m.t).usd;
      t.costUSD += usd;
      byModel.set(m.model, (byModel.get(m.model) ?? 0) + usd);
    }
    let model = [...byModel.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (this.result) {
      const r = this.result;
      Object.assign(t, { inputTokens: r.t.inputTokens, outputTokens: r.t.outputTokens, cacheReadTokens: r.t.cacheReadTokens, cacheWriteTokens: r.t.cacheWriteTokens, costUSD: r.costUSD });
      if (r.apiMs) t.latencyMs = r.apiMs;
      model = r.model ?? model;
    }
    return { ...t, model, final: !!this.result };
  }
}
