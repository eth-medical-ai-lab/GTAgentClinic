/**
 * NpcBrain: routes an NPC turn to the LLM provider (or the offline fallback), validates
 * the structured reply, and maintains the LLM-facing history.
 */
import type { LlmStatus } from '../../shared/types';
import type { Emotion } from '../../shared/types';
import { LlmError, offlineStatus, type LlmCallUsage, type LlmProvider } from '../llm/provider';
import type { Conversation } from '../sim/session';
import { usage as processLedger, type UsageLedger } from '../usage';
import { offlineReply, type OfflineCtx } from './offline';
import { EMOTIONS, type NpcSpec } from './prompts';

export interface NpcAction {
  id: string;
  patient?: string;
  code?: string;
  dose?: string;
}

export interface NpcReply {
  say: string;
  emotion: Emotion;
  revealed: string[];
  counseled: string[];
  actions: NpcAction[];
  source?: 'llm' | 'offline';
  latencyMs?: number;
  /** why an LLM-backed brain answered offline */
  fallback?: 'budget';
  /** one-time explanation for the player (e.g. budget reached) — shown as a toast */
  notice?: string;
}

const MAX_CONCURRENT = 4;

export class NpcBrain {
  private running = 0;
  private waiting: (() => void)[] = [];
  degraded = 0;

  constructor(
    readonly provider: LlmProvider | null,
    /** where this brain's token usage is recorded (the process-wide ledger by default) */
    readonly ledger: UsageLedger = processLedger,
  ) {}

  get status(): LlmStatus {
    const s = this.provider?.status ?? offlineStatus();
    if (this.provider && this.ledger.overBudget()) return { ...s, ok: false, detail: 'LLM budget for this server run reached (--max-tokens / --max-usd) — NPCs use scripted offline replies.' };
    return this.degraded > 3 ? { ...s, ok: false, detail: `${s.detail ?? ''} (recent NPC errors — using offline replies as fallback)` } : s;
  }

  private record(spec: NpcSpec, conv: Conversation, u: LlmCallUsage | undefined) {
    if (!u) return;
    // spec keys are `${sessionId}:…` (server/npc/dialogue.ts); session ids contain no ':'
    this.ledger.recordNpc(spec.key.split(':')[0], conv.key, spec.name, u);
  }

  private async slot<T>(fn: () => Promise<T>): Promise<T> {
    if (this.running >= MAX_CONCURRENT) await new Promise<void>((r) => this.waiting.push(r));
    this.running++;
    try {
      return await fn();
    } finally {
      this.running--;
      this.waiting.shift()?.();
    }
  }

  async reply(spec: NpcSpec, conv: Conversation, situation: string, text: string, offline: OfflineCtx, useLlm = true): Promise<NpcReply> {
    const message = `${situation}\nDoctor: ${text}`;
    let reply: NpcReply | null = null;
    const overBudget = !!this.provider && useLlm && this.ledger.overBudget();
    if (this.provider && useLlm && !overBudget) {
      try {
        const res = await this.slot(() => this.provider!.chat({ key: spec.key, system: spec.system, schema: spec.schema, history: conv.history, message }));
        this.record(spec, conv, res.usage);
        this.ledger.setPlan(res.plan);
        reply = this.validate(spec, res.json, res.text);
        if (reply) {
          reply.source = 'llm';
          reply.latencyMs = res.latencyMs;
          this.degraded = Math.max(0, this.degraded - 1);
        }
      } catch (e) {
        if (e instanceof LlmError) this.record(spec, conv, e.usage);
        this.degraded++;
        console.warn(`[npc] ${spec.name}: LLM error — ${(e as Error).message.slice(0, 200)}`);
      }
    }
    if (!reply) {
      reply = spec.offline ? spec.offline(text, offline) : offlineReply(spec, text, offline);
      reply.source = 'offline';
      if (overBudget) {
        reply.fallback = 'budget';
        if (this.ledger.claimBudgetNotice(spec.key.split(':')[0])) reply.notice = this.ledger.budgetNotice();
      }
    }
    conv.history.push({ role: 'user', content: message });
    conv.history.push({ role: 'assistant', content: JSON.stringify({ say: reply.say, emotion: reply.emotion, revealed: reply.revealed, counseled: reply.counseled, actions: reply.actions }) });
    // keep the LLM-facing history bounded (warm sessions keep their own context)
    if (conv.history.length > 40) conv.history.splice(0, conv.history.length - 40);
    return reply;
  }

  private validate(spec: NpcSpec, json: Record<string, unknown> | null, text: string): NpcReply | null {
    if (!json) {
      const say = text.trim();
      return say ? { say, emotion: 'neutral', revealed: [], counseled: [], actions: [] } : null;
    }
    const say = typeof json.say === 'string' ? json.say.trim() : '';
    if (!say) return null;
    const emotion = (EMOTIONS as readonly string[]).includes(json.emotion as string) ? (json.emotion as Emotion) : 'neutral';
    const arr = (v: unknown) => (Array.isArray(v) ? v : []);
    const revealed = arr(json.revealed).filter((x): x is string => typeof x === 'string' && spec.factIds.includes(x));
    const counseled = arr(json.counseled).filter((x): x is string => typeof x === 'string' && spec.counselIds.includes(x));
    const actions = arr(json.actions)
      .filter((a): a is NpcAction => !!a && typeof a === 'object' && typeof (a as NpcAction).id === 'string' && spec.actionIds.includes((a as NpcAction).id))
      .slice(0, 6);
    return { say, emotion, revealed, counseled, actions };
  }

  forget(keyPrefix: string) {
    this.provider?.forget(keyPrefix);
  }
}
