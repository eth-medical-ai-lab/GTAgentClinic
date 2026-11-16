/**
 * Think-aloud narration for AI doctors (observe mode).
 *
 *  - Narrator: a tiny client for POST /api/sessions/:id/narration. Lines are sent in order,
 *    buffered until the session id is known, retried briefly on 429, and never throw — a
 *    watcher missing a line must not break the agent's shift.
 *  - describeToolCall / summarizeToolResult: how claude-doctor.ts turns its MCP tool calls and
 *    results into short feed lines ("→ order lactic acid (STAT)", "↳ Lactate 4.1 → 2.3").
 */
import { EXAM_BY_ID, ORDERS } from '../shared/catalog';
import { LAYOUTS, roomById } from '../shared/layout';
import { DISPO_LABELS, type Dispo, type NarrationKind } from '../shared/types';

export type AgentNarrationKind = Extract<NarrationKind, 'thought' | 'action' | 'result' | 'reflection'>;
export interface FeedLine {
  text: string;
  patientId?: string;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class Narrator {
  private sid: string | null = null;
  private base: string;
  private pending: { kind: AgentNarrationKind; text: string; patientId?: string }[] = [];
  private chain: Promise<void> = Promise.resolve();
  private warned = false;

  constructor(baseUrl = process.env.AGENTCLINIC_URL ?? 'http://127.0.0.1:5317', private warn: (msg: string) => void = (m) => console.log(m)) {
    this.base = baseUrl.replace(/\/$/, '');
  }

  get sessionId(): string | null {
    return this.sid;
  }

  /** start sending (lines said before this are flushed now) */
  setSession(id: string, baseUrl?: string) {
    this.sid = id;
    if (baseUrl) this.base = baseUrl.replace(/\/$/, '');
    for (const p of this.pending.splice(0)) this.say(p.kind, p.text, p.patientId);
  }

  say(kind: AgentNarrationKind, text: string, patientId?: string) {
    const t = text.trim();
    if (!t) return;
    if (!this.sid) {
      if (this.pending.length < 40) this.pending.push({ kind, text: t, patientId });
      return;
    }
    const url = `${this.base}/api/sessions/${this.sid}/narration`;
    const body = JSON.stringify({ kind, text: t, patientId });
    this.chain = this.chain.then(() => this.post(url, body));
  }

  /** resolves when every line said so far has been sent (or given up on) */
  flush(): Promise<void> {
    return this.chain;
  }

  private async post(url: string, body: string) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(4000) });
        if (r.status === 429) {
          const j = (await r.json().catch(() => ({}))) as { retryAfterMs?: number };
          await sleep(Math.min(2000, Math.max(100, j.retryAfterMs ?? 500)));
          continue;
        }
        if (!r.ok && !this.warned) {
          this.warned = true;
          this.warn(`   (narration not accepted: HTTP ${r.status})`);
        }
        return;
      } catch (e) {
        if (!this.warned) {
          this.warned = true;
          this.warn(`   (could not send narration: ${(e as Error).message})`);
        }
        return;
      }
    }
  }
}

// ───────────────────────────── formatting (claude-doctor) ─────────────────────────────

const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t;
};
const str = (v: unknown) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v));

/** "- cards: Dr. Sara Lindqvist — Cardiology fellow on call (x4410)" lines of the start_shift phone directory */
export function parseDirectory(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of text.matchAll(/^- ([\w-]+): (.+?) — (.+?) \([^)]*\)(?: \[re: [\w]+\])?$/gm)) out.set(m[1], `${m[2]} (${m[3].split(' (')[0]})`);
  return out;
}

const NPC_PREFIX: [RegExp, (n: string) => string][] = [
  [/^pt_p_/, (n) => n],
  [/^rn_/, (n) => `${n} (RN)`],
  [/^att_/, (n) => `Dr. ${n}`],
  [/^tech_/, (n) => `${n} (tech)`],
  [/^fam_/, (n) => n],
  [/^clerk_/, (n) => `${n} (clerk)`],
  [/^sec_/, (n) => `${n} (security)`],
  [/^hk_/, (n) => `${n} (housekeeping)`],
];

/** pt_p_brunner → "Brunner", rn_tom → "Tom (RN)", att_shaw → "Dr. Shaw" */
export function npcLabel(id: string): string {
  for (const [re, f] of NPC_PREFIX) {
    if (re.test(id)) {
      const n = id.replace(re, '').replace(/_/g, ' ');
      return f(n.charAt(0).toUpperCase() + n.slice(1));
    }
  }
  return id;
}

const roomLabel = (id: string) => roomById(LAYOUTS.ed, id)?.label ?? id;

/** a compact line for one tool call, e.g. "→ order lactic acid, venous (STAT)"; null = not worth showing */
export function describeToolCall(name: string, input: Record<string, unknown>, contacts: Map<string, string> = new Map()): FeedLine | null {
  const tool = name.replace(/^mcp__agentclinic__/, '');
  const pid = str(input.patient_id) || undefined;
  switch (tool) {
    case 'start_shift':
      return { text: '→ start the shift' };
    case 'observe':
      return { text: '→ look around: board, people here, pages' };
    case 'catalog':
      return { text: '→ open the order catalog' };
    case 'move':
      return { text: `→ walk to ${roomLabel(str(input.to))}` };
    case 'talk':
      return { text: `→ to ${npcLabel(str(input.npc_id))}: “${clip(str(input.text), 260)}”`, patientId: /^pt_(p_\w+)$/.exec(str(input.npc_id))?.[1] };
    case 'examine': {
      const m = EXAM_BY_ID[str(input.maneuver)];
      return { text: `→ examine: ${m ? `${m.system.toLowerCase()} · ${m.label}` : str(input.maneuver)}`, patientId: pid };
    }
    case 'inspect':
      return { text: `→ pick up and look at: ${str(input.item_id).replace(/_/g, ' ')}` };
    case 'give_item':
      return { text: `→ hand back to the patient: ${str(input.item_id).replace(/_/g, ' ')}` };
    case 'order': {
      const def = ORDERS[str(input.code)];
      const dose = [input.dose, input.route, input.frequency].map(str).filter(Boolean).join(' ');
      return { text: `→ order ${def ? def.name : str(input.code)}${dose ? ` ${dose}` : ''}${input.priority === 'STAT' ? ' (STAT)' : ''}`, patientId: pid };
    }
    case 'cancel_order':
      return { text: `→ cancel order ${str(input.order_id)}` };
    case 'read_chart':
      return { text: `→ read the chart: ${str(input.section)}${input.query ? ` “${str(input.query)}”` : ''}`, patientId: pid };
    case 'sign_ecg':
      return { text: `→ sign ECG ${str(input.ecg_id)}: “${clip(str(input.interpretation), 200)}”` };
    case 'call':
      return { text: `→ call ${contacts.get(str(input.contact_id)) ?? str(input.contact_id)}: “${clip(str(input.text), 260)}”`, patientId: pid };
    case 'set_diagnoses':
      return { text: `→ working diagnoses: ${(Array.isArray(input.diagnoses) ? input.diagnoses.map(str) : []).join('; ') || '—'}`, patientId: pid };
    case 'disposition': {
      const d = DISPO_LABELS[str(input.decision) as Dispo] ?? str(input.decision);
      return { text: `→ disposition: ${d}${input.service ? ` (${str(input.service)})` : ''}`, patientId: pid };
    }
    case 'wait':
      return { text: `→ wait ${str(input.minutes)} min` };
    case 'end_shift':
      return { text: '→ end the shift' };
    default:
      return { text: `→ ${tool}(${clip(JSON.stringify(input), 120)})`, patientId: pid };
  }
}

/** labs text "Chemistry | Lactate (lactate) [mmol/L; ref 0.5–2.2]: 4.1 H @22:31 → 2.3 H @23:40" → "Lactate 4.1 H → 2.3 H" */
function labSummary(text: string): string | null {
  const vals: string[] = [];
  for (const m of text.matchAll(/^[^|\n]*\| (.+?) \([\w]+\) \[[^\]]*\]: (.+)$/gm)) {
    const series = m[2].split(' → ').map((v) => v.replace(/\s*@.*$/, '').replace(/\s*\(historical\)/, '').trim());
    vals.push(`${m[1]} ${series.slice(-2).join(' → ')}`);
  }
  if (!vals.length) return null;
  return vals.slice(0, 6).join(' · ') + (vals.length > 6 ? ` · +${vals.length - 6} more` : '');
}

function chartSummary(section: string, text: string): string | null {
  const lines = text.split('\n');
  const find = (re: RegExp) => lines.find((l) => re.test(l))?.trim();
  switch (section) {
    case 'labs':
      return labSummary(text) ?? find(/^No (lab )?results/) ?? null;
    case 'ecg': {
      const reads = lines.filter((l) => /Machine read:/.test(l)).map((l) => l.replace(/^\s*Machine read:\s*/, ''));
      return reads.length ? `machine read: ${reads[reads.length - 1]}` : find(/^none/) ?? null;
    }
    case 'imaging': {
      const imp = lines.filter((l) => /IMPRESSION:/.test(l)).map((l) => l.replace(/^\s*IMPRESSION:\s*/, ''));
      return imp.length ? `impression: ${imp.join(' | ')}` : find(/: (Ordered|Scheduled|In progress|Completed|Preliminary)/) ?? null;
    }
    case 'vitals': {
      const v = lines.filter((l) => /^- /.test(l));
      return v.length ? `latest vitals: ${v[v.length - 1].replace(/^- /, '')}` : null;
    }
    case 'summary':
      return find(/^Latest vitals/) ?? null;
    case 'history':
      return find(/^Home medications/) ?? find(/^Problem list/) ?? null;
    case 'notes': {
      const n = lines.filter((l) => l.startsWith('--- '));
      return n.length ? `${n.length} note(s): ${n.slice(-3).map((l) => l.replace(/^--- \[[^\]]*\] /, '')).join(' | ')}` : null;
    }
    case 'board':
      return find(/^Tracking board/) ?? null;
    default:
      return lines.find((l, i) => i > 1 && l.trim())?.trim() ?? null;
  }
}

/** the key part of a tool result for watchers, or null when the action line says it all */
export function summarizeToolResult(name: string, input: Record<string, unknown>, text: string): (FeedLine & { tone?: 'warn' }) | null {
  const tool = name.replace(/^mcp__agentclinic__/, '');
  const pid = str(input.patient_id) || undefined;
  const head = text.split('\n\n')[0].trim();
  if (/^FAILED:/.test(head)) return { text: `✗ ${clip(head.replace(/^FAILED:\s*/, ''), 240)}`, patientId: pid, tone: 'warn' };
  const ok = head.replace(/^OK:\s*/, '');
  switch (tool) {
    case 'start_shift': {
      const n = /Tracking board \((\d+) patients?\)/.exec(text)?.[1];
      return { text: `↳ shift started${n ? ` — ${n} patient${n === '1' ? '' : 's'} on the board` : ''}` };
    }
    case 'end_shift':
      return { text: `↳ ${clip(text.split('\n')[0], 200)}` };
    case 'read_chart': {
      const s = chartSummary(str(input.section), text);
      return s ? { text: `↳ ${clip(s, 300)}`, patientId: pid } : null;
    }
    case 'talk':
    case 'call':
      return ok ? { text: `↳ “${clip(ok, 300)}”`, patientId: pid ?? /^pt_(p_\w+)$/.exec(str(input.npc_id))?.[1] } : null;
    case 'examine':
    case 'inspect':
    case 'disposition':
      return ok ? { text: `↳ ${clip(ok, 300)}`, patientId: pid } : null;
    default:
      return null; // orders, moves, waits, signing: the action line already says it
  }
}
