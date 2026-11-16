/**
 * Observe mode: the server launches one AI doctor through Claude Code, Codex SDK,
 * vLLM, or the free scripted demo (agents/demo-agent.ts), to play a
 * step-mode session it has just created, so a human can watch it walk the ED in 3D.
 *
 *   POST   /api/observe  {mapId, seed?, agent: 'claude'|'codex'|'vllm'|'demo', model?, npc?, baseUrl?, pace?, maxTurns?}
 *          → 201 {sessionId, spectateUrl, …}; the client attaches as a spectator right away
 *   GET    /api/observe  → {running, current?}
 *   DELETE /api/observe  → stops the agent and ends its shift (debrief + run log as usual)
 *   GET    /api/runs/:id            → saved run log (data/runs/<id>.json, after the shift ends)
 *   GET    /api/runs/:id/agent-log  → the agent's console output (data/runs/<id>.agent.log)
 *
 * Process hygiene: the agent runs as `node --import tsx <agent>.ts` (no npx/tsx wrapper), in
 * its own process group, with an IPC channel. Stop/exit signal the whole group (the agent,
 * `claude`, and its MCP server); the agents also exit when the IPC channel drops, which
 * covers a server that dies without running its exit handlers. At most one AI doctor at a
 * time. Starting or stopping one is limited to this machine (loopback), since it runs on the
 * user's model connections.
 */
import type { EmbodiedEvent, ObservationLog } from '../shared/embodied';
import { randomUUID } from 'node:crypto';
import { sanitizeAgentReport, type AgentReport } from './usage';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, type WriteStream } from 'node:fs';
import type http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { childEnv } from './llm/provider';
import { CODEX_DOCTOR_MODEL, modelName, parseNpcSelection, vllmUrl, type NpcSelection } from '../shared/llm';
import { codexReady } from './llm/selection';
import { VllmClient } from './llm/vllm';
import type { HttpReply } from './sim/aiDoctor';

export type ControlMode = 'clinical' | 'embodied';
export type ObserveAgent = 'claude' | 'demo' | 'codex' | 'vllm';
export const OBSERVE_MODELS = ['haiku', 'sonnet', 'opus'] as const;
export type ObserveModel = (typeof OBSERVE_MODELS)[number];

export interface EmbodiedRun {
  token: string;
  observations: ObservationLog;
  source: 'api' | 'claude-code';
  model?: ObserveModel;
  maxTurns: number;
  camera: 'first' | 'third';
}

export interface ObserveStatus {
  sessionId: string;
  agent: ObserveAgent;
  controlMode: ControlMode;
  model?: string;
  mapId: string;
  seed: number;
  paceSec: number;
  state: 'running' | 'finished' | 'stopped' | 'failed';
  pid?: number;
  startedAt: number;
  endedAt?: number;
  exitCode?: number | null;
  error?: string;
  lastObservation?: { number: number; at: number };
  decision?: Extract<EmbodiedEvent, { kind: 'decision' }>;
  eventCount?: number;
  /** last lines of the agent's console output */
  tail: string[];
  logUrl: string;
  runLogUrl: string;
}

export interface ObserveHooks {
  root: string;
  /** where the agent reaches this server, e.g. http://127.0.0.1:5317 */
  baseUrl: string;
  runsDir: string;
  maps: () => string[];
  /** Create a clinical step-mode session or an embodied realtime session. */
  createSession(o: { mapId: string; seed: number; label: string; model?: string; paceSec: number; offlineNpcs: boolean; npc?: NpcSelection; embodied?: EmbodiedRun }): string | Promise<string>;
  /** end the session if it is still running (debrief + run log) */
  endSession(sessionId: string, reason: string): void;
  /** a line in the session's think-aloud feed */
  note(sessionId: string, text: string, tone?: 'info' | 'good' | 'warn' | 'bad'): void;
  /** is the personal Claude Code opt-in on? (server/llm/provider.ts claudeCodeOptIn; off by default) */
  claudeOptIn(): boolean;
  /** false on an offline server (no LLM anywhere): only the scripted demo plays (absent = online) */
  online?(): boolean;
  /** is Claude Code installed and logged in? */
  claudeReady(): Promise<{ ok: boolean; detail?: string }>;
  embodiedApi?(): boolean;
  observationChanged?(id: string): void;
  reportUsage?(sessionId: string, report: AgentReport): void;
  log?: (line: string) => void;
}

/** why "Claude" is unavailable as the AI doctor until the player opts in (shown in the menu) */
export const OFFLINE_DOCTOR =
  'This server is offline (no LLM), so only the scripted demo can play. Switch to Online on the title screen for Claude, Codex or a local model.';

export const CLAUDE_DOCTOR_OPT_IN =
  'Claude as the AI doctor launches your own Claude Code CLI, so it needs your choice first: answer yes when npm start asks, or start with --llm claude-code (docs/SETUP.md#claude-code). Meanwhile, watch the free scripted demo, or add the agentclinic MCP server to your own Claude Code and ask it to play a shift (docs/AI_AGENTS.md).';

interface Launch {
  status: ObserveStatus;
  child: ChildProcess | null;
  logFile: WriteStream | null;
  logBytes: number;
  frame?: Buffer;
  viewers: Set<http.ServerResponse>;
  stopRequested: boolean;
  done: boolean;
}

const MAX_LOG_BYTES = 4 * 1024 * 1024;
const TAIL_LINES = 40;
const SESSION_ID = /^s_[a-z0-9_]{1,60}$/i;
const LABELS: Record<ObserveModel, string> = { haiku: 'Claude Haiku', sonnet: 'Claude Sonnet', opus: 'Claude Opus' };

export function isLoopback(addr: string | undefined): boolean {
  if (!addr) return false;
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1' || addr.startsWith('127.');
}

/** read a JSON body of at most `max` bytes (null: not JSON / not an object; 'too_large') */
export async function readJsonCapped(req: http.IncomingMessage, max = 16 * 1024): Promise<Record<string, unknown> | null | 'too_large'> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > max) return 'too_large';
    chunks.push(c as Buffer);
  }
  if (!chunks.length) return {};
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** signal a detached child's whole process group (agent → claude → MCP server); falls back to the child */
function killGroup(child: ChildProcess | null, sig: NodeJS.Signals) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    // no process groups or signals on Windows: end the whole tree (/T), or claude.exe would outlive the agent
    if (child.exitCode === null && child.signalCode === null) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    return;
  }
  try {
    process.kill(-child.pid, sig);
  } catch {
    try {
      if (child.exitCode === null && child.signalCode === null) child.kill(sig);
    } catch {
      /* already gone */
    }
  }
}

export function validateObserve(body: Record<string, unknown>, maps: string[]): { ok: true; controlMode: ControlMode; camera: 'first' | 'third'; mapId: string; agent: ObserveAgent; model?: string; seed: number; paceSec: number; maxTurns: number; npc?: NpcSelection; baseUrl?: string } | { ok: false; error: string } {
  const mapId = typeof body.mapId === 'string' ? body.mapId : 'night_shift';
  if (!maps.includes(mapId)) return { ok: false, error: `Unknown map "${mapId}". Maps: ${maps.join(', ')}` };
  const controlMode = body.controlMode ?? 'clinical';
  if (controlMode !== 'clinical' && controlMode !== 'embodied') return { ok: false, error: 'Unknown control mode.' };
  const camera = controlMode === 'embodied' ? body.camera ?? 'third' : 'third';
  if (camera !== 'third' && camera !== 'first') return { ok: false, error: 'Embodied camera must be third or first.' };
  const agent = body.agent;
  if (controlMode === 'embodied' && agent !== 'claude') return { ok: false, error: 'Embodied mode requires a Claude model.' };
  if (agent !== 'claude' && agent !== 'demo' && agent !== 'codex' && agent !== 'vllm') return { ok: false, error: 'agent must be claude, codex, vllm, or demo' };
  if (agent === 'demo' && mapId !== 'orientation' && mapId !== 'night_shift') return { ok: false, error: 'The scripted walkthrough supports Orientation Day and Night Shift. Choose an AI doctor for this shift.' };
  let model: string | undefined;
  let npc: NpcSelection | undefined;
  let baseUrl: string | undefined;
  try {
    if (body.npc !== undefined) npc = parseNpcSelection(body.npc);
    if (agent === 'codex') model = modelName(body.model) ?? process.env.AGENTCLINIC_CODEX_DOCTOR_MODEL ?? CODEX_DOCTOR_MODEL;
    if (agent === 'vllm') {
      model = modelName(body.model);
      baseUrl = vllmUrl(body.baseUrl ?? process.env.LOCAL_API_URL ?? 'http://127.0.0.1:8000/v1');
    }
  } catch (error) { return { ok: false, error: (error as Error).message }; }
  if (agent === 'claude') {
    const m = body.model ?? 'sonnet';
    if (typeof m !== 'string' || !(OBSERVE_MODELS as readonly string[]).includes(m)) return { ok: false, error: `model must be one of ${OBSERVE_MODELS.join(', ')}` };
    model = m as ObserveModel;
  }
  let seed: number;
  if (body.seed === undefined || body.seed === null || body.seed === '') seed = agent === 'demo' ? 2024 : Math.floor(Math.random() * 1e6);
  else {
    const n = typeof body.seed === 'string' ? Number(body.seed) : body.seed;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 2 ** 31) return { ok: false, error: 'seed must be a non-negative integer' };
    seed = n;
  }
  const pace = body.pace === undefined ? 1.5 : Number(body.pace);
  if (!Number.isFinite(pace) || pace < 0 || pace > 10) return { ok: false, error: 'pace must be 0–10 seconds' };
  // Claude's turn budget (cost control): 250 covers a full shift
  const maxTurns = Number(body.maxTurns ?? (controlMode === 'embodied' ? 60 : 250));
  if (!Number.isInteger(maxTurns) || maxTurns < 5 || maxTurns > 400) return { ok: false, error: 'maxTurns must be an integer 5–400' };
  return { ok: true, controlMode, camera, mapId, agent, model, seed, paceSec: pace, maxTurns, npc, baseUrl };
}

export class ObserveManager {
  private current: Launch | null = null;
  private starting = false;
  private readonly loader: string;

  constructor(private hooks: ObserveHooks) {
    this.loader = pathToFileURL(path.join(hooks.root, 'node_modules', 'tsx', 'dist', 'loader.mjs')).href;
  }

  private log(line: string) {
    (this.hooks.log ?? console.log)(`[observe] ${line}`);
  }

  get running(): ObserveStatus | null {
    return this.current?.status.state === 'running' ? this.current.status : null;
  }

  frame(sessionId: string) {
    return this.current?.status.sessionId === sessionId ? this.current.frame : undefined;
  }

  stream(id: string, res: http.ServerResponse) {
    const l = this.current;
    if (!l || l.status.sessionId !== id || l.status.controlMode !== 'embodied' || l.status.state !== 'running') {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'multipart/x-mixed-replace; boundary=gameframe', 'cache-control': 'no-store' });
    res.write('--gameframe\r\n');
    l.viewers.add(res);
    res.on('close', () => l.viewers.delete(res));
    if (l.frame) this.writeFrame(res, l.frame);
  }

  private writeFrame(res: http.ServerResponse, frame: Buffer) {
    // Skip frames for a slow viewer; other viewers and model decisions carry on.
    if (res.destroyed || res.writableNeedDrain) return;
    res.write('Content-Type: image/jpeg\r\nContent-Length: ' + frame.length + '\r\n\r\n');
    res.write(frame);
    res.write('\r\n--gameframe\r\n');
  }

  status(): HttpReply {
    const c = this.current?.status;
    const online = this.hooks.online?.() ?? true;
    const claude = !online ? { allowed: false, note: OFFLINE_DOCTOR } : this.hooks.claudeOptIn() ? { allowed: true } : { allowed: false, note: CLAUDE_DOCTOR_OPT_IN };
    return { status: 200, body: { running: c?.state === 'running', current: c ?? null, claude, embodiedApi: !!this.hooks.embodiedApi?.(), online } };
  }

  async start(body: Record<string, unknown>): Promise<HttpReply> {
    if (this.starting) return { status: 409, body: { error: 'An AI doctor is starting.' } };
    this.starting = true;
    try { return await this.launch(body); }
    catch (error) { return { status: 503, body: { error: (error as Error).message } }; }
    finally { this.starting = false; }
  }

  private async launch(body: Record<string, unknown>): Promise<HttpReply> {
    const busy = this.running;
    if (busy) return { status: 409, body: { error: 'An AI doctor is already on shift — watch it or stop it first.', sessionId: busy.sessionId, current: busy } };
    const v = validateObserve(body, this.hooks.maps());
    if (!v.ok) return { status: 400, body: { error: v.error } };
    const embodied = v.controlMode === 'embodied';
    // an offline server: no LLM doctor of any kind (embodied is always Claude), only the scripted demo
    if (!(this.hooks.online?.() ?? true) && (v.agent !== 'demo' || embodied)) return { status: 403, body: { error: OFFLINE_DOCTOR } };
    const api = embodied && this.hooks.embodiedApi?.();
    if (v.agent === 'claude' && !api) {
      if (!this.hooks.claudeOptIn() && body.claudeConsent !== true) return { status: 403, body: { error: CLAUDE_DOCTOR_OPT_IN } };
      const ready = await this.hooks.claudeReady();
      if (!ready.ok) return { status: 503, body: { error: ready.detail ?? 'Claude Code is not available.' } };
      const raced = this.current?.status.state === 'running' ? this.current.status : null; // a second launch during the login check
      if (raced) return { status: 409, body: { error: 'An AI doctor is already on shift.', sessionId: raced.sessionId } };
    }
    if (v.agent === 'codex') await codexReady();
    if (v.agent === 'vllm') v.model = await new VllmClient(v.baseUrl).model(v.model);
    const label = v.agent === 'claude' ? LABELS[v.model as ObserveModel] : v.agent === 'demo' ? 'Scripted demo' : `${v.agent === 'codex' ? 'Codex' : 'vLLM'} ${v.model}`;
    // the demo is the free, deterministic baseline: offline NPCs too; Claude plays against the server's NPC brain
    const startedAt = Date.now();
    const driver: EmbodiedRun | undefined = embodied ? {
      token: randomUUID(), observations: { startedAt, count: 0, events: [] }, source: api ? 'api' : 'claude-code', model: v.model as ObserveModel, maxTurns: v.maxTurns, camera: v.camera,
    } : undefined;
    const sessionId = await this.hooks.createSession({ mapId: v.mapId, seed: v.seed, label, model: v.model, paceSec: v.paceSec, offlineNpcs: v.agent === 'demo' && !v.npc, npc: v.npc, embodied: driver });
    const script = path.join(this.hooks.root, 'agents', embodied ? 'embodied-doctor.ts' : v.agent === 'claude' ? 'claude-doctor.ts' : v.agent === 'demo' ? 'demo-agent.ts' : 'model-doctor.ts');
    const args = ['--import', this.loader, script, '--session', sessionId, '--map', v.mapId, '--seed', String(v.seed)];
    if (v.agent !== 'demo') args.push('--model', v.model!, '--max-turns', String(v.maxTurns));
    if (v.agent === 'codex' || v.agent === 'vllm') args.push('--source', v.agent);
    if (v.baseUrl) args.push('--base-url', v.baseUrl);
    const status: ObserveStatus = {
      sessionId,
      agent: v.agent,
      controlMode: v.controlMode,
      model: v.model,
      mapId: v.mapId,
      seed: v.seed,
      paceSec: v.paceSec,
      state: 'running',
      startedAt,
      tail: [],
      logUrl: `/api/runs/${sessionId}/agent-log`,
      runLogUrl: `/api/runs/${sessionId}`,
    };
    const launch: Launch = { status, viewers: new Set(), child: null, logFile: null, logBytes: 0, stopRequested: false, done: false };
    this.current = launch;
    try {
      mkdirSync(this.hooks.runsDir, { recursive: true });
      launch.logFile = createWriteStream(path.join(this.hooks.runsDir, `${sessionId}.agent.log`));
      launch.logFile.on('error', () => (launch.logFile = null));
    } catch {
      launch.logFile = null;
    }
    let child: ChildProcess;
    try {
      child = spawn(process.execPath, args, {
        cwd: this.hooks.root,
        env: { ...childEnv(), AGENTCLINIC_URL: this.hooks.baseUrl, AGENTCLINIC_OBSERVE: '1', ...(driver ? { AGENTCLINIC_RUNS_DIR: this.hooks.runsDir, AGENTCLINIC_DRIVER_TOKEN: driver.token, AGENTCLINIC_VISION_SOURCE: driver.source, AGENTCLINIC_DRIVER_CAMERA: driver.camera } : {}), NO_COLOR: '1' },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        // (its own process group, for killGroup. Not on Windows: a detached process has no console, so every
        // console program below it that is started without windowsHide, as the Codex SDK starts Codex, opens a
        // visible terminal window. Undetached and hidden, the agent has an invisible console that they share.)
        detached: process.platform !== 'win32',
        windowsHide: true,
      });
    } catch (e) {
      this.exited(launch, null, (e as Error).message);
      return { status: 500, body: { error: `Could not start the agent: ${(e as Error).message}` } };
    }
    launch.child = child;
    status.pid = child.pid;
    const onData = (d: Buffer) => this.output(launch, d);
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('error', (e) => this.exited(launch, null, e.message));
    child.on('exit', (code, signal) => this.exited(launch, code, signal && !launch.stopRequested ? `killed by ${signal}` : undefined));
    if (driver) child.on('message', (message: { frame?: string; usage?: unknown; event?: EmbodiedEvent }) => {
      if (typeof message.frame === 'string' && !launch.done) {
        launch.frame = Buffer.from(message.frame, 'base64');
        for (const viewer of launch.viewers) this.writeFrame(viewer, launch.frame);
        return;
      }
      const e = message.event;
      if (e) {
        status.eventCount = driver.observations.events.push(e);
        if (e.kind === 'observation') {
          driver.observations.count = e.observation;
          status.lastObservation = { number: e.observation, at: e.at };
        } else if (e.kind === 'decision') status.decision = e;
        this.hooks.observationChanged?.(sessionId);
      }
      const report = sanitizeAgentReport(message.usage);
      if (report) this.hooks.reportUsage?.(sessionId, report);
    });
    const account = process.env.ANTHROPIC_API_KEY ? 'your Claude Code CLI, billed to your ANTHROPIC_API_KEY' : 'your own Claude Code login (your personal opt-in; plan usage, no per-token bill)';
    this.hooks.note(sessionId, embodied ? 'The embodied doctor is opening the game browser.' : v.agent === 'claude' ? `${label} is joining the shift — it runs on ${account}.` : v.agent === 'demo' ? 'The scripted demo resident is joining the shift.' : `${label} is joining the shift. NPC dialogue uses its separate selection.`, 'info');
    this.log(`${label} (pid ${child.pid}) → session ${sessionId} map=${v.mapId} seed=${v.seed} pace=${v.paceSec}s`);
    return { status: 201, body: { sessionId, spectateUrl: `/?${embodied ? 'embodied' : 'spectate'}=${sessionId}`, controlMode: v.controlMode, agent: v.agent, model: v.model ?? null, mapId: v.mapId, seed: v.seed, paceSec: v.paceSec, label } };
  }

  stop(reason = 'Stopped by the spectator'): HttpReply {
    const l = this.current;
    if (!l || l.status.state !== 'running') return { status: 404, body: { error: 'No AI doctor is running.' } };
    l.stopRequested = true;
    l.status.state = 'stopped';
    l.status.endedAt = Date.now();
    killGroup(l.child, 'SIGTERM');
    const child = l.child;
    setTimeout(() => {
      if (child && child.exitCode === null && child.signalCode === null) killGroup(child, 'SIGKILL');
    }, 3000).unref();
    this.hooks.note(l.status.sessionId, `${reason}.`, 'warn');
    this.hooks.endSession(l.status.sessionId, reason);
    this.log(`stopped session ${l.status.sessionId}`);
    return { status: 200, body: { ok: true, sessionId: l.status.sessionId } };
  }

  private output(l: Launch, d: Buffer) {
    if (l.logFile && l.logBytes < MAX_LOG_BYTES) {
      l.logBytes += d.length;
      l.logFile.write(d);
    }
    const lines = d.toString('utf8').split('\n').map((x) => x.trimEnd()).filter(Boolean);
    l.status.tail.push(...lines.map((x) => (x.length > 300 ? x.slice(0, 299) + '…' : x)));
    if (l.status.tail.length > TAIL_LINES) l.status.tail.splice(0, l.status.tail.length - TAIL_LINES);
  }

  private exited(l: Launch, code: number | null, error?: string) {
    if (l.done) return; // 'error' and 'exit' can both fire
    l.done = true;
    for (const viewer of l.viewers) viewer.end();
    l.viewers.clear();
    const sid = l.status.sessionId;
    l.status.exitCode = code;
    if (!l.status.endedAt) l.status.endedAt = Date.now();
    if (!l.stopRequested) {
      l.status.state = code === 0 && !error ? 'finished' : 'failed';
      if (error) l.status.error = error;
      else if (code !== 0) l.status.error = l.status.tail.slice(-3).join(' · ') || `exit code ${code}`;
      if (l.status.state === 'failed') this.hooks.note(sid, `The AI doctor stopped unexpectedly (${l.status.error}).`, 'bad');
      this.hooks.endSession(sid, 'The AI doctor went off shift');
    }
    // stragglers in the group (an MCP server whose parent is gone)
    if (l.child?.pid) killGroup(l.child, 'SIGTERM');
    l.logFile?.end();
    l.logFile = null;
    this.log(`session ${sid}: agent ${l.status.state}${code !== null ? ` (exit ${code})` : ''}${l.status.error ? ` — ${l.status.error}` : ''}`);
  }

  /** server shutdown: synchronous, safe inside process.on('exit') */
  dispose() {
    const l = this.current;
    if (!l?.child) return;
    l.stopRequested = true;
    killGroup(l.child, 'SIGTERM');
  }

  async handle(req: http.IncomingMessage): Promise<HttpReply> {
    if (req.method === 'GET') return this.status();
    if (req.method !== 'POST' && req.method !== 'DELETE') return { status: 405, body: { error: 'Use GET, POST or DELETE.' } };
    // it runs on this machine's Claude login: only this machine may start or stop one (also in LAN mode)
    if (!isLoopback(req.socket.remoteAddress)) return { status: 403, body: { error: 'Only this computer can start or stop an AI doctor (it runs on your Claude login). Others can watch with the spectate link.' } };
    if (req.method === 'DELETE') {
      const target = new URL(req.url ?? '/', 'http://localhost').searchParams.get('session');
      if (target && this.running?.sessionId !== target) return { status: 409, body: { error: 'This shift is no longer running.' } };
      return this.stop();
    }
    const b = await readJsonCapped(req, 4096);
    if (b === 'too_large') return { status: 413, body: { error: 'Body too large.' } };
    if (!b) return { status: 400, body: { error: 'Body must be JSON: {mapId, seed?, agent, model?}' } };
    return this.start(b);
  }
}

/** GET /api/runs/:id[/agent-log] — saved run logs (the debrief is already public by then) */
export function readRunFile(runsDir: string, sessionId: string, which: 'run' | 'agent-log'): { status: number; type: string; body: string } {
  if (!SESSION_ID.test(sessionId)) return { status: 400, type: 'application/json', body: JSON.stringify({ error: 'Bad session id' }) };
  const file = path.join(runsDir, which === 'run' ? `${sessionId}.json` : `${sessionId}.agent.log`);
  if (!existsSync(file)) return { status: 404, type: 'application/json', body: JSON.stringify({ error: which === 'run' ? 'No run log yet — it is written when the shift ends.' : 'No agent log for this session.' }) };
  return { status: 200, type: which === 'run' ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', body: readFileSync(file, 'utf8') };
}
