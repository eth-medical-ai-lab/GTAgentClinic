/**
 * Claude Code (headless) provider: one warm, sandboxed `claude -p` process per active
 * NPC conversation, speaking stream-json. Measured ~1.1–1.4 s per turn after warm-up
 * (vs ~3 s for a cold one-shot), ~245 MB RSS per process → small LRU pool.
 *
 * Sandboxing: no tools (--tools ""), no MCP (--strict-mcp-config), no CLAUDE.md/hooks/
 * plugins (--safe-mode), nothing written to the user's session history
 * (--no-session-persistence), run from an empty temp dir.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { LlmStatus } from '../../shared/types';
import { planFromRateLimit } from '../usage';
import { costUSD, type TokenCounts } from './pricing';
import { childEnv, claudeCommand, userContent, extractJson, LlmError, type ChatRequest, type ChatResult, type ClaudeAuth, type LlmCallUsage, type LlmProvider } from './provider';

/** one entry of a result event's `modelUsage` / `model_usage_since_last_result` */
interface ModelUsageEntry {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheCreationEphemeral1hInputTokens?: number;
  costUSD?: number;
}

const n0 = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

/**
 * Per-turn usage from a stream-json `result` event. Measured on Claude Code 2.1.319 with one
 * warm process over several turns:
 *   • per turn:               `model_usage_since_last_result` (with costUSD), `usage`, `duration_ms`
 *   • cumulative per process: `modelUsage`, `total_cost_usd`, `duration_api_ms`
 * `--json-schema` is a forced `StructuredOutput` tool call that ends the turn: ONE API request
 * per NPC turn (`usage.iterations` has one entry; `num_turns` says 2 because the synthetic
 * tool_result counts). Fallbacks for older CLIs: diff the cumulative `modelUsage` against the
 * previous result of the same process, else the per-turn `usage` priced with our table.
 */
export function usageFromClaudeResult(
  ev: Record<string, unknown>,
  opts: { fallbackModel: string; latencyMs: number; prevCumulative?: Record<string, ModelUsageEntry> },
): LlmCallUsage | undefined {
  const u = ev.usage as Record<string, unknown> | undefined;
  const requests = Array.isArray(u?.iterations) && u.iterations.length ? u.iterations.length : 1;
  let entries = ev.model_usage_since_last_result as Record<string, ModelUsageEntry> | undefined;
  if ((!entries || typeof entries !== 'object' || !Object.keys(entries).length) && ev.modelUsage && typeof ev.modelUsage === 'object' && opts.prevCumulative) {
    const keys = ['inputTokens', 'outputTokens', 'cacheReadInputTokens', 'cacheCreationInputTokens', 'cacheCreationEphemeral1hInputTokens', 'costUSD'] as const;
    const cum = ev.modelUsage as Record<string, ModelUsageEntry>;
    // cumulative iff nothing went backwards since the previous result of this process
    const monotonic = Object.entries(cum).every(([m, cur]) => keys.every((k) => n0(cur[k]) >= n0(opts.prevCumulative![m]?.[k])));
    entries = {};
    for (const [model, cur] of Object.entries(cum)) {
      const prev = monotonic ? (opts.prevCumulative[model] ?? {}) : {};
      const e: ModelUsageEntry = {};
      for (const k of keys) if (k !== 'costUSD' || typeof cur.costUSD === 'number') e[k] = n0(cur[k]) - n0(prev[k]);
      entries[model] = e;
    }
  }
  if (entries && typeof entries === 'object' && Object.keys(entries).length) {
    const out: LlmCallUsage = { model: opts.fallbackModel, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cacheWrite1hTokens: 0, costUSD: 0, costSource: 'claude-code', requests, latencyMs: opts.latencyMs };
    let top = -1;
    for (const [model, e] of Object.entries(entries)) {
      const t: TokenCounts = { inputTokens: n0(e.inputTokens), outputTokens: n0(e.outputTokens), cacheReadTokens: n0(e.cacheReadInputTokens), cacheWriteTokens: n0(e.cacheCreationInputTokens), cacheWrite1hTokens: n0(e.cacheCreationEphemeral1hInputTokens) };
      const usd = typeof e.costUSD === 'number' ? n0(e.costUSD) : costUSD(model, t).usd;
      if (typeof e.costUSD !== 'number') out.costSource = 'price-table';
      out.inputTokens += t.inputTokens;
      out.outputTokens += t.outputTokens;
      out.cacheReadTokens += t.cacheReadTokens;
      out.cacheWriteTokens += t.cacheWriteTokens;
      out.cacheWrite1hTokens! += t.cacheWrite1hTokens!;
      out.costUSD += usd;
      if (usd > top) {
        top = usd;
        out.model = model;
      }
    }
    return out;
  }
  if (u && typeof u === 'object') {
    const cc = u.cache_creation as Record<string, unknown> | undefined;
    const t: TokenCounts = { inputTokens: n0(u.input_tokens), outputTokens: n0(u.output_tokens), cacheReadTokens: n0(u.cache_read_input_tokens), cacheWriteTokens: n0(u.cache_creation_input_tokens), cacheWrite1hTokens: n0(cc?.ephemeral_1h_input_tokens) };
    return { model: opts.fallbackModel, ...t, costUSD: costUSD(opts.fallbackModel, t).usd, costSource: 'price-table', requests, latencyMs: opts.latencyMs };
  }
  return undefined;
}

interface Proc {
  key: string;
  child: ChildProcessWithoutNullStreams;
  system: string;
  schema: string;
  /** --model of this process (a request for another model respawns it) */
  model: string;
  turns: number;
  busy: boolean;
  lastUsed: number;
  waiters: { resolve: (ev: Record<string, unknown>) => void; reject: (e: Error) => void }[];
  dead: boolean;
  /** last cumulative `modelUsage` (fallback per-turn accounting for older CLIs) */
  cumulative?: Record<string, ModelUsageEntry>;
  /** latest `rate_limit_event.rate_limit_info` not yet handed to the ledger */
  rateLimit?: unknown;
}

const POOL = Math.max(1, Number(process.env.AGENTCLINIC_POOL ?? 4));
const IDLE_MS = 4 * 60 * 1000;
const TURN_TIMEOUT_MS = 60 * 1000;
const MODEL = process.env.AGENTCLINIC_MODEL ?? 'haiku';

export class ClaudeCodeProvider implements LlmProvider {
  readonly status: LlmStatus;
  readonly billing: 'subscription' | 'api';
  private procs = new Map<string, Proc>();
  private cwd: string;
  private sweeper: ReturnType<typeof setInterval>;

  constructor(auth: ClaudeAuth, private model = MODEL) {
    const sub = auth.subscriptionType?.trim();
    const plan = sub ? ` (${sub[0].toUpperCase()}${sub.slice(1)} plan)` : '';
    this.billing = auth.authMethod === 'claude.ai' || sub ? 'subscription' : 'api';
    this.status = {
      provider: 'claude-code',
      label: `Claude Code — your ${auth.authMethod === 'claude.ai' ? 'claude.ai login' : 'login'}${plan}`,
      model: this.model === 'haiku' ? 'Claude Haiku (latest)' : this.model,
      ok: true,
      detail: `Your own Claude Code on this machine: each character line is a small request that ${this.billing === 'subscription' ? "counts toward your plan's usage" : 'is billed to your account'} (◆ in game).`,
    };
    this.cwd = join(tmpdir(), 'GTAgentClinic-npc');
    mkdirSync(this.cwd, { recursive: true });
    this.sweeper = setInterval(() => this.sweep(), 30_000);
    this.sweeper.unref?.();
  }

  private spawnProc(key: string, system: string, schema: string, model = MODEL): Proc {
    const args = [
      '-p',
      '--model', model,
      '--effort', 'low',
      '--system-prompt', system,
      '--tools', '',
      '--strict-mcp-config',
      '--safe-mode',
      '--no-session-persistence',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      '--json-schema', schema,
    ];
    const c = claudeCommand();
    const child = spawn(c.cmd, [...c.pre, ...args], { cwd: this.cwd, env: childEnv(), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const proc: Proc = { key, child, system, schema, model, turns: 0, busy: false, lastUsed: Date.now(), waiters: [], dead: false };
    const rl = createInterface({ input: child.stdout });
    rl.on('line', (line) => {
      let ev: Record<string, unknown>;
      try {
        ev = JSON.parse(line);
      } catch {
        return;
      }
      if (ev.type === 'result') proc.waiters.shift()?.resolve(ev);
      else if (ev.type === 'rate_limit_event') proc.rateLimit = ev.rate_limit_info;
    });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr = (stderr + d.toString()).slice(-2000)));
    child.on('exit', (code) => {
      proc.dead = true;
      for (const w of proc.waiters.splice(0)) w.reject(new Error(`claude exited (${code}): ${stderr.trim().slice(-300)}`));
      if (this.procs.get(key) === proc) this.procs.delete(key);
    });
    child.on('error', (e) => {
      proc.dead = true;
      for (const w of proc.waiters.splice(0)) w.reject(e);
    });
    this.procs.set(key, proc);
    this.evict();
    return proc;
  }

  private evict() {
    if (this.procs.size <= POOL) return;
    const idle = [...this.procs.values()].filter((p) => !p.busy).sort((a, b) => a.lastUsed - b.lastUsed);
    while (this.procs.size > POOL && idle.length) this.kill(idle.shift()!);
  }

  private sweep() {
    const now = Date.now();
    for (const p of this.procs.values()) if (!p.busy && now - p.lastUsed > IDLE_MS) this.kill(p);
  }

  private kill(p: Proc) {
    this.procs.delete(p.key);
    p.dead = true;
    try {
      p.child.stdin.end();
      p.child.kill();
    } catch {
      /* ignore */
    }
  }

  private send(p: Proc, text: ReturnType<typeof userContent>): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('NPC reply timed out'));
        this.kill(p);
      }, TURN_TIMEOUT_MS);
      p.waiters.push({
        resolve: (ev) => {
          clearTimeout(timer);
          resolve(ev);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      p.child.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: text } }) + '\n');
    });
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    const t0 = Date.now();
    const schema = JSON.stringify(req.schema);
    let p = this.procs.get(req.key);
    const priorTurns = Math.floor(req.history.length / 2);
    let message = req.message;
    const model = req.model ?? this.model;
    if (!p || p.dead || p.system !== req.system || p.schema !== schema || p.model !== model || p.turns !== priorTurns) {
      if (p) this.kill(p);
      p = this.spawnProc(req.key, req.system, schema, model);
      if (req.history.length) {
        const transcript = req.history.map((h) => (h.role === 'user' ? h.content : `You replied: ${h.content}`)).join('\n\n');
        message = `(Conversation so far, for context — stay consistent with it.)\n${transcript}\n\n(New message.)\n${req.message}`;
      }
    }
    while (p.busy) await new Promise((r) => setTimeout(r, 50));
    p.busy = true;
    try {
      const ev = await this.send(p, userContent(message, req.screenshot));
      p.turns = priorTurns + 1;
      p.lastUsed = Date.now();
      const latencyMs = Date.now() - t0;
      const usage = usageFromClaudeResult(ev, { fallbackModel: p.model, latencyMs, prevCumulative: p.cumulative ?? {} });
      if (ev.modelUsage && typeof ev.modelUsage === 'object') p.cumulative = ev.modelUsage as Record<string, ModelUsageEntry>;
      const plan = planFromRateLimit(p.rateLimit);
      p.rateLimit = undefined;
      if (ev.is_error) throw new LlmError(String(ev.result ?? 'Claude Code error'), usage);
      const structured = (ev.structured_output ?? null) as Record<string, unknown> | null;
      const text = typeof ev.result === 'string' ? ev.result : '';
      return { json: structured ?? extractJson(text), text, latencyMs, usage, plan };
    } finally {
      p.busy = false;
    }
  }

  forget(keyPrefix: string) {
    for (const p of [...this.procs.values()]) if (p.key.startsWith(keyPrefix)) this.kill(p);
  }

  dispose() {
    clearInterval(this.sweeper);
    for (const p of [...this.procs.values()]) this.kill(p);
  }
}
