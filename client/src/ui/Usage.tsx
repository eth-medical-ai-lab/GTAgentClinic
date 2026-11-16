/**
 * LLM usage UI: the HUD chip + popover, the main-menu totals line and the debrief section.
 * Numbers come from PlayerView.usage (live, per shift) and GET /api/usage (menu).
 */
import { useEffect, useRef, useState } from 'react';
import type { AgentUsageView, LlmStatus, PlanUsage, UsageSummary, PricedUsageTotals as UsageTotals, UsageView } from '../../../shared/types';
import { cacheHitRate, fmtTokens, fmtUSD, fmtCodexCost, fmtEstimatedCost, hasCodexCost, hasEstimatedCost, modelFamily, prettyModel, promptTokens, totalTokens } from '../../../shared/usage';
import { useStore } from '../store';

const CODEX_COST_HELP = 'Estimated at OpenAI Standard API prices, not actual charges or remaining subscription allowance. Assumes 30-minute cache writes; context tiers use turn totals, so multi-request turns are approximate.';
const OPENAI_COST_HELP = 'Estimated API cost from reported tokens at OpenAI Standard prices, including cache reads, 30-minute cache writes and context tiers. Your OpenAI billing account shows actual charges. Earlier unpriced usage is not recalculated.';
const estimatedCostLabel = (t: UsageTotals, estimated = false) => estimated || hasEstimatedCost(t) ? fmtEstimatedCost(t) : fmtUSD(t.costUSD);

const pct = (x: number) => `${Math.round(x * 100)}%`;
const avgLatency = (t: UsageTotals) => (t.calls ? `${(t.latencyMs / t.calls / 1000).toFixed(1)} s` : '—');
const API_EQ_HELP = 'Subscription login: you are not billed per token. Shown at Anthropic API list prices as a proxy for load.';

function resets(at?: number) {
  if (!at) return '';
  return `resets ${new Date(at * 1000).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
}

function hasUsage(u: UsageView) {
  return u.provider !== 'offline' || !!u.agent || u.session.calls > 0;
}

// ───────────────────────────── HUD chip ─────────────────────────────

/**
 * With the Claude Code brain the chip shows from the first second of a shift (even at 0 tokens) and
 * names it: "◆ Claude Code · Haiku · 1.2k tok · $0.0011 API-eq." (then the HUD drops its separate
 * status chip; llm passes its state on). Other brains: "◆ 1.2k tok · $0.0011", as before.
 */
export function UsageChip({ usage, modelLabel, llm }: { usage?: UsageView; modelLabel?: string; llm?: LlmStatus }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', away);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', away);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);
  if (!usage || !hasUsage(usage)) return null; // offline NPCs and no AI doctor: nothing to show
  const estimated = usage.provider === 'codex' || usage.provider === 'openai-api';
  const npc = usage.session;
  const agent = usage.agent;
  const tok = totalTokens(npc) + (agent ? totalTokens(agent) : 0);
  const usd = npc.costUSD + (agent?.costUSD ?? 0);
  const cc = usage.provider === 'claude-code';
  const family = modelFamily([...usage.models, modelLabel], 'Claude');
  const title = [
    cc ? `NPC brain: your own Claude Code login, ${family}. Each character line is one small request on your plan.${llm?.ok === false && llm.detail ? `\n${llm.detail}` : ''}` : '',
    `NPCs: ${fmtTokens(totalTokens(npc))} tok · ${estimated ? fmtEstimatedCost(npc) : usage.costAvailable === false ? 'cost unavailable' : fmtUSD(npc.costUSD)}`,
    agent ? `AI doctor: ${fmtTokens(totalTokens(agent))} tok · ${hasCodexCost(agent) ? fmtCodexCost(agent) : agent.costAvailable === false ? 'cost unavailable' : fmtUSD(agent.costUSD)}` : '',
    usage.apiEquivalent || (agent?.billing === 'subscription' && agent.costAvailable !== false) ? `$ = API-equivalent. ${usage.provider === 'codex' || (agent && hasCodexCost(agent)) ? CODEX_COST_HELP : API_EQ_HELP}` : '',
    'Click for details',
  ]
    .filter(Boolean)
    .join('\n');
  return (
    <span className="usage-wrap" ref={ref}>
      <button className={`usage-chip ${cc ? 'cc' : ''} ${usage.budget?.exceeded || (cc && llm?.ok === false) ? 'bad' : ''}`} title={title} onClick={() => setOpen((o) => !o)}>
        ◆ {cc && <span className="usage-brain">Claude Code · {family} · </span>}
        <span className="mono">{fmtTokens(tok)}</span> tok · <span className="mono">{usage.costAvailable === false || agent?.costAvailable === false ? 'cost unavailable' : fmtUSD(usd)}{(estimated || (agent && hasCodexCost(agent))) && usage.costAvailable !== false && agent?.costAvailable !== false ? ' estimated' : ''}</span>
        {cc && usage.apiEquivalent && <span className="usage-eq"> API-eq.</span>}
      </button>
      {open && (
        <div className="usage-pop panel" role="dialog" aria-label="LLM usage">
          <button className="close-x" onClick={() => setOpen(false)} aria-label="Close">
            ×
          </button>
          <UsageDetails usage={usage} modelLabel={modelLabel} title="LLM usage — this shift" />
        </div>
      )}
    </span>
  );
}

// ───────────────────────────── details (popover + debrief) ─────────────────────────────

export function UsageDetails({ usage, modelLabel, title }: { usage: UsageView; modelLabel?: string; title: string }) {
  const estimated = usage.provider === 'codex' || usage.provider === 'openai-api';
  const s = usage.session;
  const models = usage.models.length ? usage.models.map(prettyModel).join(', ') : (modelLabel ?? '—');
  const via = usage.provider === 'claude-code' ? 'your Claude Code login' : usage.provider === 'anthropic-api' ? 'the Claude API' : usage.provider === 'codex' ? 'the Codex SDK and your login' : usage.provider === 'openai-api' ? 'the OpenAI API' : usage.provider === 'vllm' ? 'your custom API server' : 'offline';
  const plan = usage.plan ?? usage.agent?.plan;
  const b = usage.budget;
  return (
    <div className="usage-details">
      <div className="usage-head">
        <b>{title}</b>
        {usage.provider !== 'offline' && (estimated ? <span className="usage-tag" title={usage.provider === 'codex' ? CODEX_COST_HELP : OPENAI_COST_HELP}>{s.codexPricedCalls || s.openaiPricedCalls ? usage.provider === 'codex' ? 'Estimated API-equivalent cost' : 'Estimated API cost' : 'Tokens only'}</span> : usage.costAvailable === false ? <span className="usage-tag">Tokens only</span> : <CostTag apiEquivalent={usage.apiEquivalent} />)}
      </div>
      {usage.provider === 'offline' ? (
        <div className="dim">NPCs are scripted (offline) — 0 LLM tokens.</div>
      ) : (
        <>
          <div className="usage-sub dim">
            NPC brains: {models} via {via}
          </div>
          {usage.provider === 'claude-code' && (
            <div className="usage-sub dim">
              Each character line is one small request on your own Claude Code login{usage.apiEquivalent ? ", counted toward your plan's usage; $ is the API list-price equivalent, not a bill" : ''}.
            </div>
          )}
          <div className="usage-grid">
            <span>Calls</span>
            <b>
              {s.calls}
              {s.requests > s.calls ? ` (${s.requests} req)` : ''}
            </b>
            <span>Avg latency</span>
            <b>{avgLatency(s)}</b>
            <span title="input tokens not served from or written to the prompt cache">Uncached in</span>
            <b>{fmtTokens(s.inputTokens)}</b>
            <span title="includes adaptive-thinking tokens">Output</span>
            <b>{fmtTokens(s.outputTokens)}</b>
            <span>Cache read</span>
            <b>{fmtTokens(s.cacheReadTokens)}</b>
            <span>Cache write</span>
            <b>{fmtTokens(s.cacheWriteTokens)}</b>
            <span>Cache hit</span>
            <b>{pct(cacheHitRate(s))}</b>
            <span>Cost</span>
            <b>{estimated ? fmtEstimatedCost(s) : usage.costAvailable === false ? 'Unavailable' : fmtUSD(s.costUSD)}</b>
          </div>
        </>
      )}
      {usage.byNpc.length > 0 && (
        <table className="usage-npcs">
          <thead>
            <tr>
              <th>By NPC</th>
              <th>calls</th>
              <th>tokens</th>
              <th>cost</th>
            </tr>
          </thead>
          <tbody>
            {usage.byNpc.map((r) => (
              <tr key={r.key}>
                <td>{r.name}</td>
                <td>{r.totals.calls}</td>
                <td>{fmtTokens(totalTokens(r.totals))}</td>
                <td>{estimated ? fmtEstimatedCost(r.totals) : usage.costAvailable === false ? '—' : fmtUSD(r.totals.costUSD)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {usage.agent && <AgentBlock a={usage.agent} />}
      {usage.provider !== 'offline' && (
        <div className="usage-foot">
          <div>
            <span className="dim">NPCs today (all shifts)</span>
            <b className="mono">
              {fmtTokens(totalTokens(usage.today))} tok · {estimatedCostLabel(usage.today, estimated)}
            </b>
          </div>
          <div>
            <span className="dim">NPCs this server run</span>
            <b className="mono">
              {fmtTokens(totalTokens(usage.process))} tok · {estimatedCostLabel(usage.process, estimated)}
            </b>
          </div>
        </div>
      )}
      {usage.provider === 'openai-api' && <div className="dim">{OPENAI_COST_HELP}</div>}
      {usage.provider === 'codex' && <div className="dim">{CODEX_COST_HELP} Earlier unpriced usage is not recalculated; historical totals can be partial.</div>}
      {plan && <PlanBlock plan={plan} />}
      {b && (
        <div className={`usage-budget ${b.exceeded ? 'bad' : ''}`}>
          Budget (this server run): {b.maxTokens ? `${fmtTokens(totalTokens(usage.process))} / ${fmtTokens(b.maxTokens)} tok` : ''}
          {b.maxTokens && b.maxUsd ? ' · ' : ''}
          {b.maxUsd ? `${estimatedCostLabel(usage.process, estimated)} / ${fmtUSD(b.maxUsd)}` : ''}
          {b.exceeded ? ' — reached, NPCs are scripted now' : ''}
        </div>
      )}
      {(usage.costAvailable === false || usage.agent?.costAvailable === false) && <div className="dim">Dollar totals exclude sources without prices. Use a token budget to limit these sources.</div>}
    </div>
  );
}

function CostTag({ apiEquivalent }: { apiEquivalent: boolean }) {
  return apiEquivalent ? (
    <span className="usage-tag" title={API_EQ_HELP}>
      API-equivalent $
    </span>
  ) : (
    <span className="usage-tag billed" title="Billed per token to the API key">
      billed $
    </span>
  );
}

function AgentBlock({ a }: { a: AgentUsageView }) {
  return (
    <div className="usage-agent">
      <div className="usage-head">
        <b>🩺 AI doctor — {a.label}</b>
        {hasCodexCost(a) ? <span className="usage-tag" title={CODEX_COST_HELP}>{a.codexPricedCalls ? 'Estimated API-equivalent cost' : 'Tokens only'}</span> : a.costAvailable === false ? <span className="usage-tag">Tokens only</span> : <CostTag apiEquivalent={a.billing !== 'api'} />}
      </div>
      <div className="usage-sub dim">
        {a.model ? `${prettyModel(a.model)} · ` : ''}
        {a.final ? 'final reported usage' : 'live reported usage'}
      </div>
      <div className="usage-grid">
        <span>Messages</span>
        <b>{a.calls}</b>
        <span>Cache hit</span>
        <b>{pct(cacheHitRate(a))}</b>
        <span title="all prompt tokens: uncached + cache read + cache write">Prompt</span>
        <b>{fmtTokens(promptTokens(a))}</b>
        <span>Output</span>
        <b>{fmtTokens(a.outputTokens)}</b>
        <span>Cost</span>
        <b>{hasCodexCost(a) ? fmtCodexCost(a) : a.costAvailable === false ? 'Unavailable' : fmtUSD(a.costUSD)}</b>
      </div>
    </div>
  );
}

function PlanBlock({ plan }: { plan: PlanUsage }) {
  return (
    <div className="usage-plan">
      <div className="usage-sub dim">Your Claude plan (whole account, not just this game){plan.windows.length ? '' : `: ${plan.status ?? 'no window data'}`}</div>
      {plan.windows.map((w) => (
        <div key={w.id} className="usage-win" title={resets(w.resetsAt)}>
          <span>{w.label}</span>
          <span className="usage-bar">
            <span className={w.utilization >= 0.9 ? 'hot' : w.utilization >= 0.7 ? 'warm' : ''} style={{ width: `${Math.min(100, Math.max(2, w.utilization * 100))}%` }} />
          </span>
          <b className="mono">{pct(w.utilization)} used</b>
          {w.resetsAt ? <span className="usage-reset dim">{resets(w.resetsAt)}</span> : null}
        </div>
      ))}
    </div>
  );
}

// ───────────────────────────── main menu ─────────────────────────────

function useUsageSummary(enabled: boolean): UsageSummary | null {
  const [u, setU] = useState<UsageSummary | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = () =>
      fetch('/api/usage')
        .then((r) => (r.ok ? r.json() : null))
        .then((j: UsageSummary | null) => alive && j && setU(j))
        .catch(() => {});
    void load();
    const id = setInterval(load, 15000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [enabled]);
  return u;
}

export function MenuUsage() {
  const connected = useStore((s) => s.connected);
  const mock = useStore((s) => s.mock);
  const u = useUsageSummary(connected && !mock);
  if (!u) return null;
  const { today, allTime } = u;
  const any = totalTokens(allTime.npc) + totalTokens(allTime.agent) > 0;
  if (!any) return u.provider === 'offline' ? null : <span className="menu-usage">◆ No LLM usage recorded yet.</span>;
  const eq = u.provider === 'codex' ? ' (estimated API-equivalent)' : u.apiEquivalent ? ' (API-equivalent)' : '';
  const win = u.plan?.windows.find((w) => w.id === 'five_hour') ?? u.plan?.windows[0];
  return (
    <span className="menu-usage" title={u.provider === 'codex' ? CODEX_COST_HELP : u.provider === 'openai-api' ? OPENAI_COST_HELP : u.apiEquivalent ? API_EQ_HELP : undefined}>
      <span>
        ◆ NPCs today <b>{fmtTokens(totalTokens(today.npc))} tok · {estimatedCostLabel(today.npc, u.provider === 'codex' || u.provider === 'openai-api')}</b>
        {totalTokens(today.agent) > 0 && (
          <>
            {' '}· AI doctor <b>{estimatedCostLabel(today.agent)}</b>
          </>
        )}
        {eq}
      </span>
      <span>
        All time <b>{fmtTokens(totalTokens(allTime.npc))} tok · {estimatedCostLabel(allTime.npc, u.provider === 'codex' || u.provider === 'openai-api')}</b>
        {totalTokens(allTime.agent) > 0 ? ` + AI doctor ${estimatedCostLabel(allTime.agent)}` : ''}
        {allTime.since ? ` since ${allTime.since}` : ''}
        {win ? ` · ${win.label} ${pct(win.utilization)} used` : ''}
      </span>
      <span className="dim">Recorded dollar totals exclude sources without prices.</span>
    </span>
  );
}

// ───────────────────────────── debrief ─────────────────────────────

export function DebriefUsage({ usage, modelLabel }: { usage?: UsageView; modelLabel?: string }) {
  if (!usage) return null;
  return (
    <section className="db-usage">
      <h2>LLM usage this shift</h2>
      <div className="db-usage-body">
        {hasUsage(usage) ? <UsageDetails usage={usage} modelLabel={modelLabel} title="NPC dialogue" /> : <span className="dim">Offline NPCs — 0 tokens.</span>}
      </div>
    </section>
  );
}
