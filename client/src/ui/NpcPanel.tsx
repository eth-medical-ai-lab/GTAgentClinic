import { useEffect, useMemo, useRef, useState } from 'react';
import { EXAM_MANEUVERS } from '../../../shared/catalog';
import { clockAt, dischargeStatus, DISPO_LABELS, type ConversationView, type EscalationMode, type NpcView, type PlayerView } from '../../../shared/types';
import { formatBP, formatVitalsLine } from '../../../shared/units';
import { nextRadioClue, RADIO_PIN } from '../../../shared/nightRadio';
import { client } from '../net';
import { store, useStore } from '../store';
import { ChatInput, Transcript } from './Chat';
import { browserDemo, touchTour } from '../demo/mode';
import { demoQuestions } from '../demo/dialogue';
import { useDockPull, useTuck } from './tuck';

const QUICK: Record<string, string[]> = {
  patient: ["Hi, I'm the resident doctor. What brings you in today?", 'When did this start, and what were you doing?', 'Can you describe the pain? Does it go anywhere?', 'Any medical problems?', 'What medications do you take — including anything occasional?', 'Any allergies?', 'Do you smoke, drink or use drugs?'],
  family: ['How is she normally — before this started?', 'What medications does she take?', 'Any allergies you know of?', 'Has anything like this happened before?', 'Could you give us a moment of privacy?'],
  nurse: ['Can you get a full set of vitals including temperature?', 'Please put them on the monitor and get IV access.', 'Draw blood cultures before the antibiotics, please.', "What's the latest on your patients?"],
  tech: ['Can you get a 12-lead ECG, please?', 'Can you get a right-sided ECG?'],
  attending: ['Can I present a patient?', "I'm worried about Bed 4 — can I run it by you?", 'What would you do next here?'],
};

/** off the record (NpcView.offRecord): the waiting room, registration, security, the cafeteria… */
const SMALL_TALK = {
  public: ['Hi — how are you doing?', 'What brings you in?', 'How long have you been waiting?', 'Where are the restrooms?'],
  staff: ['Hi — how is your shift going?', 'What do you do here?', 'How busy is it?', 'Where can I get a coffee?'],
};

/** beyond this distance (m) you can't talk to someone; examining needs you at the bedside */
const EARSHOT_M = 4.2;
const EXAM_REACH_M = 2.8;

/**
 * The patient/staff panel is the doctor's hand-held tablet: it stays open while you walk
 * (WASD + drag-to-look). Walk out of earshot and talking/examining pauses until you come back.
 * Tucked away, it waits as a tile at the screen edge (with a dot for a new reply); click it,
 * swipe up on it, or talk to someone to bring it back.
 */
export function NpcPanel(props: { npcId: string; initialTab?: string }) {
  const view = useStore((s) => s.view);
  const dist = useStore((s) => s.distances[props.npcId]);
  const minimized = useStore((s) => s.tabletMin);
  const [tab, setTab] = useState<'talk' | 'exam' | 'bedside' | 'plan'>((props.initialTab as 'talk') ?? 'talk');
  const { ref, off, tucking, handlers } = useTuck<HTMLDivElement>({ minimized, onTuck: () => store.set({ tabletMin: true }) });
  const dockPull = useDockPull(() => store.set({ tabletMin: false }));
  const npc = view?.npcs.find((n) => n.id === props.npcId);
  const conv = npc ? view?.conversations.find((c) => c.key === npc.id) : undefined;
  // lines seen before the tablet went away; more than that = a reply waiting
  const seen = useRef(0);
  const lines = conv?.lines.length ?? 0;
  useEffect(() => {
    if (!minimized) seen.current = lines;
  }, [minimized, lines]);
  // 🆘 Escalate (patients): the choice panel under the header
  const [escOpen, setEscOpen] = useState(false);
  useEffect(() => setEscOpen(false), [props.npcId]);
  // The bedside interaction ends as the patient (or their escort) starts the trip to the exit.
  useEffect(() => {
    const panel = store.get().panel;
    if ((npc?.discharge?.phase === 'leaving' || npc?.discharge?.phase === 'departed') && panel?.kind === 'npc' && panel.npcId === props.npcId) {
      store.set({ panel: null, tabletMin: false });
    }
  }, [props.npcId, npc?.discharge?.phase]);
  if (!view || !npc) return null;
  const isPatient = npc.role === 'patient' && !!npc.patientId;
  const canEscalate = !browserDemo && isPatient && view.driver?.kind !== 'agent';
  // the attending walking over after an escalation: talkable once she is at the bedside
  const coming = npc.role === 'attending' ? view.escalations?.findLast((e) => e.attendingId === npc.id && e.status === 'en_route') : undefined;
  const row = isPatient ? view.board.find((r) => r.id === npc.patientId) : undefined;
  const roleColor = { patient: '#9cc3d5', family: '#b48ead', nurse: '#3a8fb7', tech: '#8f3b5a', attending: '#e6e6e6' }[npc.role as string] ?? '#888';
  const tooFarToTalk = dist !== undefined && dist > EARSHOT_M;
  const tooFarToExam = dist !== undefined && dist > EXAM_REACH_M;
  const first = npc.name.replace(/^Dr\. /, '').split(' ')[0];
  const initials = npc.name.replace('Dr. ', '').split(' ').map((w) => w[0]).slice(0, 2).join('');
  const unread = minimized && lines > seen.current && conv?.lines[lines - 1]?.speaker === 'npc';
  const restore = () => store.set({ tabletMin: false });
  const gestureStyle = off ? { transform: `perspective(1600px) translate(${off.x}px, ${off.y}px) rotateY(-7deg) rotateX(3deg) rotateZ(0.5deg)`, transition: 'transform 0.06s linear' } : undefined;

  return (
    <>
    {minimized && (
      <button
        className={`tablet-dock${unread ? ' unread' : ''}`}
        onClick={restore}
        onWheel={dockPull}
        title="Bring the tablet back: click or swipe up (down with reversed scrolling)"
      >
        <span className="avatar" style={{ background: roleColor }}>
          {initials}
        </span>
        <span className="td-text">
          <b>{npc.name}</b>
          <span className="dim">{unread ? 'New reply' : tooFarToTalk ? `${Math.round(dist!)} m away` : 'Tablet'}</span>
        </span>
        {unread && <span className="td-dot" />}
      </button>
    )}
    <div ref={ref} className={`tablet${minimized ? ' min' : ''}${tucking ? ' tucking' : ''}`} style={gestureStyle} role="dialog" aria-label={`${npc.name} — tablet`} aria-hidden={minimized} {...handlers}>
      <div className="tablet-cam" />
      <div className="tablet-screen">
        <div className="tablet-status">
          <span className="mono">{clockAt(view.clockStart, view.t)}</span>
          <span>AgentChart Mobile</span>
          <span>Wi‑Fi · 86%</span>
        </div>
      <button className="close-x" onClick={() => store.set({ panel: null })} title="Close (Esc)">
        ×
      </button>
      <div className="sp-head">
        <div className="avatar" style={{ background: roleColor }}>
          {npc.name.replace('Dr. ', '').split(' ').map((w) => w[0]).slice(0, 2).join('')}
        </div>
        <div>
          <h3>{npc.name}</h3>
          <div className="dim">
            {npc.title}
            {row && (
              <>
                {' '}
                · <span className={`esi esi-${row.esi}`} title={`Triage ESI ${row.esi} (1 = most critical, 5 = least urgent)`}>{row.esi}</span> {row.age}
                {row.sex} · {row.chiefComplaint}
              </>
            )}
          </div>
          {npc.emotion && npc.emotion !== 'neutral' && <div className={`emotion e-${npc.emotion}`}>{emotionLabel(npc.emotion)}</div>}
        </div>
        {canEscalate && (
          <button className={`btn small esc-btn${escOpen ? ' on' : ''}`} onClick={() => setEscOpen(!escOpen)} aria-expanded={escOpen} title="Call your attending about this patient: to the bedside now, or on the phone">
            🆘 Escalate
          </button>
        )}
      </div>
      {canEscalate && escOpen && <EscalatePanel view={view} pid={npc.patientId!} onDone={() => setEscOpen(false)} />}
      {tooFarToTalk ? (
        <div className="tablet-far">
          📍 {npc.name} is {Math.round(dist!)} m away. Walk back to keep talking{isPatient ? ' or examining' : ''}.
        </div>
      ) : (
        isPatient &&
        tab === 'exam' &&
        tooFarToExam && <div className="tablet-far">📍 Step up to the bedside to examine {first}.</div>
      )}
      {isPatient && (
        <div className="sp-tabs">
          {(['talk', 'exam', 'bedside', 'plan'] as const).filter(t => !browserDemo || t !== 'bedside').map((t) => (
            <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
              {t === 'talk' ? '💬 Talk' : t === 'exam' ? '🩺 Examine' : t === 'bedside' ? '📈 Bedside' : '🗂 Plan'}
            </button>
          ))}
        </div>
      )}
      {(tab === 'talk' || !isPatient) && (
        <TalkTab npc={npc} conv={conv} far={tooFarToTalk} wait={coming ? `${drShort(npc.name)} is on her way to ${coming.bedLabel} (expected ${clockAt(view.clockStart, coming.etaT ?? view.t)}): talk to her there.` : undefined} />
      )}
      {tab === 'exam' && isPatient && <ExamTab view={view} pid={npc.patientId!} far={tooFarToExam} />}
      {tab === 'bedside' && isPatient && <BedsideTab view={view} npc={npc} />}
      {tab === 'plan' && isPatient && <PlanTab view={view} pid={npc.patientId!} />}
        <div className="tablet-hint">{browserDemo ? 'Scripted conversation · Close the tablet to keep exploring.' : 'Click the scene to walk (WASD) · drag to look · E or click to talk · Tuck: Tab, swipe down (up with reversed scrolling), or right-drag'}</div>
      </div>
      <div className="tablet-home" />
    </div>
    </>
  );
}

function emotionLabel(e: string) {
  return { pain: '😣 in pain', anxious: '😟 anxious', angry: '😠 frustrated', confused: '😵 confused', relieved: '😌 relieved', sad: '😢 upset', happy: '🙂 reassured', drowsy: '😴 drowsy' }[e] ?? e;
}

function TalkTab({ npc, conv, far, wait }: { npc: NpcView; conv?: ConversationView; far?: boolean; wait?: string }) {
  const rotation = useStore(s => s.rotation);
  const solo = useStore(s => s.solo && s.view?.driver?.kind !== 'agent');
  const next = solo ? nextRadioClue(rotation) : undefined;
  const clue = next?.npc === npc.id ? next : undefined;
  const quick = browserDemo ? demoQuestions(npc, conv?.lines) : npc.offRecord ? SMALL_TALK[npc.role === 'visitor' ? 'public' : 'staff'] : (QUICK[npc.role] ?? []);
  const send = (text: string) => client.act({ type: 'talk', npcId: npc.id, text });
  const empty = !conv || conv.lines.length === 0;
  const off = far || !!wait;
  return (
    <div className="talk">
      {wait && <div className="tablet-far">🚶 {wait}</div>}
      {npc.offRecord && <div className="dim small-note">Off the record: small talk, not part of anyone's care.</div>}
      {clue?.npc === 'caf_luis' && <p className="radio-cue">Luis taps three notes on the till and hums them back to himself.</p>}
      <Transcript lines={conv?.lines ?? []} typing={!!conv?.typing} placeholder={npc.offRecord && npc.role === 'visitor' ? 'Say hello…' : `Say hello to ${npc.name.split(' ')[0]}…`} />
      {quick.length > 0 && (
        <div className="quick">
          {clue && <button className="chip" onClick={() => send(clue.prompt)} disabled={conv?.typing || off}>{clue.prompt}</button>}
          {quick.slice(0, empty ? 4 : 7).map((q) => (
            <button key={q} className="chip" onClick={() => send(q)} disabled={conv?.typing || off}>
              {q}
            </button>
          ))}
        </div>
      )}
      {solo && npc.id === 'caf_rn_mei' && rotation.items.includes(RADIO_PIN) && <p className="radio-receipt" role="status">✓ In your locker · {RADIO_PIN}</p>}
      <ChatInput onSend={send} disabled={!!conv?.typing || off} placeholder={wait ? 'She is on her way…' : far ? `Too far away — walk back to ${npc.name.split(' ')[0]}` : (npc.offRecord && npc.role === 'visitor' ? 'Say something…' : `Talk to ${npc.name.split(' ')[0]}…`) + enterHint()} />
    </div>
  );
}

/** a keyboard hint for the chat box; touch screens send with their own key */
const enterHint = () => (touchTour() ? '' : ' (Enter to send)');

/** "Dr. Evelyn Shaw" → "Dr. Shaw" */
const drShort = (name: string) => (name.startsWith('Dr.') ? `Dr. ${name.split(' ').slice(-1)[0]}` : name);

/**
 * 🆘 Escalate: call the attending about this patient, to the bedside now (she walks over, the HUD
 * shows her on her way) or on the phone to talk it through (the phone opens with her on the line).
 * An optional one-line reason goes into her context and the debrief.
 */
function EscalatePanel({ view, pid, onDone }: { view: PlayerView; pid: string; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<EscalationMode | null>(null);
  const att = view.npcs.find((n) => n.role === 'attending');
  const who = att ? drShort(att.name) : 'The attending';
  const visit = view.escalations?.findLast((e) => e.patientId === pid && (e.status === 'en_route' || e.status === 'at_bedside'));
  const go = async (mode: EscalationMode) => {
    setBusy(mode);
    const r = await client.act({ type: 'escalate', patientId: pid, mode, reason: reason.trim() || undefined });
    setBusy(null);
    if (!r.ok) {
      store.toast(r.message ?? 'Could not reach the attending.', 'warn');
      return;
    }
    setReason('');
    onDone();
    const contactId = (r.data as { contactId?: string } | undefined)?.contactId;
    if (mode === 'call' && contactId) store.set({ panel: { kind: 'phone', contactId } });
    else if (r.message) store.toast(`🆘 ${r.message}`, 'info');
  };
  return (
    <div className="esc-panel" role="group" aria-label="Escalate to the attending">
      <div className="esc-title">Escalate to {att?.name ?? 'the attending'}</div>
      {visit && <div className="esc-status">{visit.status === 'en_route' ? `${who} is on her way (expected ${clockAt(view.clockStart, visit.etaT ?? view.t)}).` : `${who} is here at the bedside.`}</div>}
      <input className="esc-reason" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional), e.g. SBP 84 despite 2 L" aria-label="Reason for escalating (optional)" />
      <div className="esc-actions">
        <button className="btn danger" disabled={!!busy || !!visit} onClick={() => go('bedside')}>
          {busy === 'bedside' ? '…' : '🏃 Come to the bedside now'}
        </button>
        <button className="btn" disabled={!!busy || visit?.status === 'at_bedside'} onClick={() => go('call')}>
          {busy === 'call' ? '…' : '☎ Call to discuss'}
        </button>
      </div>
    </div>
  );
}

function ExamTab({ view, pid, far }: { view: PlayerView; pid: string; far?: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const findings = view.examFindings[pid] ?? [];
  const done = new Set(findings.map((f) => f.maneuver));
  const groups = useMemo(() => {
    const g = new Map<string, typeof EXAM_MANEUVERS>();
    for (const m of EXAM_MANEUVERS) {
      if (filter && !`${m.system} ${m.label}`.toLowerCase().includes(filter.toLowerCase())) continue;
      g.set(m.system, [...(g.get(m.system) ?? []), m]);
    }
    return [...g.entries()];
  }, [filter]);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [findings.length]);
  const run = async (id: string) => {
    setBusy(id);
    await client.act({ type: 'examine', patientId: pid, maneuver: id });
    setBusy(null);
  };
  return (
    <div className="exam">
      <input className="exam-filter" placeholder="Filter maneuvers (e.g. abdomen, malleolus, JVP)…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <div className="exam-grid">
        {groups.map(([sys, ms]) => (
          <div key={sys} className="exam-group">
            <div className="exam-sys">{sys}</div>
            {ms.map((m) => (
              <button key={m.id} className={`exam-btn ${done.has(m.id) ? 'done' : ''}`} disabled={busy !== null || far} onClick={() => run(m.id)} title={`${m.minutes} min${m.chaperone ? ' · chaperone' : ''}`}>
                {busy === m.id ? '…' : done.has(m.id) ? '✓ ' : ''}
                {m.label}
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className="exam-findings" ref={listRef}>
        <div className="hud-section-title">Findings</div>
        {findings.length === 0 && <div className="dim">Choose a maneuver to examine the patient.</div>}
        {findings.map((f, i) => (
          <div key={i} className="finding">
            <b>{f.label}:</b> {f.text}
          </div>
        ))}
      </div>
    </div>
  );
}

/** quick verbal requests to the patient's nurse: order code → button label */
const BEDSIDE_REQUESTS: [string, string][] = [
  ['vitals_now', 'Full vitals incl. temperature'],
  ['monitor', 'Cardiac monitor'],
  ['iv_access', 'IV access'],
  ['ecg12', '12-lead ECG'],
  ['glu_poc', 'Fingerstick glucose'],
  ['o2_nc', 'Oxygen'],
  ['npo', 'NPO'],
];
const ORDER_DONE = new Set(['Completed', 'Final', 'Resulted', 'Given', 'Preliminary']);

function BedsideTab({ view, npc }: { view: PlayerView; npc: NpcView }) {
  const mon = Object.entries(view.monitors).find(([, m]) => m.patientId === npc.patientId)?.[1];
  const pid = npc.patientId!;
  const chart = useStore((s) => s.charts[pid]);
  useEffect(() => {
    if (!chart) client.requestChart(pid);
  }, [pid]);
  const units = view.settings.units;
  const at = (t: number) => clockAt(view.clockStart, t);
  const order = (code: string) => client.act({ type: 'order', patientId: pid, code, priority: 'STAT' });
  const last = chart?.vitals[chart.vitals.length - 1];
  /** how the newest request of this kind stands (null = none, or done long ago) */
  const status = (code: string): { text: string; kind: 'pending' | 'done' | 'active' } | null => {
    const o = chart?.orders.filter((x) => x.code === code && x.status !== 'Canceled').sort((a, b) => b.placedAt - a.placedAt)[0];
    if (!o) return null;
    if (o.status === 'Active') return { text: 'running', kind: 'active' };
    if (ORDER_DONE.has(o.status)) {
      const t = o.completedAt ?? o.resultedAt ?? o.placedAt;
      return view.t - t < 20 * 60 ? { text: `done ${at(t)}`, kind: 'done' } : null;
    }
    return { text: o.status === 'In progress' ? 'nurse on it' : `requested ${at(o.placedAt)}`, kind: 'pending' };
  };
  return (
    <div className="bedside">
      {mon ? (
        <div className="mini-monitor">
          <div className="mm hr">
            <span>HR</span>
            {mon.hr}
          </div>
          <div className="mm bp">
            <span>NIBP</span>
            {formatBP(mon)}
          </div>
          <div className="mm spo2">
            <span>SpO₂</span>
            {mon.spo2}
          </div>
          <div className="mm rr">
            <span>RR</span>
            {mon.rr}
          </div>
          {mon.alarm && <div className="mm-alarm">⚠ {mon.alarm}</div>}
        </div>
      ) : (
        <div className="dim">Not on a monitor.</div>
      )}
      <div className="hud-section-title" style={{ marginTop: 12 }}>
        Last charted vitals
      </div>
      {last ? (
        <div className="bedside-vitals">
          <div className="mono">{formatVitalsLine(last, units)}</div>
          <div className="dim small-note">
            {at(last.t)} · {last.source}
            {last.by ? ` · ${last.by}` : ''}
          </div>
        </div>
      ) : (
        <div className="dim">None charted yet. Ask for a full set below: the nurse goes to the bedside and messages you the numbers.</div>
      )}
      <div className="hud-section-title" style={{ marginTop: 14 }}>
        Quick bedside requests (verbal orders to the nurse)
      </div>
      <div className="bedside-actions">
        {BEDSIDE_REQUESTS.map(([code, label]) => {
          const st = status(code);
          return (
            <button key={code} className={`btn${st ? ` req-${st.kind}` : ''}`} disabled={st?.kind === 'pending' || st?.kind === 'active'} onClick={() => order(code)}>
              {label}
              {st && <span className="req-status">{st.kind === 'done' ? '✓' : st.kind === 'active' ? '●' : '⏳'} {st.text}</span>}
            </button>
          );
        })}
      </div>
      <button className="btn primary bedside-order" onClick={() => store.set({ panel: { kind: 'ehr', patientId: pid, section: 'orders/new' } })}>
        📋 Order labs, imaging, meds…
      </button>
      <p className="dim small-note">Opens AgentChart order entry for this patient, e.g. for a urine drug screen. You can also order at any workstation or from your tablet (Tab → the patient), or ask a nurse in plain language.</p>
    </div>
  );
}

function PlanTab({ view, pid }: { view: PlayerView; pid: string }) {
  const chart = useStore((s) => s.charts[pid]);
  const [text, setText] = useState('');
  useEffect(() => {
    if (!chart) client.requestChart(pid);
  }, [pid]);
  const dx = chart?.diagnoses ?? [];
  const add = () => {
    const t = text.trim();
    if (!t) return;
    client.act({ type: 'set_diagnoses', patientId: pid, diagnoses: [...dx, t] });
    setText('');
  };
  const row = view.board.find((r) => r.id === pid);
  return (
    <div className="plan">
      {browserDemo && !!chart?.ecgs.length && (
        <button className="btn" onClick={() => store.set({ panel: { kind: 'ehr', patientId: pid, section: 'ecg' } })}>
          Review ECG
        </button>
      )}
      <div className="hud-section-title">Working diagnoses</div>
      {dx.length === 0 && <div className="dim">None yet.</div>}
      {dx.map((d, i) => (
        <div key={i} className="dx-row">
          <span>{i === 0 ? '★ ' : ''}{d}</span>
          <button className="btn small" onClick={() => client.act({ type: 'set_diagnoses', patientId: pid, diagnoses: dx.filter((_, j) => j !== i) })}>
            remove
          </button>
        </div>
      ))}
      <div className="dx-add">
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="Add a working diagnosis…" />
        <button className="btn primary" onClick={add}>
          Add
        </button>
      </div>
      <div className="hud-section-title" style={{ marginTop: 16 }}>
        Disposition
      </div>
      <button className="btn primary" onClick={() => store.set({ panel: { kind: 'ehr', patientId: pid, section: 'dx' } })}>
        Open Diagnosis &amp; Dispo
      </button>
      <p className="dim small-note">{row?.discharge ? dischargeStatus(row.discharge) : row?.dispo ? DISPO_LABELS[row.dispo] : 'For an admission or procedure, call the accepting team from a phone.'}</p>
    </div>
  );
}
