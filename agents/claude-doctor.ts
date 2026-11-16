/**
 * Let Claude play the resident: runs your local Claude Code headless with the
 * AgentClinic MCP server attached. Start the game server first (npm start) to watch
 * the AI doctor in 3D via the printed spectate link.
 *
 *   npm run agent:claude -- [--model sonnet] [--map night_shift] [--seed 7] [--max-turns 150] [--pace 1.5]
 *
 *   --pace S       seconds between actions so humans can follow in 3D (observe mode); default 0
 *   --session ID   play a shift the game server already created (the menu's "Watch an AI doctor"
 *                  launches this script that way via POST /api/observe)
 *
 * Think-aloud: every assistant text block (its reasoning), a compact line per tool call
 * ("→ order Lactic acid, venous") and the key part of each tool result go to the game server
 * (POST /api/sessions/:id/narration), which shows them in the spectators' feed and as the
 * ai_doctor's speech bubble. It also prints a running token/cost total after every assistant
 * message and reports the doctor's cumulative usage (POST /api/sessions/:id/usage), so the
 * HUD, spectators and the saved run log show it next to the NPCs' spend.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { UsageTotals } from '../shared/types';
import { childEnv, claudeCommand } from '../server/llm/provider';
import { emptyTotals, fmtTokens, fmtUSD } from '../server/usage';
import { describeToolCall, Narrator, parseDirectory, summarizeToolResult } from './narration';
import { StreamUsageMeter } from './usageMeter';

const argv = process.argv.slice(2);
const opt = (k: string, d: string) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d;
};
const model = opt('model', 'sonnet');
const map = opt('map', 'night_shift');
const seed = opt('seed', String(Math.floor(Math.random() * 1e6)));
const maxTurns = opt('max-turns', '150');
const pace = Number(opt('pace', '0')) || 0;
const attachTo = opt('session', '') || undefined;
const serverUrl = (process.env.AGENTCLINIC_URL ?? 'http://127.0.0.1:5317').replace(/\/$/, '');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// MCP server: node + the tsx loader directly (no npx in between, so a stop signal reaches it), own temp dir per run
const tmp = mkdtempSync(path.join(tmpdir(), 'agentclinic-mcp-'));
const mcpConfig = path.join(tmp, 'mcp.json');
const mcpEnv: Record<string, string> = { AGENTCLINIC_URL: serverUrl, AGENTCLINIC_MODEL: model };
if (attachTo) mcpEnv.AGENTCLINIC_SESSION = attachTo;
if (pace > 0) mcpEnv.AGENTCLINIC_PACE = String(pace);
if (process.env.NPC_LLM) mcpEnv.NPC_LLM = process.env.NPC_LLM;
const tsxLoader = pathToFileURL(path.join(root, 'node_modules', 'tsx', 'dist', 'loader.mjs')).href;
writeFileSync(mcpConfig, JSON.stringify({ mcpServers: { agentclinic: { command: process.execPath, args: ['--import', tsxLoader, path.join(root, 'agents', 'mcp-server.ts')], cwd: root, env: mcpEnv } } }));

const system = `You are an emergency-medicine resident playing a realistic ED simulation through the "agentclinic" tools. Think like a careful clinician: sickest first; focused history (patients know only their symptoms — family, GP offices and nurses know other things); targeted exam; evidence-based, cost-conscious orders; read results and sign ECGs promptly; call consultants/admitting teams with a crisp one-liner; set working diagnoses and a disposition for every patient; watch for staff errors (incomplete vitals, cultures vs antibiotics, look-alike patient names); escalate to your attending (escalate: bedside or call) when a patient is unstable or beyond you, as a good resident would. Use "wait" while results are pending.

Medical learners watch you work in 3D and read your words live as a teaching transcript. So think aloud: before each action (or batch of actions) write one or two short sentences of explicit clinical reasoning — finding → interpretation → action, with the bed or patient named — e.g. "Bed 4: lactate 4.1 + SBP 84 → septic shock; 30 mL/kg crystalloid now, then norepinephrine if MAP stays < 65." Use real numbers and named criteria/scores when they drive the decision. No headings, no bullet lists, no long plans, never more than two sentences before an action.

Finish with end_shift, then a 5-line reflection on the debrief: what went well, what you missed and why, and one lesson for next time.`;

const prompt = attachTo
  ? `Your shift is ready: call start_shift() to join it (map and seed are already set), then play it to the end.`
  : `Start a shift with start_shift(map="${map}", seed=${seed}, player_name="Claude ${model}") and play it to the end.`;

// --include-partial-messages: message_delta events carry each message's exact final usage
const args = ['-p', prompt, '--model', model, '--mcp-config', mcpConfig, '--strict-mcp-config', '--allowedTools', 'mcp__agentclinic__*', '--tools', '', '--append-system-prompt', system, '--max-turns', maxTurns, '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--no-session-persistence'];
console.log(`▶ Claude (${model}) is taking the ${attachTo ? `prepared shift ${attachTo}` : `${map} shift (seed ${seed})`}. If the game server is running, look for the spectate link below.\n`);
// launched by hand (not by the server's opt-in-gated observe mode): say whose account this uses
if (process.env.AGENTCLINIC_OBSERVE !== '1') console.log(`  This runs your own Claude Code CLI: ${process.env.ANTHROPIC_API_KEY ? 'with ANTHROPIC_API_KEY set, `claude -p` bills that key' : 'on your Claude login'}. Personal use only: docs/SETUP.md#claude-code\n`);
const claude = claudeCommand();
// run from the run's own temp dir, not the repo: no contributor CLAUDE.md, project settings or project
// memory may slip into the AI doctor's context (it has no file tools anyway; the MCP server keeps cwd: root)
const child = spawn(claude.cmd, [...claude.pre, ...args], { cwd: tmp, env: childEnv(), stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true });

// ───────────── shutdown: stop claude (and with it the MCP server) on any exit path ─────────────

let stopping = false;
function stop(why: string) {
  if (stopping) return;
  stopping = true;
  console.log(`\n■ stopping (${why})`);
  try {
    child.kill('SIGTERM');
  } catch {
    /* already gone */
  }
  setTimeout(() => child.kill('SIGKILL'), 2500).unref();
  setTimeout(() => process.exit(143), 7000).unref(); // the child's exit handler normally gets there first
}
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGINT'));
// launched by the game server (observe mode): if it dies, so do we
if (process.send) {
  process.channel?.unref();
  process.on('disconnect', () => stop('game server went away'));
}

// ───────────── think-aloud narration for spectators ─────────────

const narrator = new Narrator(serverUrl, (m) => console.log(dim(m)));
let contacts = new Map<string, string>();
const toolCalls = new Map<string, { name: string; input: Record<string, unknown> }>();
let shiftOver = false;
let turnLimit = false;

// ───────────── usage: running total + reports to the game server ─────────────

const meter = new StreamUsageMeter();
function dim(s: string) {
  return process.stdout.isTTY ? `\x1b[2m${s}\x1b[0m` : s;
}
const costLabel = () => (meter.billing === 'api' ? 'billed (API key)' : 'API-equivalent');
const pct = (x: number) => `${Math.round(100 * x)}%`;

function describe(t: UsageTotals) {
  const prompt = t.inputTokens + t.cacheReadTokens + t.cacheWriteTokens;
  return `in ${fmtTokens(prompt)} (${prompt ? pct(t.cacheReadTokens / prompt) : '0%'} cached) · out ${fmtTokens(t.outputTokens)} · ${fmtUSD(t.costUSD)} ${costLabel()}`;
}

/** the shift this run is playing, learned from the start_shift tool result (or given by --session) */
let shift: { id: string; base: string; offset: UsageTotals } | null = attachTo ? { id: attachTo, base: serverUrl, offset: emptyTotals() } : null;
if (attachTo) narrator.setSession(attachTo, serverUrl);
let lastPost = 0;
let postTimer: ReturnType<typeof setTimeout> | null = null;
let inflight: Promise<void> = Promise.resolve();
let postWarned = false;

function sinceShiftStart(): UsageTotals & { model?: string; final: boolean } {
  const t = meter.totals();
  if (!shift) return t;
  const out = { ...t };
  for (const k of Object.keys(emptyTotals()) as (keyof UsageTotals)[]) out[k] = Math.max(0, t[k] - shift.offset[k]);
  return out;
}

function report(final = false): Promise<void> {
  if (!shift) return inflight;
  const now = Date.now();
  if (!final && now - lastPost < 2000) {
    postTimer ??= setTimeout(() => {
      postTimer = null;
      void report();
    }, 2000 - (now - lastPost));
    return inflight;
  }
  if (postTimer) clearTimeout(postTimer);
  postTimer = null;
  lastPost = now;
  const { id, base } = shift;
  const t = sinceShiftStart();
  const body = JSON.stringify({ ...t, label: `Claude ${model}`, model: t.model, billing: meter.billing, final: final || t.final, plan: meter.plan });
  inflight = inflight
    .then(() => fetch(`${base}/api/sessions/${id}/usage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(4000) }))
    .then((r) => {
      if (!r.ok && !postWarned) throw new Error(`HTTP ${r.status}`);
    })
    .catch((e) => {
      if (!postWarned) console.log(dim(`   (could not report usage to the game server: ${(e as Error).message})`));
      postWarned = true;
    });
  return inflight;
}

function noteToolResult(text: string) {
  const sid = /Shift started \(session (s_[\w]+), backend (\w+)\)/.exec(text);
  const spect = /[?&]spectate=(s_[\w]+)/.exec(text);
  const id = spect?.[1] ?? (sid && sid[2] === 'http' ? sid[1] : undefined);
  const dir = /PHONE DIRECTORY:\n([\s\S]*?)\n\n/.exec(text)?.[1];
  if (dir) contacts = parseDirectory(dir);
  if (!id || id === shift?.id) return;
  let base = serverUrl;
  const url = /Humans can watch you in 3D: (\S+)/.exec(text)?.[1];
  try {
    if (url) base = new URL(url).origin;
  } catch {
    /* keep default */
  }
  // a second shift in the same run only gets the usage from here on
  shift = { id, base: base.replace(/\/$/, ''), offset: shift ? meter.totals() : emptyTotals() };
  narrator.setSession(id, shift.base);
  void report();
}

// ───────────── stream ─────────────

let buf = '';
child.stdout.on('data', (d: Buffer) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    let ev: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
      ev = JSON.parse(line);
    } catch {
      continue; // partial / non-JSON line
    }
    const done = meter.onEvent(ev);
    if (done) {
      console.log(dim(`   ◆ ${meter.totals().calls} msgs · ${describe(meter.totals())}`));
      void report();
    }
    if (ev.type === 'assistant') {
      for (const b of ev.message?.content ?? []) {
        if (b.type === 'text' && b.text.trim()) {
          console.log(`🩺 ${b.text.trim()}`);
          // its reasoning → the feed and the speech bubble; after end_shift it is the reflection
          narrator.say(shiftOver ? 'reflection' : 'thought', b.text);
        }
        if (b.type === 'tool_use') {
          const input = (b.input ?? {}) as Record<string, unknown>;
          console.log(`   → ${String(b.name).replace('mcp__agentclinic__', '')}(${JSON.stringify(input).slice(0, 140)})`);
          toolCalls.set(String(b.id), { name: String(b.name), input });
          const lineOut = describeToolCall(String(b.name), input, contacts);
          if (lineOut) narrator.say('action', lineOut.text, lineOut.patientId);
          if (String(b.name).endsWith('end_shift')) shiftOver = true;
        }
      }
    } else if (ev.type === 'user') {
      for (const b of ev.message?.content ?? []) {
        if (b.type === 'tool_result') {
          const t = Array.isArray(b.content) ? b.content.map((c: { text?: string }) => c.text ?? '').join('') : String(b.content ?? '');
          const spect = /Humans can watch you in 3D: (\S+)/.exec(t);
          if (spect) console.log(`\n👀 Watch live: ${spect[1]}\n`);
          noteToolResult(t);
          console.log(`     ${t.split('\n')[0].slice(0, 160)}`);
          const call = toolCalls.get(String(b.tool_use_id));
          toolCalls.delete(String(b.tool_use_id));
          if (call) {
            const res = b.is_error ? { text: `✗ ${t.slice(0, 200)}`, patientId: undefined } : summarizeToolResult(call.name, call.input, t);
            if (res) narrator.say('result', res.text, res.patientId);
          }
        }
      }
    } else if (ev.type === 'result') {
      if (ev.subtype === 'error_max_turns') {
        turnLimit = true;
        console.log(`\n■ reached --max-turns ${maxTurns}`);
        narrator.say('result', `✗ The AI doctor reached its turn limit (${maxTurns} turns) and stops here.`);
      }
      const t = meter.totals();
      console.log(`\n■ done — ${ev.num_turns} turns, ${(ev.duration_ms / 60000).toFixed(1)} min`);
      console.log(`  usage: ${t.calls} API messages · ${fmtTokens(t.inputTokens + t.cacheReadTokens + t.cacheWriteTokens)} input tokens (${fmtTokens(t.cacheReadTokens)} cache read, ${fmtTokens(t.cacheWriteTokens)} cache write, ${fmtTokens(t.inputTokens)} uncached) · ${fmtTokens(t.outputTokens)} output · ${fmtUSD(t.costUSD)} ${costLabel()}${t.model ? ` · ${t.model}` : ''}`);
      for (const w of meter.plan?.windows ?? []) console.log(`  plan: ${w.label} ${pct(w.utilization)} used${w.resetsAt ? ` (resets ${new Date(w.resetsAt * 1000).toLocaleString()})` : ''}`);
      void report(true);
    }
  }
});
child.on('exit', async (code) => {
  // let the final usage report and the last narration lines reach the server before exiting
  await Promise.race([Promise.all([report(true), narrator.flush()]), new Promise((r) => setTimeout(r, 4000))]);
  rmSync(tmp, { recursive: true, force: true });
  process.exit(stopping || turnLimit ? 0 : (code ?? 0));
});
