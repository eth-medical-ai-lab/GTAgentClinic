/**
 * GTAgentClinic server: serves the 3D client, runs authoritative simulations,
 * speaks WebSocket to human players and REST to AI agents.
 *
 *   tsx server/index.ts [--dev] [--port 5317] [--llm auto|claude-code|api|offline] [--tts kokoro|browser|off]
 *                       [--max-tokens 200k] [--max-usd 0.50]   (NPC budget per process, off by default)
 *                       [--exit-when-idle[=2m]]                (stop once no game tab is open; server/idleExit.ts)
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { findPracticeCases, mapIds, mapSummaries } from './sim/shiftRoster';
import type { ScenarioDef } from '../content/types';
import { ANALYTES, EXAM_MANEUVERS, ORDERS, ORDER_SETS } from '../shared/catalog';
import type { Action, ClientMsg, GameSettings, LlmStatus, ServerMsg } from '../shared/types';
import { fmtIdle, IdleExit, idleExitMs } from './idleExit';
import { checkClaudeCode, claudeCodeOptIn, codexOptIn, detectProvider, llmPreference } from './llm/provider';
import { checkAvailability, connectionModel, llmOptions, planOnline, planPick, planWithoutClaude, startOnline, vllmFacts, type CustomApiConfig, type Consent, type ConsentUse, type LlmFacts, type OnlinePlan, type OnlineUse } from './llm/mode';
import { readLocalConfig } from './localConfig';
import { modelName, parseNpcSelection, vllmUrl, type NpcSelection } from '../shared/llm';
import { isLocalAddress, requireLocalSelection, selectedProvider } from './llm/selection';
import type { LlmProvider } from './llm/provider';
import { NpcBrain } from './npc/brain';
import { watcherMessage } from './npc/watcher';
import { type EmbodiedRun, ObserveManager, readJsonCapped, readRunFile } from './observe';
import { createGuard, flagValues, splitList } from './security';
import { catalogText, contactsText, observationText } from './sim/agentText';
import { attachAiDoctor, feedFromEvent, isAgentSession, narrationEntries, narrationRequest, paced, recordAction, setPace, systemNote, takeFeedDirty, type AgentDriver } from './sim/aiDoctor';
import { debrief } from './sim/scoring';
import { SaveSlots, validOwner } from './saveSlots';
import { ShiftJournal } from './sim/shiftJournal';
import { GameSession } from './sim/session';
import { buildChart, buildView } from './sim/views';
import { createTts } from './tts';
import { fmtTokens, fmtUSD, parseAmount, sanitizeAgentReport, usage } from './usage';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist', 'client');
const DATA = path.join(ROOT, 'data', 'runs');
const VERSION = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version as string;

const argv = process.argv.slice(2);
const arg = (name: string) => {
  const i = argv.indexOf(name);
  if (i >= 0) return argv[i + 1];
  const eq = argv.find((a) => a.startsWith(name + '='));
  return eq?.split('=')[1];
};
const DEV = argv.includes('--dev');
const PORT = Number(arg('--port') ?? process.env.PORT ?? 5317);
const HOST = arg('--host') ?? process.env.HOST ?? '127.0.0.1';
// who may talk to this server: Host/Origin checks against cross-site abuse and DNS rebinding (server/security.ts, SECURITY.md)
const guard = createGuard({
  bindHost: HOST,
  allowHosts: splitList(...flagValues(argv, '--allow-host'), process.env.AGENTCLINIC_ALLOWED_HOSTS),
  allowOrigins: splitList(...flagValues(argv, '--allow-origin'), process.env.AGENTCLINIC_ALLOWED_ORIGINS),
});

// ───────────────────────────── LLM ─────────────────────────────

// auto = your own ANTHROPIC_API_KEY, else offline; your Claude Code login only as a personal opt-in (provider.ts, docs/SETUP.md#claude-code)
const localConfig = readLocalConfig(ROOT);
/** the startup choice (--llm, AGENTCLINIC_LLM, "llm" in agentclinic.local.json, else auto): also what Online uses when switched on */
const startupPref = llmPreference(arg('--llm'), localConfig).want;
const optInAtStart = claudeCodeOptIn(arg('--llm'), localConfig);
/** the same standing choice for Codex as the default ("codex": true, or asking for codex at startup) */
const codexOptInAtStart = codexOptIn(arg('--llm'), localConfig);
/**
 * Offline = no LLM anywhere on this server, however it came about (--llm offline, or auto finding no
 * key and no opt-in): scripted NPCs, only the scripted demo as AI doctor, the practice bot in Case
 * Duel. The Claude Code opt-in and per-shift LLM sources need an online server.
 *
 * The title screen switches it (POST /api/llm-mode, llm/mode.ts): new shifts, AI doctor runs and
 * duels follow, ones already running keep the brain they started with. Online, the default can be
 * changed there too, Codex or a local model included. Online with no provider is possible: no default
 * LLM, but Codex or a local model can be picked per shift.
 */
let provider = await detectProvider(arg('--llm'), localConfig);
let online = provider !== null;
/** the player's yes to Claude Code on the title screen, for this server run only (never saved) */
let claudeConsent = false;
/** the same for Codex as the default, like Claude Code's: once per run, unless codexOptInAtStart (a shift that picks Codex is its own yes) */
let codexConsent = false;
const consents = (): Consent => ({ claude: claudeConsent, codex: codexConsent });
/** which kind of default a provider is */
const useOf = (p: LlmProvider): OnlineUse => (p.status.provider === 'anthropic-api' ? 'api' : (p.status.provider as OnlineUse));
const claudeAllowed = () => online && (optInAtStart.allowed || claudeConsent);
const OFFLINE_SOURCE = 'This server is offline (no LLM): patients, families and staff are scripted. Switch to Online on the title screen to choose an LLM.';
/** an LLM chosen for one shift's NPCs: only on an online server */
function requireOnlineSource(selection: NpcSelection) {
  if (!online && selection.source !== 'default' && selection.source !== 'offline') throw new Error(OFFLINE_SOURCE);
}
let brain = new NpcBrain(provider);
const offlineBrain = new NpcBrain(null);
/** every brain and default provider this run made: sessions keep theirs after a switch; all are tidied at the end */
const brains = new Set<NpcBrain>([brain, offlineBrain]);
const providers = new Set<LlmProvider>(provider ? [provider] : []);
/**
 * The latest provider for each connection. Reuse it when its model and URL match;
 * existing runs retain their original provider when the default changes.
 */
const onlineLlms = new Map<OnlineUse, { provider: LlmProvider; brain: NpcBrain; model?: string; baseUrl?: string }>();
if (provider) onlineLlms.set(useOf(provider), { provider, brain, model: connectionModel(useOf(provider)) ?? provider.status.model, baseUrl: provider.status.provider === 'vllm' ? vllmUrl(process.env.LOCAL_API_URL ?? 'http://127.0.0.1:8000/v1') : undefined });
/** the Case Duel diagnosis second opinion: opt-in (AGENTCLINIC_DX_JUDGE=llm), and never on an offline server */
/** what menus show: the default NPC brain, or online without one */
function llmStatus(): LlmStatus {
  if (online && !provider) return { provider: 'offline', label: 'Online · no default LLM', ok: true, detail: 'Patients and staff stay scripted unless you pick a connection as the NPC source for your shift.' };
  return brain.status;
}
const selectedProviders = new Set<LlmProvider>();
async function selectBrain(value: unknown, address?: string): Promise<NpcBrain | undefined> {
  const selection = parseNpcSelection(value);
  requireOnlineSource(selection);
  requireLocalSelection(selection, address);
  const selected = await selectedProvider(selection);
  if (selected === undefined) return undefined;
  if (selected === null) return offlineBrain;
  selectedProviders.add(selected);
  return new NpcBrain(selected);
}
console.log(`[llm] ${brain.status.label}${brain.status.model ? ` · ${brain.status.model}` : ''}`);
if (!online) console.log('[llm] Offline server: no LLM anywhere (NPCs, the AI doctor, Case Duel). Switch to Online on the title screen, or start online: npm start -- --llm claude-code, or set ANTHROPIC_API_KEY.');
if (online && optInAtStart.allowed) console.log(`[claude-code] Your choice (${optInAtStart.via}): ${provider?.status.provider === 'claude-code' ? 'the characters and "Watch an AI doctor"' : '"Watch an AI doctor"'} may run on your own Claude Code login, on this machine. Don't host it for others or share a login (docs/SETUP.md#claude-code).`);
if (codexOptInAtStart.allowed) console.log(`[codex] Your choice (${codexOptInAtStart.via}): Online may use your own Codex login as the default without asking, on this machine. Don't host it for others or share a login.`);

// NPC voices: --tts kokoro|browser|off (server/tts; the model loads lazily when a player turns voice on)
const tts = createTts(arg('--tts') ?? process.env.AGENTCLINIC_TTS);
console.log(`[tts] ${tts.label}`);

// token/cost ledger (data/usage.json) + optional per-process NPC budget
const MAX_TOKENS = parseAmount(arg('--max-tokens') ?? process.env.AGENTCLINIC_MAX_TOKENS);
const MAX_USD = parseAmount(arg('--max-usd') ?? process.env.AGENTCLINIC_MAX_USD);
usage.configure({ file: process.env.AGENTCLINIC_USAGE_FILE ?? path.join(ROOT, 'data', 'usage.json'), maxTokens: MAX_TOKENS, maxUsd: MAX_USD, provider: brain.status.provider, apiEquivalent: provider?.billing !== 'api' });
process.on('exit', () => usage.flush());
if (MAX_TOKENS || MAX_USD) console.log(`[usage] NPC budget for this server run: ${[MAX_TOKENS && `${fmtTokens(MAX_TOKENS)} tokens`, MAX_USD && fmtUSD(MAX_USD)].filter(Boolean).join(' or ')}, then scripted offline NPCs`);

// ───────────────────────────── sessions ─────────────────────────────

const slots = new SaveSlots(process.env.AGENTCLINIC_SAVE_DIR ?? path.join(ROOT, 'data', 'saves'));

interface Run {
  journal?: ShiftJournal;
  embodied?: EmbodiedRun;
  session: GameSession;
  actions: { t: number; action: Action; ok: boolean; message?: string }[];
  clients: Set<WebSocket>;
  chartsSent: Map<WebSocket, Map<string, number>>;
  debriefSent: boolean;
  lastViewAt: number;
  saved: boolean;
  /** pending re-save of the run log (narration/usage that arrives after the shift ended) */
  patchTimer?: ReturnType<typeof setTimeout>;
}

const runs = new Map<string, Run>();
function releaseRun(run: Run) {
  const selected = run.session.brain.provider;
  run.session.brain.forget(`${run.session.id}:`);
  if (selected && selectedProviders.delete(selected)) selected.dispose();
  usage.forgetSession(run.session.id);
}

function createRun(opts: { owner?: string; npc?: NpcSelection; mapId: string; seed?: number; playerName?: string; mode: 'realtime' | 'step'; settings?: Partial<GameSettings>; llm?: string; driver?: AgentDriver; paceSec?: number; roster?: ScenarioDef['patients']; npcBrain?: NpcBrain; embodied?: EmbodiedRun }): Run {
  const session = new GameSession({
    scenarioId: opts.mapId,
    roster: opts.roster,
    id: opts.owner ? 's_' + randomUUID().replaceAll('-', '') : undefined,
    seed: opts.seed,
    playerName: opts.playerName ?? 'Resident',
    mode: opts.mode,
    settings: opts.settings,
    brain: opts.npcBrain ?? (opts.llm === 'offline' ? offlineBrain : brain),
  });
  const run: Run = { session, embodied: opts.embodied, actions: [], clients: new Set(), chartsSent: new Map(), debriefSent: false, lastViewAt: 0, saved: false };
  if (opts.owner) run.journal = new ShiftJournal(session, opts.owner, opts.npc);
  // played by an agent (REST/MCP): the AI resident appears as the ai_doctor NPC with a think-aloud feed
  if (opts.driver) attachAiDoctor(session, opts.driver, { paceSec: opts.paceSec });
  session.on((e) => {
    // speech: attach the cast voice and start synthesis right away (clients fetch /api/tts/:clipId)
    const ev = e.kind === 'speech' && run.clients.size ? tts.speech(session, e, () => session.settings.tts && run.clients.size > 0) : e;
    for (const ws of run.clients) send(ws, { type: 'event', event: ev });
    feedFromEvent(session, e); // agent sessions: pages, results, arrivals → the watchers' feed
    if (run.saved && e.kind === 'narration') scheduleRunPatch(run);
  });
  if (session.settings.tts) tts.warm();
  runs.set(session.id, run);
  usage.registerSession(session.id, { map: opts.mapId, player: session.playerName, apiEquivalent: session.brain.provider?.billing !== 'api' });
  const npc = session.brain.status;
  console.log(`[session] ${session.id} map=${opts.mapId} mode=${opts.mode} seed=${session.seed} player=${session.playerName} npc=${npc.provider}${npc.model ? ` model=${npc.model}` : ''}`);
  return run;
}

async function act(run: Run, action: Action) {
  const s = run.session;
  // agent sessions: one action at a time, with the watch pace between them (immediate for humans)
  const apply = async () => {
    const t = s.t;
    let result;
    try {
      result = run.journal ? await run.journal.act(action) : await s.act(action);
    } catch (e) {
      console.error('[act] error', e);
      result = { ok: false, message: `Server error: ${(e as Error).message}` };
    }
    run.actions.push({ t, action, ok: result.ok, message: result.message });
    recordAction(s, action, result); // where the ai_doctor stands and what it is doing
    if (s.ended) finish(run);
    return result;
  };
  return run.journal ? run.journal.sequence(apply) : paced(s, apply);
}

function finish(run: Run) {
  if (run.saved) return;
  run.saved = true;
  const s = run.session;
  const d = debrief(s);
  if (isAgentSession(s)) systemNote(s, `Shift over at ${s.clock()}: ${d.score}/${d.maxScore} (${d.percent}%, grade ${d.grade}). Debrief ready.`, d.percent >= 80 ? 'good' : d.percent >= 60 ? 'info' : 'warn');
  try {
    mkdirSync(DATA, { recursive: true });
    writeFileSync(
      path.join(DATA, `${s.id}.json`),
      JSON.stringify({ version: VERSION, map: s.scenario.id, seed: s.seed, player: s.playerName, mode: s.mode, ...(run.embodied ? { controlMode: 'embodied', observations: run.embodied.observations, doctor: { source: run.embodied.source, model: run.embodied.model, maxTurns: run.embodied.maxTurns, initialCamera: run.embodied.camera } } : isAgentSession(s) ? { controlMode: 'clinical' } : {}), llm: s.brain.status.provider, createdAt: new Date(s.createdAt).toISOString(), actions: run.actions, log: s.log, debrief: d, usage: usage.sessionSnapshot(s.id, s.brain.status.provider), ...(isAgentSession(s) ? { narration: narrationEntries(s) } : {}) }, null, 1),
    );
    takeFeedDirty(s);
  } catch (e) {
    console.warn('[save] could not write run log', e);
  }
  for (const ws of run.clients) send(ws, { type: 'debrief', debrief: d });
  run.debriefSent = true;
  console.log(`[session] ${s.id} ended — ${d.score}/${d.maxScore} (${d.percent}%, grade ${d.grade})`);
}

/** an AI doctor usually reports its final spend (and its reflection) after end_shift — keep the saved run log current */
function patchRunUsage(run: Run) {
  if (!run.saved) return;
  const file = path.join(DATA, `${run.session.id}.json`);
  try {
    const j = JSON.parse(readFileSync(file, 'utf8'));
    j.usage = usage.sessionSnapshot(run.session.id, run.session.brain.status.provider);
    if (run.embodied) j.observations = run.embodied.observations;
    if (takeFeedDirty(run.session)) j.narration = narrationEntries(run.session);
    writeFileSync(file, JSON.stringify(j, null, 1));
  } catch {
    /* run log missing/unwritable — finish() already warned */
  }
}

/** debounced patchRunUsage for narration lines that keep arriving after the shift ended */
function scheduleRunPatch(run: Run) {
  run.patchTimer ??= setTimeout(() => {
    run.patchTimer = undefined;
    patchRunUsage(run);
  }, 1500);
}

// observe mode: one AI doctor at a time, launched as a child process that plays a session created here
const observe = new ObserveManager({
  root: ROOT,
  baseUrl: `http://${['0.0.0.0', '::', ''].includes(HOST) ? '127.0.0.1' : HOST.includes(':') ? `[${HOST}]` : HOST}:${PORT}`,
  runsDir: DATA,
  maps: () => mapIds,
  createSession: async (o) => createRun({ mapId: o.mapId, seed: o.seed, playerName: o.label, mode: o.embodied ? 'realtime' : 'step', embodied: o.embodied, llm: o.offlineNpcs ? 'offline' : undefined, npcBrain: await selectBrain(o.npc, '127.0.0.1'), driver: o.embodied ? undefined : { label: o.label, model: o.model, observe: true }, paceSec: o.paceSec }).session.id,
  endSession: (id, reason) => {
    const r = runs.get(id);
    if (!r || r.saved) return;
    r.session.end(reason);
    finish(r);
  },
  note: (id, text, tone) => {
    const r = runs.get(id);
    if (r) systemNote(r.session, text, tone);
  },
  embodiedApi: () => provider?.status.provider === 'anthropic-api',
  observationChanged: id => {
    const r = runs.get(id);
    if (r?.saved) scheduleRunPatch(r);
  },
  reportUsage: (id, report) => {
    usage.recordAgent(id, report);
    const run = runs.get(id);
    if (run?.saved) scheduleRunPatch(run);
  },
  claudeOptIn: () => claudeAllowed(),
  online: () => online,
  claudeReady: async () => {
    const a = await checkClaudeCode();
    if (a.loggedIn) return { ok: true };
    return { ok: false, detail: a.installed ? 'Claude Code is installed but not logged in: run `claude` once and log in, or watch the scripted demo.' : 'Claude Code is not installed (https://claude.com/claude-code). Install it and log in, or watch the scripted demo.' };
  },
});
process.on('exit', () => observe.dispose());

// ───────────────────────────── online/offline from the title screen (llm/mode.ts) ─────────────────────────────

/** what this machine offers (Claude, Codex, a local model): looked up at most every 30 s unless asked to look again */
let facts: { at: number; f: LlmFacts } | null = null;
let customDefault: CustomApiConfig | undefined;
async function llmFacts(refresh: boolean): Promise<LlmFacts> {
  if (!refresh && facts && Date.now() - facts.at < 30_000) return facts.f;
  // (the standing choice only: a yes on the title screen is in consents(), so it counts at once)
  const f = await checkAvailability(optInAtStart.allowed, codexOptInAtStart.allowed, customDefault);
  facts = { at: Date.now(), f };
  return f;
}

/** the default now: null offline, 'none' online without one */
const currentUse = (): OnlineUse | null => (online ? (provider ? useOf(provider) : 'none') : null);

/**
 * The question before a login that spends the player's own plan. Claude Code's also offers the
 * default without Claude (planWithoutClaude) instead, when one is ready.
 */
function askFor(plan: Extract<OnlinePlan, { consent: true }>, f: LlmFacts, c: Consent) {
  const instead = plan.use === 'claude-code' ? planWithoutClaude(f, c) : null;
  return {
    label: plan.label,
    use: plan.use,
    needsConsent: true as const,
    // (plan: the login is a claude.ai plan, so use counts toward it; otherwise Claude Code bills its own API account)
    ...(plan.use === 'claude-code' ? { plan: !!f.claude?.subscriptionType } : {}),
    // (instead.needsConsent: Codex without a yes yet, so that button says what it spends and is the yes)
    ...(instead && 'label' in instead ? { instead: { use: instead.use, label: instead.label, ...(!instead.ok ? { needsConsent: true } : {}) } } : {}),
  };
}

/**
 * The title screen's view: the mode, the default now, what Online would use, and each LLM with what it
 * still needs (the list, which is also the picker). The look at this machine (claude, codex login
 * status, vLLM) runs only for the computer running the game: offline, where the card lists it, online
 * with no default, and otherwise online only when the player opens the picker (`withOptions`), so a
 * menu load while playing stays quick and starts nothing. For another computer on the network the
 * answer is the mode alone, at once (and never the host's login or plan).
 */
async function llmMode(local: boolean, refresh: boolean, withOptions: boolean) {
  const base = { online, current: currentUse(), switching, status: llmStatus(), canSwitch: local };
  // (online with no default, the list shows anyway: it is the way to get one)
  if (!local || (online && provider && !withOptions)) return { ...base, onlineWith: null, options: null };
  const f = await llmFacts(refresh);
  const c = consents();
  const plan = online ? null : planOnline(startupPref, f, c);
  const options = llmOptions(f, c);
  for (const option of Object.values(options)) {
    if (option.use !== 'none') option.model = onlineLlms.get(option.use)?.model ?? connectionModel(option.use) ?? f.vllm.model;
  }
  const custom = { baseUrl: f.vllm.url, model: customDefault ? customDefault.model ?? '' : process.env.LOCAL_API_MODEL || f.vllm.model || '' };
  if (!plan) return { ...base, onlineWith: null, options, custom };
  return {
    ...base,
    /** going online: what it would use, whether it asks first, or why it can't */
    onlineWith: plan.ok ? { label: plan.label, use: plan.use } : plan.consent ? askFor(plan, f, c) : null,
    why: plan.ok || plan.consent ? undefined : plan.error,
    options,
    custom,
  };
}

let switching = false;
/** every part that hands out LLMs for new shifts, and every open menu, learns of the switch */
function applyLlm() {
  usage.configure({ provider: llmStatus().provider, apiEquivalent: provider?.billing !== 'api' });
  const st = llmStatus();
  for (const ws of wss.clients) if (ws.readyState === 1) send(ws, { type: 'llm', llm: st, online });
}

/**
 * Offline, Online (its own pick, planOnline) or one LLM by name (`use`, the picker, planPick), also
 * while online: a new default needs no trip through Offline. `yes`: the player's yes to that login,
 * from the question (409 with `ask` when it is still needed).
 */
async function switchLlm(want: boolean, use?: OnlineUse, yes?: ConsentUse, model?: string, custom?: CustomApiConfig): Promise<{ status: number; body: Record<string, unknown> }> {
  if (switching) return { status: 409, body: { error: 'Already switching: one moment.' } };
  // Provider selections must reach the model/URL comparison below, even when the source is unchanged.
  if (!want ? !online : online && (!use || use === 'none' && currentUse() === 'none')) return { status: 200, body: {} };
  switching = true;
  try {
    if (!want) {
      online = false;
      provider = null;
      brain = offlineBrain;
      console.log('[llm] Switched offline on the title screen: no LLM for new shifts and AI doctor runs (running ones keep theirs).');
      applyLlm();
      return { status: 200, body: {} };
    }
    // Probe a draft without replacing a working configuration if the check fails.
    const f = custom ? { ...await llmFacts(false), vllm: await vllmFacts(custom) } : await llmFacts(true);
    const c: Consent = { claude: claudeConsent || yes === 'claude-code', codex: codexConsent || yes === 'codex' };
    const plan = use ? planPick(use, f, c) : planOnline(startupPref, f, c);
    if (!plan.ok) return plan.consent ? { status: 409, body: { error: plan.error, needsConsent: true, ask: askFor(plan, f, c) } } : { status: 503, body: { error: plan.error } };
    let llm = plan.use === 'none' ? null : onlineLlms.get(plan.use);
    // A model or URL edit needs a new provider. Running shifts keep the old one.
    const selectedModel = plan.use === 'vllm' ? f.vllm.model : connectionModel(plan.use, model);
    if (llm && (llm.model !== selectedModel || plan.use === 'vllm' && llm.baseUrl !== f.vllm.url)) llm = undefined;
    // Same connection settings: keep the current provider.
    if (online && llm && llm.provider === provider) {
      if (custom) { customDefault = custom; facts = { at: Date.now(), f }; applyLlm(); }
      return { status: 200, body: {} };
    }
    if (plan.use !== 'none' && !llm) {
      let p: LlmProvider | null;
      try {
        p = await startOnline(plan.use, f, selectedModel);
      } catch (e) {
        return { status: 503, body: { error: (e as Error).message } };
      }
      if (p) {
        llm = { provider: p, brain: new NpcBrain(p), model: selectedModel, baseUrl: plan.use === 'vllm' ? f.vllm.url : undefined };
        onlineLlms.set(plan.use, llm);
        providers.add(p);
        brains.add(llm.brain);
      }
    }
    if (yes === 'claude-code' && plan.use === 'claude-code' && !optInAtStart.allowed && !claudeConsent) {
      claudeConsent = true;
      console.log('[claude-code] You said yes on the title screen: the characters and "Watch an AI doctor" may run on your own Claude Code login for this server run (not saved). Don\'t host it for others or share a login (docs/SETUP.md#claude-code).');
    }
    if (yes === 'codex' && plan.use === 'codex' && !codexOptInAtStart.allowed && !codexConsent) {
      codexConsent = true;
      console.log('[codex] You said yes on the title screen: the patients and staff may run on your own Codex login for this server run (not saved; a ChatGPT login uses your plan allowance). Don\'t host it for others or share a login.');
    }
    const was = online;
    if (custom) { customDefault = custom; facts = { at: Date.now(), f }; }
    provider = llm?.provider ?? null;
    online = true;
    // (online without a default: scripted NPCs until a shift picks Codex or a local model)
    brain = llm?.brain ?? offlineBrain;
    console.log(`[llm] ${was ? 'Default LLM changed' : 'Switched online'} on the title screen: ${plan.label} for new shifts and AI doctor runs (running ones keep theirs).`);
    applyLlm();
    return { status: 200, body: {} };
  } finally {
    switching = false;
  }
}

// realtime loop
let last = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = Math.min(1, (now - last) / 1000);
  last = now;
  for (const run of runs.values()) {
    const s = run.session;
    if (s.mode === 'realtime' && run.clients.size > 0) {
      if (run.journal) run.journal.tick(dt);
      else s.tick(dt);
    }
    if (s.ended && !run.saved) finish(run);
    if (run.clients.size && (s.dirty || now - run.lastViewAt > 1000) && now - run.lastViewAt > 200) {
      run.lastViewAt = now;
      s.dirty = false;
      const view = buildView(s, s.brain.status);
      for (const ws of run.clients) {
        send(ws, { type: 'state', view });
        const sent = run.chartsSent.get(ws);
        if (sent) {
          for (const [pid, v] of sent) {
            const p = s.patients.get(pid);
            if (p && p.version !== v) {
              sent.set(pid, p.version);
              send(ws, { type: 'chart', chart: buildChart(s, p) });
            }
          }
        }
      }
    }
  }
  // GC idle sessions
  for (const [id, run] of runs) {
    if (run.clients.size === 0 && now - run.session.lastActivity > 3 * 3600 * 1000) {
      releaseRun(run);
      runs.delete(id);
    }
  }
}, 100);

// ───────────────────────────── WebSocket ─────────────────────────────

function send(ws: WebSocket, msg: ServerMsg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

/** the run each socket is bound to */
const boundRun = new WeakMap<WebSocket, Run>();

function bind(ws: WebSocket, run: Run) {
  for (const r of runs.values()) {
    r.clients.delete(ws);
    r.chartsSent.delete(ws);
  }
  run.clients.add(ws);
  run.chartsSent.set(ws, new Map());
  boundRun.set(ws, run);
  send(ws, { type: 'state', view: buildView(run.session, run.session.brain.status) });
  // a spectator joining an agent's shift gets the think-aloud transcript so far
  for (const entry of narrationEntries(run.session)) send(ws, { type: 'event', event: { kind: 'narration', entry } });
  if (run.session.ended) send(ws, { type: 'debrief', debrief: debrief(run.session) });
}

function onSocket(ws: WebSocket, req: http.IncomingMessage) {
  send(ws, { type: 'welcome', version: VERSION, llm: llmStatus(), online, maps: mapSummaries, tts: tts.mode, ...(tts.note ? { ttsNote: tts.note } : {}) });
  let run: Run | null = null;
  async function createSoloRun(opts: Pick<Parameters<typeof createRun>[0], 'owner' | 'mapId' | 'seed' | 'playerName' | 'settings' | 'npc' | 'roster'>) {
    const npc = parseNpcSelection(opts.npc);
    const npcBrain = await selectBrain(npc, req.socket.remoteAddress);
    if (ws.readyState !== 1) {
      if (npcBrain?.provider && selectedProviders.delete(npcBrain.provider)) npcBrain.provider.dispose();
      return;
    }
    return createRun({ ...opts, mode: 'realtime', npc, npcBrain });
  }
  ws.on('message', async (raw) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    run = boundRun.get(ws) ?? run;
    try {
      switch (msg.type) {
        case 'slots':
        case 'save_slot':
        case 'load_slot': {
          try {
            if (!validOwner(msg.owner)) throw new Error('Save library unavailable.');
            if (msg.type === 'slots') {
              send(ws, { type: 'slots', slots: slots.list(msg.owner) });
            } else if (msg.type === 'save_slot') {
              const current = run;
              const j = current?.journal;
              if (!current || !j || j.owner !== msg.owner) throw new Error('Only your solo shift can be saved.');
              if (!msg.player?.rotation || !Array.isArray(msg.player.rotation.items) || typeof msg.name !== 'string') throw new Error('Incomplete player state.');
              const info = await j.sequence(() => {
                const { session, byNpc, models } = usage.sessionView(j.session.id, j.session.brain.status.provider);
                return slots.write(msg.owner, msg.slot, msg.revision, msg.name, {
                  history: j.history, actions: current.actions, player: msg.player, digest: j.digest(), usage: { session, byNpc, models },
                }, { map: j.session.scenario.title, clock: j.session.clock(), ended: j.session.ended });
              });
              send(ws, { type: 'slot_saved', info });
            } else {
              const saved = slots.read(msg.owner, msg.slot);
              if (!saved) throw new Error('This slot is empty.');
              const restored = await createSoloRun({ ...saved.history, owner: msg.owner });
              if (!restored) return;
              try {
                await restored.journal!.restore(saved.history);
                if (saved.digest && restored.journal!.digest() !== saved.digest) throw new Error('This save does not match this simulation version.');
                if (saved.usage) usage.restoreSessionUsage(restored.session.id, saved.usage);
              } catch (e) {
                runs.delete(restored.session.id);
                releaseRun(restored);
                throw e;
              }
              restored.actions = saved.actions;
              restored.saved = restored.session.ended;
              run = restored;
              send(ws, { type: 'slot_loaded', player: saved.player, sessionId: restored.session.id });
              bind(ws, restored);
            }
          } catch (e) {
            send(ws, { type: 'slot_error', message: (e as Error).message });
          }
          break;
        }
        case 'leave_solo': {
          if (run?.journal) {
            run.clients.delete(ws);
            run.chartsSent.delete(ws);
            boundRun.delete(ws);
            run = null;
          }
          break;
        }
        case 'start': {
          if (!mapIds.includes(msg.mapId)) return send(ws, { type: 'error', message: `Unknown map ${msg.mapId}` });
          const started = await createSoloRun({ owner: validOwner(msg.owner) ? msg.owner : undefined,
            mapId: msg.mapId, seed: msg.seed, playerName: msg.playerName, settings: msg.settings, npc: msg.npc });
          if (!started) return;
          run = started;
          bind(ws, run);
          break;
        }
        case 'resume': {
          const r = runs.get(msg.sessionId);
          if (!r) return send(ws, { type: 'error', message: 'Session expired — start a new shift.' });
          if (r.embodied && r.embodied.token !== msg.driverToken) return send(ws, { type: 'error', message: 'Open the embodied spectator link to watch this shift.' });
          run = r;
          bind(ws, r);
          break;
        }
        case 'action': {
          if (!run) return send(ws, { type: 'error', message: 'No active session.' });
          // agent-driven shifts are watch-only for browsers (a spectator walking around must not move the agent)
          if (isAgentSession(run.session)) return send(ws, { type: 'actionResult', reqId: msg.reqId, result: { ok: false, message: 'An AI doctor is playing this shift: you can watch, not act.' } });
          const result = await act(run, msg.action);
          send(ws, { type: 'actionResult', reqId: msg.reqId, result });
          run.session.dirty = true;
          break;
        }
        case 'settings': {
          if (!run) return;
          // spectators of an agent's shift may only toggle voices (units/clock would change what the agent sees)
          const st: Partial<GameSettings> = isAgentSession(run.session)
            ? typeof msg.settings.tts === 'boolean'
              ? { tts: msg.settings.tts }
              : {}
            : msg.settings;
          if (st.timeScale !== undefined) st.timeScale = Math.max(0.5, Math.min(60, st.timeScale));
          const journal = run.journal;
          if (journal) await journal.sequence(() => journal.settings(st));
          else run.session.settings = { ...run.session.settings, ...st };
          run.session.dirty = true;
          if (st.tts) tts.warm();
          break;
        }
        case 'focus':
          // a spectator's open panel must not slow an agent's clock (a realtime agent session slows while focused)
          if (run?.journal) {
            const journal = run.journal;
            await journal.sequence(() => journal.focus(msg.focus));
          } else if (run && !isAgentSession(run.session)) run.session.focus = msg.focus;
          break;
        case 'aside': {
          // a staff member's line from this player's own world (the cashier after a coffee): voiced with
          // their cast voice and sent back to this socket only. Nothing in the session changes.
          const r = run;
          const who = r?.session.staff.get(msg.npcId);
          const text = typeof msg.text === 'string' ? msg.text.replace(/\s+/g, ' ').trim().slice(0, 160) : '';
          if (!r || !who || !text) break;
          const e = { kind: 'speech' as const, npcId: msg.npcId, name: who.def.name, text };
          send(ws, { type: 'event', event: tts.speech(r.session, e, () => r.session.settings.tts && ws.readyState === ws.OPEN) });
          break;
        }
        case 'watcher_talk':
        case 'watcher_thread': {
          // observe mode: the watcher's own off-the-record talk, answered to this socket only (server/npc/watcher.ts)
          const r = run;
          await watcherMessage(r?.session, msg, { send: (m) => send(ws, m), voice: (e) => (r ? tts.speech(r.session, e, () => r.session.settings.tts && ws.readyState === ws.OPEN) : e) });
          break;
        }
        case 'chart': {
          if (!run) return;
          const p = run.session.patients.get(msg.patientId);
          if (!p?.arrived) return;
          run.chartsSent.get(ws)?.set(p.id, p.version);
          send(ws, { type: 'chart', chart: buildChart(run.session, p) });
          break;
        }
        case 'ping':
          break;
      }
    } catch (e) {
      console.error('[ws] error', e);
      send(ws, { type: 'error', message: (e as Error).message });
    }
  });
  ws.on('close', () => {
    run = boundRun.get(ws) ?? run;
    if (run) {
      run.clients.delete(ws);
      run.chartsSent.delete(ws);
    }
  });
}

// ───────────────────────────── HTTP (agent API + static) ─────────────────────────────

function json(res: http.ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); // CORS only for --allow-origin pages (set by the guard)
  res.end(JSON.stringify(body));
}

async function body(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return {};
  }
}

function agentPayload(run: Run) {
  const s = run.session;
  return { sessionId: s.id, t: s.t, clock: s.clock(), ended: s.ended, location: s.playerLocation, observation: observationText(s) };
}

async function api(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
  if (parts[0] !== 'api') return false;
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,POST,DELETE', 'access-control-max-age': '600' });
    res.end();
    return true;
  }
  if (parts[1] === 'health') return json(res, 200, { ok: true, version: VERSION, llm: llmStatus(), online, sessions: runs.size }), true;
  // online/offline from the title screen: GET what this machine offers (?refresh=1 looks again; ?options=1 the picker, online too),
  // POST {online, use?, consent?} switches (use: a default by name; consent: the yes to that login, 'claude-code' or 'codex')
  if (parts[1] === 'llm-mode' && parts.length === 2) {
    const local = isLocalAddress(req.socket.remoteAddress);
    if (req.method === 'GET') return json(res, 200, await llmMode(local, url.searchParams.has('refresh'), url.searchParams.has('options'))), true;
    if (req.method === 'POST') {
      if (!local) return json(res, 403, { error: 'Only the computer running the game can switch between online and offline.' }), true;
      const b = await body(req);
      if (typeof b.online !== 'boolean') return json(res, 400, { error: 'online must be true or false' }), true;
      if (b.use !== undefined && !(['api', 'claude-code', 'codex', 'openai-api', 'vllm', 'none'] as unknown[]).includes(b.use)) return json(res, 400, { error: 'use must be api, claude-code, codex, openai-api, vllm or none' }), true;
      if (b.consent !== undefined && b.consent !== 'claude-code' && b.consent !== 'codex') return json(res, 400, { error: 'consent must be claude-code or codex' }), true;
      let model: string | undefined;
      let custom: CustomApiConfig | undefined;
      try {
        if (b.model !== undefined && (!b.use || b.use === 'none')) throw new Error('Select a connection before choosing a model.');
        if (b.baseUrl !== undefined && b.use !== 'vllm') throw new Error('baseUrl applies only to the custom API default.');
        model = modelName(b.model);
        if (b.use === 'vllm' && (b.baseUrl !== undefined || b.model !== undefined)) {
          custom = { baseUrl: vllmUrl(b.baseUrl ?? customDefault?.baseUrl ?? process.env.LOCAL_API_URL ?? 'http://127.0.0.1:8000/v1'), model };
        }
      } catch (e) { return json(res, 400, { error: (e as Error).message }), true; }
      const r = await switchLlm(b.online, b.use as OnlineUse | undefined, b.consent as ConsentUse | undefined, model, custom);
      return json(res, r.status, r.status === 200 ? await llmMode(local, false, true) : r.body), true;
    }
  }
  if (parts[1] === 'llm-check' && req.method === 'POST') {
    const value = await readJsonCapped(req, 4096);
    if (!value || value === 'too_large') return json(res, 400, { error: 'Invalid source selection.' }), true;
    try {
      const selection = parseNpcSelection(value);
      requireOnlineSource(selection);
      requireLocalSelection(selection, req.socket.remoteAddress);
      const selected = await selectedProvider(selection);
      // (the server default as the title card shows it: "Online · no default LLM" too)
      const status = selected === undefined ? llmStatus() : selected === null ? offlineBrain.status : selected.status;
      selected?.dispose();
      return json(res, 200, { status }), true;
    } catch (error) { return json(res, 400, { error: (error as Error).message }), true; }
  }
  if (parts[1] === 'tts') return await tts.http(req, res, parts), true;
  if (parts[1] === 'usage' && parts.length === 2 && req.method === 'GET') return json(res, 200, usage.summary()), true;
  if (parts[1] === 'practice-search' && parts.length === 2 && req.method === 'GET')
    return json(res, 200, findPracticeCases(url.searchParams.get('q') ?? '')), true;
  if (parts[1] === 'maps') return json(res, 200, mapSummaries), true;
  if (parts[1] === 'catalog') {
    if (url.searchParams.get('format') === 'text') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(catalogText());
      return true;
    }
    return json(res, 200, { orders: ORDERS, orderSets: ORDER_SETS, exam: EXAM_MANEUVERS, analytes: ANALYTES }), true;
  }
  // observe mode: launch / watch / stop one AI doctor (server/observe.ts)
  if (parts[1] === 'observe' && parts.length === 2) {
    const r = await observe.handle(req);
    return json(res, r.status, r.body), true;
  }
  if (parts[1] === 'observe' && parts.length === 4 && parts[3] === 'frame' && req.method === 'GET') {
    const frame = observe.frame(parts[2]);
    res.writeHead(frame ? 200 : 204, { 'content-type': 'image/jpeg', 'cache-control': 'no-store' });
    res.end(frame);
    return true;
  }
  if (parts[1] === 'observe' && parts.length === 4 && parts[3] === 'live' && req.method === 'GET') {
    observe.stream(parts[2], res);
    return true;
  }
  if (parts[1] === 'runs' && parts.length === 4 && parts[3] === 'observations' && req.method === 'GET') {
    const current = runs.get(parts[2])?.embodied?.observations;
    if (current) return json(res, 200, current), true;
    const saved = readRunFile(DATA, parts[2], 'run');
    const log = saved.status === 200 ? JSON.parse(saved.body).observations : undefined;
    return json(res, log ? 200 : 404, log ?? { error: 'No observation log' }), true;
  }
  if (parts[1] === 'runs' && parts.length === 5 && parts[3] === 'observations' && req.method === 'GET') {
    const [, , id, , name] = parts;
    if (!/^s_[a-z0-9_]{1,60}$/i.test(id) || !/^[1-9][0-9]{0,2}\.jpg$/.test(name)) return json(res, 400, { error: 'Bad observation id' }), true;
    try {
      const image = await readFile(path.join(DATA, id + '.observations', name));
      res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=86400, immutable' }).end(image);
    } catch { json(res, 404, { error: 'Observation unavailable' }); }
    return true;
  }
  // saved run logs: /api/runs/:id (JSON, once the shift ended) and /api/runs/:id/agent-log (observe runs)
  if (parts[1] === 'runs' && req.method === 'GET' && parts[2] && (parts.length === 3 || (parts.length === 4 && parts[3] === 'agent-log'))) {
    const f = readRunFile(DATA, parts[2], parts[3] === 'agent-log' ? 'agent-log' : 'run');
    res.writeHead(f.status, { 'content-type': f.type, 'cache-control': 'no-store' });
    res.end(f.body);
    return true;
  }
  if (parts[1] === 'sessions') {
    if (req.method === 'POST' && parts.length === 2) {
      const b = await body(req);
      const mapId = String(b.mapId ?? 'night_shift');
      if (!mapIds.includes(mapId)) return json(res, 400, { error: `Unknown map ${mapId}`, maps: mapIds }), true;
      let npcBrain: NpcBrain | undefined;
      try { npcBrain = await selectBrain(b.npc, req.socket.remoteAddress); }
      catch (error) { return json(res, 400, { error: (error as Error).message }), true; }
      const run = createRun({
        mapId,
        seed: typeof b.seed === 'number' ? b.seed : undefined,
        playerName: typeof b.playerName === 'string' ? b.playerName : 'AI agent',
        mode: b.mode === 'realtime' ? 'realtime' : 'step',
        llm: typeof b.llm === 'string' ? b.llm : undefined,
        npcBrain,
        settings: (b.settings as Partial<GameSettings>) ?? undefined,
        // every REST session is played by an agent: it shows up as the ai_doctor NPC; pace = seconds between its actions for watchers
        driver: { label: typeof b.playerName === 'string' ? b.playerName : 'AI agent', model: typeof b.model === 'string' ? b.model : undefined },
        paceSec: typeof b.pace === 'number' ? b.pace : undefined,
      });
      return json(res, 201, { ...agentPayload(run), contacts: contactsText(run.session), spectateUrl: `http://${HOST}:${PORT}/?spectate=${run.session.id}` }), true;
    }
    const run = parts[2] ? runs.get(parts[2]) : undefined;
    if (!run || run.embodied) return json(res, 404, { error: 'Unknown session' }), true;
    const s = run.session;
    if (req.method === 'GET' && parts.length === 3) return json(res, 200, { ...agentPayload(run), view: buildView(s, s.brain.status) }), true;
    if (req.method === 'POST' && parts[3] === 'act') {
      const b = await body(req);
      const action = b.action as Action | undefined;
      if (!action || typeof action !== 'object' || typeof action.type !== 'string') return json(res, 400, { error: 'Body must be {"action": {...}}' }), true;
      const result = await act(run, action);
      s.dirty = true;
      return json(res, 200, { result, ...agentPayload(run) }), true;
    }
    if (parts[3] === 'usage' && req.method === 'GET') return json(res, 200, usage.sessionView(s.id, s.brain.status.provider)), true;
    if (parts[3] === 'usage' && req.method === 'POST') {
      // cumulative usage of the AI doctor playing this session (agents/claude-doctor.ts)
      const report = sanitizeAgentReport(await body(req));
      if (!report) return json(res, 400, { error: 'Body must be cumulative agent usage: { calls, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, costUSD, label?, model?, billing?, final? }' }), true;
      const agent = usage.recordAgent(s.id, report);
      s.dirty = true;
      patchRunUsage(run);
      return json(res, 200, { ok: true, agent }), true;
    }
    if (parts[3] === 'narration') {
      // the AI resident's think-aloud feed (server/sim/aiDoctor.ts)
      if (req.method === 'GET') return json(res, 200, { entries: narrationEntries(s, Number(url.searchParams.get('since')) || 0) }), true;
      if (req.method === 'POST') {
        const b = await readJsonCapped(req, 16 * 1024);
        if (b === 'too_large') return json(res, 413, { error: 'Narration body too large (16 KB max).' }), true;
        const r = narrationRequest(s, b);
        return json(res, r.status, r.body), true;
      }
    }
    if (parts[3] === 'pace' && req.method === 'POST') {
      if (!isAgentSession(s)) return json(res, 409, { error: 'Pacing applies to agent-driven sessions only.' }), true;
      const b = await readJsonCapped(req, 1024);
      if (!b || b === 'too_large' || typeof b.seconds !== 'number') return json(res, 400, { error: 'Body must be {"seconds": 0–10}' }), true;
      return json(res, 200, { ok: true, paceSec: setPace(s, b.seconds) }), true;
    }
    if (req.method === 'GET' && parts[3] === 'debrief') {
      // Practice and roster runs keep the source report, rubric and diagnoses sealed until the end.
      if (s.scenario.bedPool && !s.ended) return json(res, 409, { error: 'End the shift to receive the debrief.' }), true;
      return json(res, 200, debrief(s)), true;
    }
    if (req.method === 'GET' && parts[3] === 'contacts') return json(res, 200, { contacts: contactsText(s) }), true;
    if (req.method === 'DELETE') {
      s.end('Session deleted');
      finish(run);
      releaseRun(run);
      runs.delete(s.id);
      return json(res, 200, { ok: true }), true;
    }
  }
  json(res, 404, { error: 'Not found' });
  return true;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.json': 'application/json',
  '.glb': 'model/gltf-binary',
  '.txt': 'text/plain; charset=utf-8',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.hdr': 'image/vnd.radiance',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

async function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  let file = path.normalize(path.join(DIST, decodeURIComponent(url.pathname)));
  if (file !== DIST && !file.startsWith(DIST + path.sep)) {
    // (+ path.sep: a sibling such as dist/client-x must not pass; on Windows "%5c" decodes to a separator)
    res.writeHead(403);
    res.end();
    return;
  }
  // game assets (/res/…) must 404 when missing — falling back to index.html would make loaders choke on HTML
  if (!existsSync(file) && url.pathname.startsWith('/res/')) {
    res.writeHead(404);
    res.end();
    return;
  }
  if (!existsSync(file) || url.pathname === '/') file = path.join(DIST, 'index.html');
  try {
    // Vite's bundles (/assets/…) carry a content hash in their names, so they can be cached for good.
    // Every other file keeps its name across updates (/res/… models, animations, textures, audio,
    // index.html): browsers must revalidate (ETag → 304), or an update never reaches a returning
    // player. v0.1 marked them "immutable" for a year, and an animations file from before the run
    // clips lived on in browsers. (The client also versions /res URLs: client/src/resCache.ts.)
    const hashed = url.pathname.startsWith('/assets/');
    const st = await stat(file);
    const etag = `W/"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
    if (!hashed && req.headers['if-none-match'] === etag) {
      res.writeHead(304, { etag, 'cache-control': 'no-cache' });
      res.end();
      return;
    }
    const data = await readFile(file);
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
      'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
      ...(hashed ? {} : { etag }),
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Client not built — run `npm run build` (or start with `npm start`).');
  }
}

const server = http.createServer();
let vite: { middlewares: (req: http.IncomingMessage, res: http.ServerResponse, next: () => void) => void } | null = null;
if (DEV) {
  const { createServer } = await import('vite');
  vite = await createServer({ configFile: path.join(ROOT, 'vite.config.ts'), server: { middlewareMode: true, hmr: { server }, allowedHosts: guard.policy.extraHosts }, appType: 'spa' });
}

server.on('request', async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost'); // fixed base: Host is untrusted until the guard checks it
    if (!guard.request(req, res, url.pathname)) return; // Host/Origin guard, before every route: 403 already sent
    if (await api(req, res, url)) return;
    if (vite) vite.middlewares(req, res, () => serveStatic(req, res, url));
    else await serveStatic(req, res, url);
  } catch (e) {
    console.error('[http] error', e);
    if (!res.headersSent) json(res, 500, { error: (e as Error).message });
  }
});

const wss = new WebSocketServer({ noServer: true });
wss.on('connection', onSocket);
// prepended so that in --dev it also runs before Vite's HMR listener: refused sockets reach neither
server.prependListener('upgrade', (req, socket, head) => {
  if (!guard.upgrade(req, socket)) return; // Host/Origin guard: 403 written, socket closed
  if ((req.url ?? '').startsWith('/ws')) wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  else if (!vite) socket.destroy();
});

server.on('error', (e: NodeJS.ErrnoException) => {
  // npm start picks a free port itself (bin/agentclinic.mjs); this covers npm run server / dev and races
  if (e.code === 'EADDRINUSE') console.error(`[server] Port ${PORT} on ${HOST} is already in use (is AgentClinic already running?). Start with --port <another port>.`);
  else if (e.code === 'EACCES' || e.code === 'EADDRNOTAVAIL') console.error(`[server] Cannot listen on ${HOST}:${PORT} (${e.code}). Try another --port or --host.`);
  else console.error('[server] error', e);
  process.exit(1);
});

// --exit-when-idle: close the ED once no game tab is open and no agent calls the API (server/idleExit.ts)
const IDLE_MS = idleExitMs(argv);
const idle = IDLE_MS
  ? new IdleExit({
      idleMs: IDLE_MS,
      onIdle: () => {
        console.log(`[idle] No game tab open for ${fmtIdle(IDLE_MS)}, so the ED is closing (--exit-when-idle). npm start opens it again.`);
        shutdown();
      },
    })
  : null;
if (idle) {
  wss.on('connection', (ws) => {
    idle.connected();
    ws.once('close', () => idle.disconnected());
  });
  server.on('request', (req) => {
    const p = (req.url ?? '').split('?')[0];
    if (p.startsWith('/api/') && p !== '/api/health') idle.activity();
  });
  idle.start();
}

server.listen(PORT, HOST, () => {
  const url = `http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`;
  console.log(`[server] GTAgentClinic v${VERSION} on ${url}${DEV ? ' (dev)' : ''}`);
  if (guard.policy.anyIp) console.log('[security] LAN mode: anyone on your network can join by IP address and play on your NPC login; add host names with --allow-host');
  if (IDLE_MS) console.log(`[idle] Closes by itself ${fmtIdle(IDLE_MS)} after the last game tab (--exit-when-idle).`);
  if (process.send) process.send({ ready: true, url });
});

const shutdown = () => {
  observe.dispose(); // the AI doctor's process group (agent, claude, MCP server)
  for (const p of providers) p.dispose();
  for (const selected of selectedProviders) selected.dispose();
  tts.dispose();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGHUP', shutdown); // its terminal closed: stop the claude and agent processes too
