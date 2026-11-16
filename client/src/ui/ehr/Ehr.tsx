/**
 * AgentChart — the in-game electronic health record (sitting at a workstation).
 * Generic, original branding; dense clinical layout; all data from PlayerView /
 * PatientChart; all writes go through props.onAction.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Action, ActionResult, PatientChart, PlayerView, UnitSystem } from '../../../../shared/types';
import { dischargeStatus, DISPO_LABELS, clockAt, lengthOfStay } from '../../../../shared/types';
import { OrderEntry, type CartItem } from './OrderEntry';
import { BoardTable, sortBoard } from './TrackingBoard';
import { SECTIONS, type SectionId, type SectionProps } from './sections/common';
import { DxDispo } from './sections/DxDispo';
import { EcgSection } from './sections/EcgSection';
import { Imaging } from './sections/Imaging';
import { Notes } from './sections/Notes';
import { Mar, Orders } from './sections/OrdersMar';
import { Results } from './sections/Results';
import { ChartReview, Snapshot } from './sections/Snapshot';
import { Vitals } from './sections/Vitals';
import { bmi, classNames, fmtLos, fmtTime } from './util';
import { browserDemo } from '../../demo/mode';
import './ehr.css';

export { TrackingBoard, type TrackingBoardProps } from './TrackingBoard';

export interface EhrProps {
  view: PlayerView;
  charts: Record<string, PatientChart>;
  units: UnitSystem;
  initialPatientId?: string;
  initialSection?: string;
  onAction: (a: Action) => Promise<ActionResult>;
  onRequestChart: (patientId: string) => void;
  onClose: () => void;
  /** a line of context under the header, e.g. at the medication dispenser (ui/EhrTransition.tsx) */
  notice?: string;
}

const ALIASES: Record<string, SectionId> = {
  summary: 'snapshot',
  snapshot: 'snapshot',
  history: 'review',
  review: 'review',
  labs: 'results',
  results: 'results',
  trend: 'results',
  vitals: 'vitals',
  flowsheet: 'vitals',
  ecg: 'ecg',
  imaging: 'imaging',
  orders: 'orders',
  mar: 'mar',
  notes: 'notes',
  dx: 'dx',
  dispo: 'dx',
  diagnosis: 'dx',
  board: 'board',
};

/** "results:lactate" → {section:'results', arg:'lactate'}; "neworder[:set_sepsis]" opens order entry. */
function parseSection(s?: string): { section?: SectionId; arg?: string; newOrder?: boolean; orderSet?: string } {
  if (!s) return {};
  const [head, arg] = s.split(/[:/]/);
  const h = head.toLowerCase();
  if (h === 'neworder' || (h === 'orders' && arg === 'new')) return { section: 'orders', newOrder: true, orderSet: h === 'neworder' ? arg : undefined };
  return { section: ALIASES[h], arg };
}

/** actions whose success needs no status-bar message */
const SILENT = new Set<Action['type']>(['mark_read', 'set_diagnoses']);

interface Status {
  text: string;
  tone: 'good' | 'bad' | 'info';
  at: number;
}

const sections = browserDemo ? SECTIONS.filter(s => ['snapshot', 'review', 'results', 'vitals', 'ecg', 'imaging', 'notes', 'dx'].includes(s.id)) : SECTIONS;

export function Ehr(props: EhrProps) {
  const { view, charts, units } = props;
  const init = useMemo(() => {
    const target = parseSection(props.initialSection);
    return browserDemo && !sections.some(s => s.id === target.section) ? {} : target;
  }, []);
  const rows = useMemo(() => sortBoard(view.board), [view.board]);
  // Logging in without a patient context lands on the department patient list (like a real EHR).
  const [pid, setPid] = useState<string | null>(props.initialPatientId ?? (init.section && init.section !== 'board' ? rows[0]?.id ?? null : null));
  const [section, setSection] = useState<SectionId>(init.section ?? (pid ? 'snapshot' : 'board'));
  const [arg, setArg] = useState<string | undefined>(init.arg);
  const [orderEntry, setOrderEntry] = useState<{ open: boolean; set?: string }>({ open: !!init.newOrder, set: init.orderSet });
  const [status, setStatus] = useState<Status | null>(null);
  const requested = useRef<Set<string>>(new Set());

  const chart = pid ? charts[pid] : undefined;

  useEffect(() => {
    if (pid && !charts[pid] && !requested.current.has(pid)) {
      requested.current.add(pid);
      props.onRequestChart(pid);
    }
  }, [pid, charts]);

  useEffect(() => {
    if (!status) return;
    const id = setTimeout(() => setStatus(null), 6000);
    return () => clearTimeout(id);
  }, [status]);

  // Esc closes the order-entry modal before the whole EHR
  useEffect(() => {
    if (!orderEntry.open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        setOrderEntry({ open: false });
      }
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [orderEntry.open]);

  // Alt+1…9 / Alt+0 section shortcuts
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!e.altKey || !pid) return;
      const n = parseInt(e.code.replace('Digit', ''), 10);
      if (Number.isNaN(n)) return;
      const s = sections[n === 0 ? 9 : n - 1];
      if (s) {
        e.preventDefault();
        go(s.id);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [pid]);

  const fmt = useCallback((t: number) => fmtTime(view.clockStart, t), [view.clockStart]);

  const act = useCallback(
    async (a: Action, okMessage?: string) => {
      const r = await props.onAction(a);
      if (!r.ok) setStatus({ text: r.message ?? 'Action failed.', tone: 'bad', at: Date.now() });
      else if (okMessage) setStatus({ text: okMessage, tone: 'good', at: Date.now() });
      else if (r.message && !SILENT.has(a.type)) setStatus({ text: r.message, tone: 'info', at: Date.now() });
      return r;
    },
    [props.onAction],
  );

  const go = useCallback((s: SectionId, a?: string) => {
    setSection(s);
    setArg(a);
  }, []);

  const openPatient = (id: string) => {
    setPid(id);
    if (section === 'board') setSection('snapshot');
    setArg(undefined);
  };

  const onSign = async (items: CartItem[]) => {
    if (!pid) return { failed: items.map((i) => ({ key: i.key, message: 'No patient selected' })) };
    const failed: { key: string; message: string }[] = [];
    let ok = 0;
    for (const it of items) {
      const r = await props.onAction({ type: 'order', patientId: pid, code: it.code, params: it.params, priority: it.priority });
      if (r.ok) ok++;
      else failed.push({ key: it.key, message: r.message ?? 'Order failed' });
    }
    if (ok) setStatus({ text: `${ok} order${ok === 1 ? '' : 's'} signed${failed.length ? ` · ${failed.length} failed` : ''}.`, tone: failed.length ? 'bad' : 'good', at: Date.now() });
    if (!failed.length) go('orders');
    return { failed };
  };

  const sp: SectionProps | null = chart
    ? {
        chart,
        view,
        units,
        act,
        go,
        openOrderEntry: (set?: string) => setOrderEntry({ open: true, set }),
        fmt,
      }
    : null;

  const unreadNotes = chart ? chart.notes.filter((n) => n.unread).length : 0;
  const unsignedEcg = chart ? chart.ecgs.filter((e) => e.signedAt === undefined).length : 0;
  const boardRow = view.board.find((r) => r.id === pid);

  return (
    <div className="ehr-backdrop">
      <div className="ehr-root" role="dialog" aria-label="AgentChart electronic health record">
        <header className="ehr-top">
          <div className="ehr-brand">
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
              <rect x="1" y="1" width="22" height="22" rx="6" fill="#0f6e6e" />
              <path d="M4 13h4l2-5 3 9 2-6 1.5 2H20" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div>
              <div className="ehr-brand-name">AgentChart</div>
              <div className="ehr-brand-sub">Grand Therapies MC · ED</div>
            </div>
          </div>
          <nav className="ehr-ptabs">
            <button className={classNames('ehr-ptab board', section === 'board' && 'on')} onClick={() => go('board')}>
              ▦ Tracking board <span className="ehr-ptab-n">{view.board.filter((r) => r.flowStatus !== 'Departed').length}</span>
            </button>
            {rows.map((r) => (
              <button key={r.id} className={classNames('ehr-ptab', pid === r.id && section !== 'board' && 'on', r.flowStatus === 'Departed' && 'gone')} onClick={() => openPatient(r.id)} title={`${r.name} — ${r.chiefComplaint}`}>
                <span className={`ehr-esidot esi-${r.esi}`} />
                <span className="ehr-ptab-bed">{r.bedLabel}</span>
                <span className="ehr-ptab-name">{r.name.split(',')[0]}</span>
                {r.newResults > 0 && <span className="ehr-ptab-new">{r.newResults}</span>}
                {r.critical && <span className="ehr-ptab-crit">!!</span>}
              </button>
            ))}
          </nav>
          <div className="ehr-top-right">
            <div className="ehr-clock" title="Current time">
              {clockAt(view.clockStart, view.t)}
            </div>
            <div className="ehr-user">
              <span className="ehr-avatar">R</span>
              <div>
                <div>Resident (You)</div>
                <div className="ehr-dim">Emergency Medicine · units {units}</div>
              </div>
            </div>
            <button className="ehr-x light" onClick={props.onClose} title="Log off workstation (Esc)">
              ✕
            </button>
          </div>
        </header>

        {section !== 'board' && chart && (
          <div className="ehr-banner">
            <div className="ehr-banner-main">
              <div className="ehr-pt-name">{chart.name}</div>
              <div className="ehr-pt-meta">
                <span>
                  {chart.age} y · {chart.sex === 'M' ? 'Male' : 'Female'}
                </span>
                <span>DOB {chart.dob}</span>
                <span>MRN {chart.mrn}</span>
                <span>
                  <b>{chart.bedLabel}</b>
                </span>
                <span className={`ehr-esi esi-${chart.esi}`}>ESI {chart.esi}</span>
                <span>LOS {fmtLos(lengthOfStay(chart, view.t))}</span>
                <span>
                  {chart.weightKg} kg · {chart.heightCm} cm{bmi(chart) ? ` · BMI ${bmi(chart)!.toFixed(1)}` : ''}
                </span>
                <span>{chart.discharge ? dischargeStatus(chart.discharge) : chart.flowStatus}</span>
              </div>
              <div className="ehr-pt-meta">
                <span>
                  CC: <b>{chart.chiefComplaint}</b> ({chart.arrivalMode})
                </span>
                <span>Code: {chart.codeStatus}</span>
                <span>PCP: {chart.pcp ? `${chart.pcp.name}` : 'none on file'}</span>
                <span>Ins: {chart.insurance ? chart.insurance.payer : 'self-pay'}</span>
                <span>RN: {chart.assignedNurse ?? '—'}</span>
                {chart.disposition && <span className="ehr-dispo-chip">Dispo: {DISPO_LABELS[chart.disposition.decision]}</span>}
              </div>
            </div>
            <div className="ehr-banner-allergy">
              <div className="ehr-allergy-h">Allergies</div>
              {Array.isArray(chart.allergies) ? (
                chart.allergies.length ? (
                  chart.allergies.map((a) => (
                    <div key={a.substance} className="ehr-allergy">
                      {a.substance} <span>— {a.reaction}</span>
                    </div>
                  ))
                ) : (
                  <div className="ehr-nkda">No known drug allergies</div>
                )
              ) : chart.allergies === 'NKDA' ? (
                <div className="ehr-nkda">NKDA</div>
              ) : (
                <div className="ehr-allergy-unk">{chart.allergies}</div>
              )}
            </div>
          </div>
        )}
        {section !== 'board' && chart && chart.alerts.length > 0 && (
          <div className="ehr-alerts">
            {chart.alerts.map((a) => (
              <div key={a} className="ehr-alert">
                ⚠ {a}
              </div>
            ))}
          </div>
        )}
        {props.notice && <div className="ehr-notice">💊 {props.notice}</div>}

        <div className="ehr-body">
          {section !== 'board' && (
            <aside className="ehr-nav">
              {!browserDemo && <button className="ehr-btn primary block ehr-neworder" disabled={!chart} onClick={() => setOrderEntry({ open: true })}>
                + New order
              </button>}
              {sections.map((s, i) => {
                const badge = s.id === 'notes' ? unreadNotes : s.id === 'ecg' ? unsignedEcg : s.id === 'results' ? boardRow?.newResults ?? 0 : 0;
                return (
                  <button key={s.id} className={classNames('ehr-navb', section === s.id && 'on')} onClick={() => go(s.id)} title={`Alt+${i === 9 ? 0 : i + 1}`}>
                    <span className="ehr-nav-ic">{s.icon}</span>
                    {s.label}
                    {badge > 0 && <span className={classNames('ehr-nav-badge', s.id === 'ecg' && 'warn')}>{badge}</span>}
                  </button>
                );
              })}
              <div className="ehr-nav-foot">
                <div className="ehr-dim">Workstation logged in</div>
                <div className="ehr-dim">{browserDemo ? 'Browser demo' : 'Alt+1…0 switch sections'}</div>
              </div>
            </aside>
          )}
          <main className="ehr-main">
            {section === 'board' ? (
              <div className="ehr-boardsec">
                <div className="ehr-card-h">
                  Emergency Department — all patients <span className="ehr-card-sub">click a row to open the chart</span>
                </div>
                <BoardTable view={view} variant="light" onOpenChart={openPatient} selectedId={pid} />
              </div>
            ) : !sp ? (
              <div className="ehr-empty big">{pid ? 'Loading chart…' : 'Select a patient.'}</div>
            ) : (
              <>
                {section === 'snapshot' && <Snapshot {...sp} />}
                {section === 'review' && <ChartReview {...sp} />}
                {section === 'results' && <Results {...sp} analyte={arg} setAnalyte={(a) => setArg(a)} />}
                {section === 'vitals' && <Vitals {...sp} />}
                {section === 'ecg' && <EcgSection {...sp} ecgId={arg} />}
                {section === 'imaging' && <Imaging {...sp} />}
                {section === 'orders' && <Orders {...sp} />}
                {section === 'mar' && <Mar {...sp} />}
                {section === 'notes' && <Notes key={chart!.id} {...sp} noteId={arg} />}
                {section === 'dx' && <DxDispo key={chart!.id} {...sp} />}
              </>
            )}
          </main>
        </div>

        <footer className="ehr-status">
          <span>{chart && section !== 'board' ? `${chart.name} · ${chart.bedLabel} · chart v${chart.version}` : `${view.board.length} patients`}</span>
          {status && <span className={`ehr-status-msg ${status.tone}`}>{status.text}</span>}
          <span className="ehr-dim">AgentChart 0.1 · simulated record — not for clinical use</span>
        </footer>

        {orderEntry.open && chart && <OrderEntry chart={chart} initialSet={orderEntry.set} onSign={onSign} onClose={() => setOrderEntry({ open: false })} />}
      </div>
    </div>
  );
}
