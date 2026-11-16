/**
 * MCP server: exposes an AgentClinic shift as tools, so any MCP client (Claude Code,
 * Claude Desktop, custom agents) can play the doctor with the SAME action space as
 * human players.
 *
 *   claude mcp add agentclinic -- npx tsx /path/to/agent-clinic-game/agents/mcp-server.ts
 *
 * Talks to a running game server (AGENTCLINIC_URL, default http://127.0.0.1:5317) so
 * humans can spectate in 3D; if none is running it embeds the simulation in-process.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { LAYOUTS } from '../shared/layout';
import type { Action, Debrief, MapSummary } from '../shared/types';
import { AgentClinicClient } from './client';

interface Backend {
  kind: 'http' | 'embedded';
  maps(): Promise<MapSummary[]>;
  start(map: string, seed?: number, name?: string): Promise<{ sessionId: string; observation: string; contacts?: string; spectateUrl?: string }>;
  act(action: Action): Promise<{ text: string; observation: string; ended: boolean }>;
  observe(): Promise<string>;
  debrief(): Promise<Debrief>;
  catalog(): Promise<string>;
}

class HttpBackend implements Backend {
  kind = 'http' as const;
  private sid = '';
  constructor(private api: AgentClinicClient) {}
  maps() {
    return this.api.maps();
  }
  async start(map: string, seed?: number, name?: string) {
    // observe mode: the game server already created this agent's shift (AGENTCLINIC_SESSION) — join it
    const join = process.env.AGENTCLINIC_SESSION;
    if (join) {
      const [o, contacts] = await Promise.all([this.api.observe(join), this.api.contacts(join)]);
      this.sid = join;
      return { sessionId: join, observation: o.observation, contacts, spectateUrl: `${this.api.baseUrl}/?spectate=${join}` };
    }
    // AGENTCLINIC_PACE: seconds between actions so humans can follow along in 3D (claude-doctor --pace)
    const pace = Number(process.env.AGENTCLINIC_PACE);
    const r = await this.api.start(map, { seed, playerName: name ?? 'Claude (MCP)', pace: pace > 0 ? pace : undefined, model: process.env.AGENTCLINIC_MODEL || undefined });
    this.sid = r.sessionId;
    return r;
  }
  private need() {
    if (!this.sid) throw new Error('No shift running — call start_shift first.');
    return this.sid;
  }
  async act(action: Action) {
    const r = await this.api.act(this.need(), action);
    const res = r.result;
    return { text: `${res.ok ? 'OK' : 'FAILED'}: ${res.text ?? res.message ?? ''}`.trim(), observation: r.observation, ended: r.ended };
  }
  async observe() {
    return (await this.api.observe(this.need())).observation;
  }
  debrief() {
    return this.api.debrief(this.need());
  }
  catalog() {
    return this.api.catalog();
  }
}

class EmbeddedBackend implements Backend {
  kind = 'embedded' as const;
  async maps() {
    return (await import('../server/sim/shiftRoster')).mapSummaries;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private s: any = null;
  private mods: Promise<{
    GameSession: typeof import('../server/sim/session').GameSession;
    NpcBrain: typeof import('../server/npc/brain').NpcBrain;
    detectProvider: typeof import('../server/llm/provider').detectProvider;
    observationText: typeof import('../server/sim/agentText').observationText;
    contactsText: typeof import('../server/sim/agentText').contactsText;
    catalogText: typeof import('../server/sim/agentText').catalogText;
    debrief: typeof import('../server/sim/scoring').debrief;
  }>;
  private brain: Promise<import('../server/npc/brain').NpcBrain>;
  constructor() {
    this.mods = Promise.all([import('../server/sim/session'), import('../server/npc/brain'), import('../server/llm/provider'), import('../server/sim/agentText'), import('../server/sim/scoring')]).then(([a, b, c, d, e]) => ({
      GameSession: a.GameSession,
      NpcBrain: b.NpcBrain,
      detectProvider: c.detectProvider,
      observationText: d.observationText,
      contactsText: d.contactsText,
      catalogText: d.catalogText,
      debrief: e.debrief,
    }));
    this.brain = this.mods.then(async (m) => new m.NpcBrain(await m.detectProvider(process.env.NPC_LLM)));
  }
  async start(map: string, seed?: number, name?: string) {
    const m = await this.mods;
    this.s = new m.GameSession({ scenarioId: map, seed, playerName: name ?? 'Claude (MCP)', mode: 'step', brain: await this.brain });
    return { sessionId: this.s.id, observation: m.observationText(this.s), contacts: m.contactsText(this.s) };
  }
  async act(action: Action) {
    if (!this.s) throw new Error('No shift running — call start_shift first.');
    const m = await this.mods;
    const r = await this.s.act(action);
    return { text: `${r.ok ? 'OK' : 'FAILED'}: ${r.text ?? r.message ?? ''}`.trim(), observation: m.observationText(this.s), ended: this.s.ended };
  }
  async observe() {
    if (!this.s) throw new Error('No shift running — call start_shift first.');
    return (await this.mods).observationText(this.s);
  }
  async debrief() {
    return (await this.mods).debrief(this.s);
  }
  async catalog() {
    return (await this.mods).catalogText();
  }
}

let backend: Backend | null = null;
async function getBackend(): Promise<Backend> {
  if (backend) return backend;
  const api = new AgentClinicClient();
  try {
    await api.health();
    backend = new HttpBackend(api);
  } catch {
    backend = new EmbeddedBackend();
  }
  return backend;
}

const server = new McpServer({ name: 'agentclinic', version: '0.3.0' });
const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });
const withObs = (r: { text: string; observation: string; ended: boolean }, full = false) =>
  text(`${r.text}\n\n${full ? r.observation : r.observation.split('\n\n').filter((b) => !b.startsWith('Staff elsewhere')).join('\n\n')}${r.ended ? '\n\nTHE SHIFT HAS ENDED — call end_shift for the debrief.' : ''}`);
const run = async (action: Action) => withObs(await (await getBackend()).act(action));

server.registerTool('list_shifts', {
  title: 'List shifts and practice cases',
  description: 'Find a shift or an individual patient by presenting complaint or specialty. Pass the returned map ID to start_shift.',
  inputSchema: { query: z.string().optional() },
}, async ({ query }) => {
  const term = query?.trim().toLowerCase() ?? '';
  const maps = (await (await getBackend()).maps()).filter(m => `${m.title} ${m.specialty ?? ''}`.toLowerCase().includes(term));
  return text(maps.map(m => `${m.id} | ${m.title} | ${m.specialty ?? 'shift'} | ${m.difficulty} | ${m.patients} patient(s)`).join('\n') || 'No matching shifts.');
});

server.registerTool(
  'start_shift',
  {
    title: 'Start a shift',
    description: 'Start an ED shift as the resident physician. Choose a map from list_shifts, including mixed_shift, mixed_roster or an individual practice case. The same seed reproduces the shift.',
    inputSchema: { map: z.string().default('night_shift'), seed: z.number().int().optional(), player_name: z.string().optional() },
  },
  async ({ map, seed, player_name }) => {
    const b = await getBackend();
    const r = await b.start(map, seed, player_name);
    return text(`Shift started (session ${r.sessionId}, backend ${b.kind}).${r.spectateUrl ? `\nHumans can watch you in 3D: ${r.spectateUrl}` : ''}\n\nPHONE DIRECTORY:\n${r.contacts ?? ''}\n\n${r.observation}`);
  },
);

server.registerTool('observe', { title: 'Observe', description: 'Current time, location, tracking board, people here, unread pages, recent conversation.' }, async () => text(await (await getBackend()).observe()));

server.registerTool('catalog', { title: 'Order & exam catalog', description: 'All orderable codes (labs, imaging, meds with dose options, nursing, consults) and exam maneuver ids.' }, async () => text(await (await getBackend()).catalog()));

server.registerTool(
  'move',
  { title: 'Walk somewhere', description: `Walk to a location (room id): ${LAYOUTS.ed.rooms.map((r) => r.id).join(', ')}. Costs walking time. Talking/examining requires being in the same room; orders/chart need a workstation (station, workroom, triage); phone calls need station or workroom.`, inputSchema: { to: z.string() } },
  async ({ to }) => run({ type: 'move', to }),
);

server.registerTool(
  'talk',
  { title: 'Talk to someone', description: 'Say something to a person in the same room (npc ids appear in observations, e.g. pt_p_keller, fam_linda, rn_tom, att_shaw). Speak naturally; you can give verbal orders to nurses ("Tom, 324 mg aspirin chewed for Bed 2").', inputSchema: { npc_id: z.string(), text: z.string() } },
  async ({ npc_id, text: t }) => run({ type: 'talk', npcId: npc_id, text: t }),
);

server.registerTool(
  'examine',
  { title: 'Examine', description: 'Perform one exam maneuver on a patient at the bedside (ids from catalog, e.g. cv_auscultate, abd_mcburney, msk_lat_malleolus, neck_jvp). Bedside ultrasound views are maneuvers too: pocus_ruq, pocus_luq, pocus_pelvic, pocus_cardiac (FAST), pocus_aorta, pocus_rlq, pocus_bladder, pocus_ivc, pocus_lung.', inputSchema: { patient_id: z.string(), maneuver: z.string() } },
  async ({ patient_id, maneuver }) => run({ type: 'examine', patientId: patient_id, maneuver }),
);

server.registerTool(
  'order',
  {
    title: 'Place an order',
    description: 'Place an order in the EHR (requires a workstation). Codes from catalog, e.g. lactate, bcx, cbc, ct_abd_iv, ecg12, meropenem (dose "1 g"), lr_bolus (dose "30 mL/kg"), consult_cardiology.',
    inputSchema: { patient_id: z.string(), code: z.string(), dose: z.string().optional(), route: z.string().optional(), frequency: z.string().optional(), priority: z.enum(['STAT', 'Routine']).optional() },
  },
  async ({ patient_id, code, dose, route, frequency, priority }) => run({ type: 'order', patientId: patient_id, code, params: dose || route || frequency ? { dose, route, frequency } : undefined, priority }),
);

server.registerTool('cancel_order', { title: 'Cancel an order', description: 'Cancel an order by id (from read_chart section "orders").', inputSchema: { order_id: z.string() } }, async ({ order_id }) => run({ type: 'cancel_order', orderId: order_id }));

server.registerTool(
  'read_chart',
  { title: 'Read the chart', description: 'Read a chart section at a workstation: summary, vitals, labs (query filters analytes, e.g. "lact"), imaging, ecg, orders, mar, notes, history, board.', inputSchema: { patient_id: z.string(), section: z.enum(['summary', 'vitals', 'labs', 'imaging', 'ecg', 'orders', 'mar', 'notes', 'history', 'board']), query: z.string().optional() } },
  async ({ patient_id, section, query }) => {
    const r = await (await getBackend()).act({ type: 'ehr_view', patientId: patient_id, section, query });
    return text(r.text);
  },
);

server.registerTool('sign_ecg', { title: 'Sign an ECG', description: 'Sign an ECG with your interpretation (ECG ids in read_chart section "ecg").', inputSchema: { ecg_id: z.string(), interpretation: z.string() } }, async ({ ecg_id, interpretation }) => run({ type: 'sign_ecg', ecgId: ecg_id, interpretation }));

server.registerTool(
  'call',
  { title: 'Phone call', description: 'Speak on the phone (station or workroom). Contacts: cards, surg, hosp, icu, ortho, obgyn, lab, radiology, pharm, plus patient-specific lines (GP offices, family, insurers — see start_shift directory), and "attending" (your attending, from anywhere) once you escalated a patient by phone. The first message dials.', inputSchema: { contact_id: z.string(), text: z.string(), patient_id: z.string().optional() } },
  async ({ contact_id, text: t, patient_id }) => run({ type: 'call', contactId: contact_id, text: t, patientId: patient_id }),
);

server.registerTool(
  'escalate',
  {
    title: 'Escalate to the attending',
    description:
      'Ask your supervising attending (Dr. Shaw, npc att_shaw) for help with a patient: any time, from anywhere, 0.5 min; it does not cost points. mode "bedside": she drops what she is doing and walks to the patient (about 1–2 min; "wait" if needed), then talk to her there (talk npc_id att_shaw); she stays while the patient is unstable. mode "call": her phone line opens and she picks up; answer with call(contact_id="attending"). Unstable patient (SBP < 90 or MAP < 65, SpO₂ < 90 %, falling GCS, critical page)? She gives direct stabilization steps first, teaching after. Give a one-line reason.',
    inputSchema: { patient_id: z.string(), mode: z.enum(['bedside', 'call']).default('bedside'), reason: z.string().optional() },
  },
  async ({ patient_id, mode, reason }) => run({ type: 'escalate', patientId: patient_id, mode, reason }),
);

server.registerTool('set_diagnoses', { title: 'Working diagnoses', description: 'Set the working diagnosis list for a patient (most likely first).', inputSchema: { patient_id: z.string(), diagnoses: z.array(z.string()) } }, async ({ patient_id, diagnoses }) => run({ type: 'set_diagnoses', patientId: patient_id, diagnoses }));

server.registerTool(
  'disposition',
  {
    title: 'Disposition',
    description: 'Decide where the patient goes. Admissions/OR/cath lab need an accepting team (call them). decision: discharge | observation | admit_floor | admit_telemetry | admit_stepdown | admit_icu | or | cath_lab | transfer | ama.',
    inputSchema: { patient_id: z.string(), decision: z.enum(['discharge', 'observation', 'admit_floor', 'admit_telemetry', 'admit_stepdown', 'admit_icu', 'or', 'cath_lab', 'transfer', 'ama']), diagnoses: z.array(z.string()), service: z.string().optional(), instructions: z.string().optional(), wheelchair: z.boolean().optional().describe('Request a wheelchair escort when discharging home.') },
  },
  async ({ patient_id, decision, diagnoses, service, instructions, wheelchair }) => run({ type: 'disposition', patientId: patient_id, decision, diagnoses, service, instructions, wheelchair }),
);

server.registerTool(
  'inspect',
  {
    title: 'Inspect belongings',
    description: "Pick up and look at a patient's belongings or documents at the bedside (meds EMS brought from home, a letter, a bag). You must be in that bay; itemIds are listed under 'Belongings you can inspect here' in observe.",
    inputSchema: { item_id: z.string() },
  },
  async ({ item_id }) => run({ type: 'inspect', itemId: item_id }),
);

server.registerTool(
  'give_item',
  {
    title: 'Hand a belonging back',
    description: "Hand a patient's belonging back to them (a confused patient asking for her handbag): it lies beside them in bed from now on. You must be in that bay; itemIds are listed under 'Belongings you can inspect here' in observe. Not scored.",
    inputSchema: { item_id: z.string() },
  },
  async ({ item_id }) => run({ type: 'give_item', itemId: item_id }),
);

server.registerTool('wait', { title: 'Wait', description: 'Let time pass (1–120 game minutes), e.g. while labs run.', inputSchema: { minutes: z.number().min(1).max(120) } }, async ({ minutes }) => run({ type: 'wait', minutes }));

server.registerTool('add_roster_patient', { title: 'Add Full Roster patient', description: 'Full Roster testing only. Room the next patient immediately in a free treatment space.' }, async () => run({ type: 'add_roster_patient' }));
server.registerTool('end_shift', { title: 'End shift and get debrief', description: 'End the shift and receive the scored debrief.' }, async () => {
  const b = await getBackend();
  try {
    await b.act({ type: 'end_shift' });
  } catch {
    /* already ended */
  }
  const d = await b.debrief();
  const lines = [`DEBRIEF ${d.mapTitle}: ${d.score}/${d.maxScore} (${d.percent}%, grade ${d.grade}); resources $${d.costUSD}`];
  for (const c of d.cases) {
    lines.push(`\n## ${c.bedLabel} ${c.name}: ${c.score}/${c.maxScore} — true dx: ${c.trueDiagnosis}; your dx: ${c.yourDiagnoses.join('; ') || '—'} (${c.dxVerdict}); dispo ${c.disposition ?? 'none'} (${c.dispoCorrect ? 'correct' : 'not optimal'})`);
    for (const it of c.items) lines.push(`  ${it.points < 0 ? '−' : it.ok ? '✓' : '✗'} ${it.label} ${it.points}${it.max ? '/' + it.max : ''}${it.detail ? ` — ${it.detail}` : ''}`);
    lines.push(`  Teaching: ${c.teaching.join(' | ')}`);
  }
  for (const e of d.safetyEvents) lines.push(`\nSafety: ${e.caught ? 'CAUGHT' : 'MISSED'} — ${e.label}: ${e.detail}`);
  for (const e of d.escalations ?? []) {
    const v = e.vitals;
    lines.push(`\nEscalated (${e.mode}) +${Math.round(e.t / 60)} min — ${e.bedLabel} ${e.name}: HR ${v.hr}, BP ${v.sbp}/${v.dbp}, SpO₂ ${v.spo2}%, GCS ${v.gcs}; ${e.unstable ? `unstable (${e.why.join('; ')})` : 'stable'}${e.reason ? ` — "${e.reason}"` : ''} (not scored)`);
  }
  return text(lines.join('\n'));
});

server.registerPrompt('play_shift', { title: 'Play an ED shift', description: 'Instructions for an AI resident physician.' }, () => ({
  messages: [
    {
      role: 'user',
      content: {
        type: 'text',
        text: 'You are the emergency-medicine resident on shift at AgentClinic General. Call start_shift, then work the board like a real ED physician: prioritize by acuity, take focused histories (patients only know symptoms; family/GP offices know more), examine, order in the EHR at a workstation, read results, sign ECGs, call consultants/admitting teams, set diagnoses and dispositions for every patient, and watch for staff errors (incomplete vitals, cultures vs antibiotics timing, look-alike names). Escalate to your attending (escalate) when a patient is unstable or beyond you: to the bedside, or by phone. Avoid low-value tests. When everyone is dispositioned (or time is nearly up), call end_shift and summarize what you learned from the debrief.',
      },
    },
  ],
}));

await server.connect(new StdioServerTransport());
// leave with the client: a stopped AI doctor (observe mode) must not leave this process behind
process.stdin.on('close', () => process.exit(0));
