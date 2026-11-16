import type {
  Action, ActionResult, ChatLine, ClientMsg, ConversationView, GameSettings, LlmStatus,
  PatientChart, PlayerView, ServerMsg, SpeechVoice,
} from '../../../shared/types';
import { mockView } from '../dev/mock';
import { TOUR_MONITORS, TOUR_PAGES, TOUR_START, tourCharts } from './charts';
import { demoReply } from './dialogue';
import { VOICE_CAST } from '../../../shared/voiceCast';
import { EXAM_BY_ID } from '../../../shared/catalog';
import { kellerExam, brunnerExam, okaforExam } from '../../../shared/tourExams';

const voices: Readonly<Record<string, SpeechVoice | undefined>> = VOICE_CAST;
const findings: Record<string, Record<string, string>> = {
  p_keller: kellerExam,
  p_brunner: { ...brunnerExam, neuro_gcs: 'GCS 14 (E4 V4 M6) — confused speech.' },
  p_okafor: okaforExam,
};

const llm: LlmStatus = { provider: 'offline', label: 'Scripted conversations', ok: true };

/** A tour uses the same public messages as a shift. Its entire state belongs to this tab. */
export class DemoTransport {
  private view?: PlayerView;
  private charts: Record<string, PatientChart> = {};
  private timer?: ReturnType<typeof setInterval>;
  private visit = 0;
  private line = 0;

  constructor(private emit: (msg: ServerMsg) => void) {}

  connect() {
    this.emit({ type: 'welcome', version: 'browser-demo', llm, maps: [], tts: 'browser' });
  }

  private update(patch: Partial<PlayerView>) {
    if (!this.view) return;
    this.view = { ...this.view, ...patch };
    this.emit({ type: 'state', view: this.view });
  }

  private start(playerName: string, settings?: Partial<GameSettings>) {
    this.stop();
    // the patients as they are at 22:20, when the tour opens (charts.ts)
    this.charts = tourCharts();
    const view = mockView(this.charts);
    this.view = {
      ...view, sessionId: `browser-demo-${++this.visit}`, mapId: 'browser_demo', mapTitle: 'Night shift', t: TOUR_START,
      settings: { ...view.settings, timeScale: 1, focusSlowdown: false, tts: true, ...settings }, player: { name: playerName, location: 'hub' },
      conversations: [], pages: TOUR_PAGES.map(p => ({ ...p })), monitors: TOUR_MONITORS, examFindings: {}, llm,
      board: view.board.map(row => ({ ...row, critical: false, newResults: 0 })),
      npcs: view.npcs.map(npc => {
        if (npc.id === 'tech_marcus') {
          // Just inside interaction range, facing the arriving player at the ED's usual spawn.
          return { ...npc, posture: 'stand', ambient: { crowd: false, at: { x: 12.95, z: 11.4, rot: -1.10 } } };
        }
        // The 3D world casts each patient from the full game's actor ID.
        if (npc.id === 'pt_keller') return { ...npc, id: 'pt_p_keller', bedPosition: { headDeg: 45 } };
        if (npc.id === 'pt_brunner') return { ...npc, id: 'pt_p_brunner', bedPosition: { headDeg: 35 } };
        if (npc.id === 'pt_okafor') return { ...npc, id: 'pt_p_okafor', bedPosition: { headDeg: 30, sitting: 'edge' } };
        if (npc.role === 'visitor' || npc.role === 'clerk') return { ...npc, talkable: true, offRecord: true, bark: undefined };
        return npc;
      }),
    };
    this.emit({ type: 'state', view: this.view });
    // Prefill the handheld tablet too, which can be opened away from a workstation.
    for (const chart of Object.values(this.charts)) this.emit({ type: 'chart', chart });
    this.timer = setInterval(() => {
      const v = this.view;
      if (v && !v.settings.paused) this.update({ t: v.t + v.settings.timeScale });
    }, 1000);
  }

  private stop() {
    clearInterval(this.timer);
    this.view = undefined;
    this.charts = {};
    this.line = 0;
  }

  send(msg: ClientMsg) {
    const v = this.view;
    switch (msg.type) {
      case 'start': this.start(msg.playerName, msg.settings); break;
      case 'leave_solo': this.stop(); break;
      case 'settings': if (v) this.update({ settings: { ...v.settings, ...msg.settings } }); break;
      case 'focus': if (v && v.player.focus !== msg.focus) this.update({ player: { ...v.player, focus: msg.focus } }); break;
      case 'chart': {
        const chart = this.charts[msg.patientId];
        if (chart) this.emit({ type: 'chart', chart });
        break;
      }
      case 'action': {
        const result = v ? this.act(v, msg.action) : { ok: false, message: 'Enter the department to begin the tour.' };
        this.emit({ type: 'actionResult', reqId: msg.reqId, result });
        break;
      }
      case 'aside':
        if (v) this.emit({ type: 'event', event: { kind: 'speech', npcId: msg.npcId, voice: voices[msg.npcId], name: v.npcs.find(n => n.id === msg.npcId)?.name ?? 'Staff', text: msg.text } });
        break;
    }
  }

  private act(v: PlayerView, action: Action): ActionResult {
    switch (action.type) {
      case 'talk':
      case 'call':
      case 'hangup':
        return this.converse(v, action);
      case 'move':
        this.update({ player: { ...v.player, location: action.to } });
        break;
      case 'hygiene': {
        const gear = { mask_on: { masked: true }, mask_off: { masked: false }, gloves_on: { gloved: true }, gloves_off: { gloved: false } };
        if (action.kind !== 'rub' && action.kind !== 'wash') this.update({ player: { ...v.player, ...gear[action.kind] } });
        break;
      }
      case 'ehr_view':
        if (!this.charts[action.patientId]) return { ok: false, message: 'Chart unavailable.' };
        break;
      case 'ack_page':
        if (!v.pages.some(p => p.id === action.pageId)) return { ok: false, message: 'Page not found.' };
        this.update({ pages: v.pages.map(p => p.id === action.pageId ? { ...p, read: true } : p) });
        break;
      case 'sign_ecg': {
        const chart = Object.values(this.charts).find(c => c.ecgs.some(e => e.id === action.ecgId));
        const ecg = chart?.ecgs.find(e => e.id === action.ecgId);
        if (!chart || !ecg) return { ok: false, message: 'ECG not found.' };
        if (ecg.signedAt !== undefined) return { ok: false, message: 'ECG already signed.' };
        const physicianRead = action.interpretation.trim();
        if (!physicianRead) return { ok: false, message: 'Enter an interpretation first.' };
        const version = chart.version + 1;
        this.charts[chart.id] = { ...chart, version, ecgs: chart.ecgs.map(e => e.id === ecg.id ? { ...e, signedAt: v.t, physicianRead } : e) };
        this.update({ chartVersions: { ...v.chartVersions, [chart.id]: version } });
        return { ok: true, message: 'ECG signed.' };
      }
      case 'mark_read': {
        const chart = this.charts[action.patientId];
        if (!chart) return { ok: false, message: 'Chart unavailable.' };
        if (chart.notes.some(note => note.unread)) {
          const version = chart.version + 1;
          this.charts[chart.id] = { ...chart, version, notes: chart.notes.map(note => ({ ...note, unread: false })) };
          this.update({ chartVersions: { ...v.chartVersions, [chart.id]: version } });
        }
        break;
      }
      case 'wait':
        this.update({ t: v.t + action.minutes * 60 });
        break;
      case 'examine': {
        const pid = action.patientId;
        const chart = this.charts[pid];
        const maneuver = EXAM_BY_ID[action.maneuver];
        if (!chart || !maneuver) return { ok: false, message: 'Patient or maneuver unavailable.' };
        const result = findings[pid]?.[maneuver.id] ?? maneuver.normal;
        const text = maneuver.chaperone ? `(Chaperoned by ${chart.assignedNurse}) ${result}` : result;
        const finding = { maneuver: maneuver.id, label: maneuver.label, system: maneuver.system, text, t: v.t };
        this.update({ examFindings: { ...v.examFindings, [pid]: [...(v.examFindings[pid] ?? []), finding] } });
        return { ok: true, text };
      }
      // the rules of GameSession.setDiagnoses and .disposition (server/sim/session.ts), for a tour patient
      // who never leaves: up to 10 diagnoses as entered; a disposition can be changed until it is a
      // discharge, which is final
      case 'set_diagnoses':
      case 'disposition': {
        const chart = this.charts[action.patientId];
        if (!chart) return { ok: false, message: 'Patient unavailable.' };
        const entered = action.diagnoses.map(d => d.trim()).filter(Boolean).slice(0, 10);
        const diagnoses = action.type === 'set_diagnoses' || entered.length ? entered : chart.diagnoses;
        let disposition = chart.disposition;
        if (action.type === 'disposition') {
          if (disposition?.decision === 'discharge') {
            return action.decision === 'discharge' ? { ok: true, message: 'Discharge has already been signed.' } : { ok: false, message: 'The signed discharge is final for this encounter.' };
          }
          if (disposition && action.decision === 'discharge') return { ok: false, message: 'A disposition is already recorded for this encounter.' };
          disposition = { decision: action.decision, service: action.service, instructions: action.instructions, diagnoses, t: v.t };
        }
        const changed = { ...chart, diagnoses, disposition, version: chart.version + 1 };
        this.charts[chart.id] = changed;
        this.update({ chartVersions: { ...v.chartVersions, [chart.id]: changed.version },
          board: v.board.map(row => row.id === chart.id ? { ...row, dispo: disposition?.decision } : row) });
        return { ok: true, message: action.type === 'disposition' ? 'Disposition recorded in the tour chart.' : 'Working diagnoses updated.' };
      }
      default:
        return { ok: false, message: 'This action is available in the downloadable game.' };
    }
    return { ok: true };
  }

  private converse(v: PlayerView, action: Extract<Action, { type: 'talk' | 'call' | 'hangup' }>): ActionResult {
    const person = action.type === 'talk'
      ? v.npcs.find(n => n.id === action.npcId && n.visible && n.talkable)
      : v.contacts.find(c => c.id === action.contactId);
    if (!person) return { ok: false, message: 'Nobody is available here.' };

    const who = action.type === 'talk' ? { npcId: person.id } : { contactId: person.id };
    const key = action.type === 'talk' ? person.id : `phone:${person.id}`;
    const previous = v.conversations.find(c => c.key === key);
    const lines = [...(previous?.lines ?? [])];
    const append = (speaker: ChatLine['speaker'], name: string, text: string) => {
      const line = { id: String(++this.line), t: v.t, speaker, name, text };
      lines.push(line);
      return line;
    };
    let reply: ChatLine | undefined;
    if (action.type === 'hangup') {
      append('system', 'Phone', 'Call ended.');
    } else {
      const text = action.text.trim();
      if (!text) return { ok: false, message: 'Type a message or choose a question.' };
      const dial = action.type === 'call' && text === '__dial__';
      if (!dial) append('player', v.player.name, text);
      reply = append('npc', person.name, demoReply(person.id, text, lines));
    }
    const thread: ConversationView = { key, ...who, title: person.name, typing: false, lines };
    this.update({ conversations: [...v.conversations.filter(c => c.key !== key), thread] });
    if (reply) this.emit({ type: 'event', event: { kind: 'speech', lineId: reply.id, ...who, voice: voices[person.id], name: reply.name, text: reply.text } });
    return { ok: true, text: reply?.text };
  }
}
