/**
 * Usage ledger: tokens and (API-equivalent) cost of every LLM call the game makes —
 * per session (shift), per NPC/contact within a session, per server process, and per
 * local day + all-time (persisted to data/usage.json) — plus the AI doctor's own spend
 * as reported by its launcher (POST /api/sessions/:id/usage). Also hosts the optional
 * per-process budget guard (--max-tokens / --max-usd, off by default).
 *
 * Importing this module has no side effects; persistence is enabled by configure({file}).
 * Writes merge into whatever is on disk (re-read → add the unflushed deltas → atomic
 * rename), so two servers sharing a data/ dir don't clobber each other's totals.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AgentUsageView, LlmStatus, PlanUsage, PlanWindow, UsageSummary, PricedUsageTotals as UsageTotals, UsageView } from '../shared/types';
import { fmtTokens, fmtUSD, totalTokens } from '../shared/usage';
import type { LlmCallUsage } from './llm/provider';

export { cacheHitRate, fmtTokens, fmtUSD, totalTokens } from '../shared/usage';

// ───────────────────────────── totals helpers ─────────────────────────────

const FIELDS = ['calls', 'requests', 'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'costUSD', 'latencyMs'] as const;
const ESTIMATE_FIELDS = ['codexPricedCalls', 'codexUnpricedCalls', 'openaiPricedCalls', 'openaiUnpricedCalls'] as const;

export function emptyTotals(): UsageTotals {
  return { calls: 0, requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUSD: 0, latencyMs: 0 };
}

/** into += d (in place); ignores missing / non-finite fields */
export function addTotals(into: UsageTotals, d: Partial<UsageTotals>): UsageTotals {
  for (const k of FIELDS) {
    const v = d[k];
    if (typeof v === 'number' && Number.isFinite(v)) into[k] += v;
  }
  for (const k of ESTIMATE_FIELDS) {
    const v = d[k];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) into[k] = (into[k] ?? 0) + v;
  }
  return into;
}

export function callTotals(u: LlmCallUsage): UsageTotals {
  return {
    calls: 1,
    requests: u.requests,
    inputTokens: u.inputTokens,
    outputTokens: u.outputTokens,
    cacheReadTokens: u.cacheReadTokens,
    cacheWriteTokens: u.cacheWriteTokens,
    costUSD: u.costUSD,
    latencyMs: u.latencyMs,
    ...(u.codexPricedCalls !== undefined ? { codexPricedCalls: u.codexPricedCalls, codexUnpricedCalls: u.codexUnpricedCalls ?? 0 } : {}),
    ...(u.openaiPricedCalls !== undefined ? { openaiPricedCalls: u.openaiPricedCalls, openaiUnpricedCalls: u.openaiUnpricedCalls ?? 0 } : {}),
  };
}

export function dayKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** "50k" / "1.5M" / "200000" → number (undefined if empty/invalid/≤0) */
export function parseAmount(v: string | number | undefined | null): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const m = /^\s*\$?([\d.]+)\s*([kKmM]?)\s*$/.exec(String(v));
  if (!m) return undefined;
  const n = Number(m[1]) * (m[2].toLowerCase() === 'k' ? 1e3 : m[2].toLowerCase() === 'm' ? 1e6 : 1);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

// ───────────────────────────── subscription windows ─────────────────────────────

const WINDOW_LABELS: Record<string, string> = {
  five_hour: '5-h window',
  seven_day: '7-day window',
  seven_day_opus: '7-day Opus',
  seven_day_sonnet: '7-day Sonnet',
};
const WINDOW_ORDER = ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet'];

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown, max = 60) => (typeof v === 'string' && v ? v.slice(0, max) : undefined);

/** Claude Code stream-json `rate_limit_event.rate_limit_info` → PlanUsage (undefined if nothing usable). */
export function planFromRateLimit(info: unknown, at = Date.now()): PlanUsage | undefined {
  if (!info || typeof info !== 'object') return undefined;
  const i = info as Record<string, unknown>;
  const windows: PlanWindow[] = [];
  if (i.unifiedWindows && typeof i.unifiedWindows === 'object') {
    for (const [id, w] of Object.entries(i.unifiedWindows as Record<string, Record<string, unknown> | null>)) {
      const u = num(w?.utilization);
      if (u === undefined) continue;
      windows.push({ id: id.slice(0, 40), label: WINDOW_LABELS[id] ?? id.replace(/_/g, ' '), utilization: u, resetsAt: num(w?.resetsAt), status: str(w?.status) });
    }
  }
  const limiting = str(i.rateLimitType);
  if (!windows.length && limiting && num(i.utilization) !== undefined) {
    windows.push({ id: limiting, label: WINDOW_LABELS[limiting] ?? limiting, utilization: num(i.utilization)!, resetsAt: num(i.resetsAt), status: str(i.status) });
  }
  if (!windows.length && !str(i.status)) return undefined;
  const rank = (id: string) => (WINDOW_ORDER.indexOf(id) + 1 || 99);
  windows.sort((a, b) => rank(a.id) - rank(b.id));
  return { windows, status: str(i.status), limitingWindow: limiting, usingOverage: i.isUsingOverage === true, at };
}

function sanitizePlan(p: unknown): PlanUsage | undefined {
  if (!p || typeof p !== 'object') return undefined;
  const o = p as Record<string, unknown>;
  const windows = (Array.isArray(o.windows) ? o.windows : [])
    .slice(0, 8)
    .filter((w): w is Record<string, unknown> => !!w && typeof w === 'object' && typeof (w as PlanWindow).id === 'string' && num((w as PlanWindow).utilization) !== undefined)
    .map((w) => ({ id: str(w.id, 40)!, label: str(w.label) ?? str(w.id, 40)!, utilization: Math.max(0, Math.min(10, num(w.utilization)!)), resetsAt: num(w.resetsAt), status: str(w.status) }));
  return { windows, status: str(o.status), limitingWindow: str(o.limitingWindow), usingOverage: o.usingOverage === true, at: num(o.at) ?? Date.now() };
}

// ───────────────────────────── agent reports ─────────────────────────────

export interface AgentReport extends UsageTotals {
  costAvailable?: boolean;
  label: string;
  model?: string;
  billing: AgentUsageView['billing'];
  final: boolean;
  plan?: PlanUsage;
}

const MAX_TOKENS_FIELD = 1e12;

/** Validate an untrusted POST body (cumulative agent usage). */
export function sanitizeAgentReport(body: unknown): AgentReport | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const t = emptyTotals();
  for (const k of FIELDS) {
    const v = b[k];
    if (v === undefined) continue;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > (k === 'costUSD' ? 1e6 : MAX_TOKENS_FIELD)) return null;
    t[k] = v;
  }
  if (totalTokens(t) === 0 && t.costUSD === 0 && t.calls === 0) return null;
  for (const k of ESTIMATE_FIELDS) {
    if (b[k] === undefined) continue;
    const value = b[k];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > t.calls) return null;
    t[k] = value;
  }
  if (ESTIMATE_FIELDS.reduce((sum, k) => sum + (t[k] ?? 0), 0) > t.calls) return null;
  const billing = b.billing === 'subscription' || b.billing === 'api' ? b.billing : 'unknown';
  return { ...t, ...(b.costAvailable === false ? { costAvailable: false } : {}), label: str(b.label, 80) ?? 'AI doctor', model: str(b.model, 80), billing, final: b.final === true, plan: sanitizePlan(b.plan) };
}

// ───────────────────────────── persistence ─────────────────────────────

interface Bucket {
  npc: UsageTotals;
  agent: UsageTotals;
}

interface PersistedUsage {
  version: 1;
  updatedAt?: string;
  /** first local day with recorded usage */
  since?: string;
  allTime: Bucket;
  days: Record<string, Bucket>;
}

const emptyBucket = (): Bucket => ({ npc: emptyTotals(), agent: emptyTotals() });
const emptyPersisted = (): PersistedUsage => ({ version: 1, allTime: emptyBucket(), days: {} });
const MAX_DAYS = 400;

function reviveBucket(b: unknown): Bucket {
  const o = (b && typeof b === 'object' ? b : {}) as Partial<Bucket>;
  return { npc: addTotals(emptyTotals(), o.npc ?? {}), agent: addTotals(emptyTotals(), o.agent ?? {}) };
}

function readPersisted(file: string): PersistedUsage | null {
  if (!existsSync(file)) return null;
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<PersistedUsage>;
    const days: Record<string, Bucket> = {};
    for (const [k, v] of Object.entries(raw.days ?? {})) if (/^\d{4}-\d{2}-\d{2}$/.test(k)) days[k] = reviveBucket(v);
    return { version: 1, updatedAt: raw.updatedAt, since: raw.since, allTime: reviveBucket(raw.allTime), days };
  } catch (e) {
    // keep the unreadable file for inspection rather than silently overwriting it
    try {
      renameSync(file, `${file}.corrupt-${Date.now()}`);
    } catch {
      /* ignore */
    }
    console.warn(`[usage] ${file} was unreadable (${(e as Error).message}); started a fresh ledger`);
    return null;
  }
}

// ───────────────────────────── the ledger ─────────────────────────────

export interface LedgerOptions {
  /** persist per-day and all-time totals here (e.g. data/usage.json) */
  file?: string;
  /** per-process NPC budget: total tokens (input + cache read/write + output) */
  maxTokens?: number;
  /** per-process NPC budget: USD (API-equivalent for subscription logins) */
  maxUsd?: number;
  provider?: LlmStatus['provider'];
  /** NPC costs are API-equivalent estimates (subscription login) rather than a bill */
  apiEquivalent?: boolean;
  flushMs?: number;
}

interface SessionRec {
  apiEquivalent?: boolean;
  id: string;
  map?: string;
  player?: string;
  createdAt: number;
  npc: UsageTotals;
  byNpc: Map<string, { name: string; totals: UsageTotals }>;
  models: Set<string>;
  agent?: AgentUsageView;
  budgetNoticed: boolean;
}

export type UsageSnapshot = Omit<UsageView, 'today' | 'process'> & { recordedAt: string };

export class UsageLedger {
  private opts: LedgerOptions = {};
  private startedAt = Date.now();
  private proc = emptyBucket();
  private models = new Set<string>();
  private sessions = new Map<string, SessionRec>();
  private disk: PersistedUsage = emptyPersisted();
  private pending = new Map<string, Bucket>();
  private timer?: ReturnType<typeof setTimeout>;
  private writeWarned = false;
  /** latest subscription-window reading from the NPC provider */
  plan?: PlanUsage;

  configure(o: LedgerOptions) {
    this.opts = { ...this.opts, ...o };
    if (o.file) this.disk = readPersisted(o.file) ?? emptyPersisted();
    return this;
  }

  get options(): Readonly<LedgerOptions> {
    return this.opts;
  }

  registerSession(id: string, meta: { map?: string; player?: string; apiEquivalent?: boolean } = {}) {
    const r = this.rec(id);
    r.map = meta.map ?? r.map;
    r.player = meta.player ?? r.player;
    r.apiEquivalent = meta.apiEquivalent ?? r.apiEquivalent;
  }

  /** Carry forward the episode totals without charging the process or day ledger again. */
  restoreSessionUsage(id: string, saved: Pick<UsageView, 'session' | 'byNpc' | 'models'>) {
    const r = this.rec(id);
    r.npc = { ...saved.session };
    r.byNpc = new Map(saved.byNpc.map(n => [n.key, { name: n.name, totals: { ...n.totals } }]));
    r.models = new Set(saved.models);
  }

  forgetSession(id: string) {
    this.sessions.delete(id);
  }

  private rec(id: string): SessionRec {
    let r = this.sessions.get(id);
    if (!r) {
      r = { id, createdAt: Date.now(), npc: emptyTotals(), byNpc: new Map(), models: new Set(), budgetNoticed: false };
      this.sessions.set(id, r);
    }
    return r;
  }

  /** one NPC turn (sessionId may be undefined for calls outside a session) */
  recordNpc(sessionId: string | undefined, npcKey: string, name: string, u: LlmCallUsage) {
    const t = callTotals(u);
    addTotals(this.proc.npc, t);
    this.models.add(u.model);
    if (sessionId) {
      const r = this.rec(sessionId);
      addTotals(r.npc, t);
      r.models.add(u.model);
      let n = r.byNpc.get(npcKey);
      if (!n) r.byNpc.set(npcKey, (n = { name, totals: emptyTotals() }));
      n.name = name;
      addTotals(n.totals, t);
    }
    this.addPending('npc', t);
  }

  /**
   * The AI doctor's cumulative usage for a session. Only growth since the previous report
   * is added to process/day/all-time totals, so repeated reports never double count.
   */
  recordAgent(sessionId: string, report: AgentReport): AgentUsageView {
    const r = this.rec(sessionId);
    const prev = r.agent;
    const delta = emptyTotals();
    for (const k of FIELDS) delta[k] = Math.max(0, report[k] - (prev?.[k] ?? 0));
    for (const k of ESTIMATE_FIELDS) if (report[k] !== undefined) delta[k] = Math.max(0, report[k]! - (prev?.[k] ?? 0));
    addTotals(this.proc.agent, delta);
    this.addPending('agent', delta);
    r.agent = { ...report, plan: report.plan ?? prev?.plan, at: Date.now() };
    return r.agent;
  }

  setPlan(p: PlanUsage | undefined) {
    if (p) this.plan = p;
  }

  // ───────── budget guard ─────────

  overBudget(): boolean {
    const { maxTokens, maxUsd } = this.opts;
    return (!!maxTokens && totalTokens(this.proc.npc) >= maxTokens) || (!!maxUsd && this.proc.npc.costUSD >= maxUsd);
  }

  /** true exactly once per session — for the one-time "budget reached" toast */
  claimBudgetNotice(sessionId: string | undefined): boolean {
    if (!sessionId) return false;
    const r = this.rec(sessionId);
    if (r.budgetNoticed) return false;
    r.budgetNoticed = true;
    return true;
  }

  budgetNotice(): string {
    const { maxTokens, maxUsd } = this.opts;
    const used = this.proc.npc;
    const what =
      maxTokens && totalTokens(used) >= maxTokens
        ? `${fmtTokens(totalTokens(used))} of the ${fmtTokens(maxTokens)}-token budget`
        : `${fmtUSD(used.costUSD)} of the ${fmtUSD(maxUsd ?? 0)} budget${this.opts.apiEquivalent ? ' (API-equivalent)' : ''}`;
    return `⚠ LLM budget reached — NPCs used ${what} for this server run, so they now answer with scripted offline replies. Restart the server (or raise --max-tokens / --max-usd) for open conversations.`;
  }

  private budgetView(): UsageView['budget'] {
    const { maxTokens, maxUsd } = this.opts;
    if (!maxTokens && !maxUsd) return undefined;
    return { maxTokens, maxUsd, exceeded: this.overBudget() };
  }

  // ───────── views ─────────

  today(): Bucket {
    const day = dayKey();
    const b = reviveBucket(this.disk.days[day]);
    const p = this.pending.get(day);
    if (p) {
      addTotals(b.npc, p.npc);
      addTotals(b.agent, p.agent);
    }
    return b;
  }

  allTime(): Bucket & { since?: string } {
    const b = reviveBucket(this.disk.allTime);
    let since = this.disk.since;
    for (const [day, p] of this.pending) {
      addTotals(b.npc, p.npc);
      addTotals(b.agent, p.agent);
      if (!since || day < since) since = day;
    }
    return { ...b, since };
  }

  private byNpc(r: SessionRec | undefined): UsageView['byNpc'] {
    if (!r) return [];
    return [...r.byNpc.entries()]
      .map(([key, v]) => ({ key, name: v.name, totals: { ...v.totals } }))
      .sort((a, b) => b.totals.costUSD - a.totals.costUSD || totalTokens(b.totals) - totalTokens(a.totals));
  }

  sessionView(sessionId: string, provider: LlmStatus['provider']): UsageView {
    const r = this.sessions.get(sessionId);
    return {
      provider,
      models: r ? [...r.models] : [],
      apiEquivalent: provider === 'codex' || (provider === 'claude-code' && (r?.apiEquivalent ?? !!this.opts.apiEquivalent)),
      ...(provider === 'vllm' || (provider === 'openai-api' && (!r?.npc.openaiPricedCalls || r.npc.openaiPricedCalls < r.npc.calls)) || (provider === 'codex' && (!r?.npc.codexPricedCalls || r.npc.codexPricedCalls < r.npc.calls)) ? { costAvailable: false } : {}),
      session: r ? { ...r.npc } : emptyTotals(),
      byNpc: this.byNpc(r),
      agent: r?.agent,
      today: this.today().npc,
      process: { ...this.proc.npc },
      plan: provider === 'claude-code' ? this.plan : undefined,
      budget: provider === 'offline' ? undefined : this.budgetView(),
    };
  }

  /** what goes into data/runs/<session>.json (cost per episode) */
  sessionSnapshot(sessionId: string, provider: LlmStatus['provider']): UsageSnapshot {
    const { today: _t, process: _p, ...rest } = this.sessionView(sessionId, provider);
    return { ...rest, recordedAt: new Date().toISOString() };
  }

  summary(): UsageSummary {
    const today = this.today();
    const all = this.allTime();
    const budget = this.budgetView();
    return {
      provider: this.opts.provider ?? 'offline',
      models: [...this.models],
      apiEquivalent: this.opts.provider === 'codex' || (this.opts.provider === 'claude-code' && !!this.opts.apiEquivalent),
      process: { since: new Date(this.startedAt).toISOString(), npc: { ...this.proc.npc }, agent: { ...this.proc.agent } },
      today: { date: dayKey(), npc: today.npc, agent: today.agent },
      allTime: { since: all.since, npc: all.npc, agent: all.agent },
      plan: this.plan,
      budget: budget ? { ...budget, usedTokens: totalTokens(this.proc.npc), usedUSD: this.proc.npc.costUSD } : undefined,
      sessions: [...this.sessions.values()].map((r) => ({
        id: r.id,
        map: r.map,
        player: r.player,
        createdAt: new Date(r.createdAt).toISOString(),
        npc: { ...r.npc },
        byNpc: this.byNpc(r),
        agent: r.agent,
      })),
    };
  }

  // ───────── persistence ─────────

  private addPending(kind: keyof Bucket, t: UsageTotals) {
    if (FIELDS.every((k) => !t[k])) return; // nothing changed (e.g. a repeated cumulative report)
    const day = dayKey();
    let b = this.pending.get(day);
    if (!b) this.pending.set(day, (b = emptyBucket()));
    addTotals(b[kind], t);
    if (this.opts.file && !this.timer) {
      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.flush();
      }, this.opts.flushMs ?? 3000);
      this.timer.unref?.();
    }
  }

  /** merge unflushed deltas into the file on disk; returns false if the write failed */
  flush(): boolean {
    const file = this.opts.file;
    if (!file || !this.pending.size) return true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    // re-read so totals written meanwhile by another process are kept; never mutate this.disk
    // before the write succeeded (views add `pending` on top of it)
    const disk = readPersisted(file) ?? structuredClone(this.disk);
    for (const [day, p] of this.pending) {
      const d = (disk.days[day] ??= emptyBucket());
      addTotals(d.npc, p.npc);
      addTotals(d.agent, p.agent);
      addTotals(disk.allTime.npc, p.npc);
      addTotals(disk.allTime.agent, p.agent);
      if (!disk.since || day < disk.since) disk.since = day;
    }
    const days = Object.keys(disk.days).sort();
    for (const d of days.slice(0, Math.max(0, days.length - MAX_DAYS))) delete disk.days[d];
    disk.updatedAt = new Date().toISOString();
    try {
      mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(disk, null, 1));
      renameSync(tmp, file);
      this.disk = disk;
      this.pending.clear();
      return true;
    } catch (e) {
      if (!this.writeWarned) console.warn(`[usage] could not write ${file}: ${(e as Error).message}`);
      this.writeWarned = true;
      return false;
    }
  }
}

/** process-wide ledger used by the NPC brains, views and HTTP API */
export const usage = new UsageLedger();
