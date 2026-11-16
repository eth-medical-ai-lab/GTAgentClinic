import { useEffect, useMemo, useState } from 'react';
import { dischargeStatus, DISPO_LABELS, type Dispo } from '../../../../../shared/types';
import { browserDemo } from '../../../demo/mode';
import { COMMON_DIAGNOSES, SERVICES } from '../diagnoses';
import { classNames } from '../util';
import type { SectionProps } from './common';

const DISPO_GROUPS: { title: string; items: Dispo[] }[] = [
  { title: 'Discharge', items: ['discharge', 'ama'] },
  { title: 'Observation / admission', items: ['observation', 'admit_floor', 'admit_telemetry', 'admit_stepdown', 'admit_icu'] },
  { title: 'Procedure / transfer', items: ['or', 'cath_lab', 'transfer'] },
];

export function DxDispo(p: SectionProps) {
  const { chart, fmt } = p;
  const [dx, setDx] = useState<string[]>(chart.diagnoses);
  const [input, setInput] = useState('');
  const [hi, setHi] = useState(0);
  const [decision, setDecision] = useState<Dispo | null>(chart.disposition?.decision ?? null);
  const [service, setService] = useState(chart.disposition?.service ?? '');
  const [instructions, setInstructions] = useState(chart.disposition?.instructions ?? '');
  const [wheelchair, setWheelchair] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => setDx(chart.diagnoses), [chart.id, chart.diagnoses.join('|')]);

  const suggestions = useMemo(() => {
    const q = input.trim().toLowerCase();
    if (!q) return [];
    return COMMON_DIAGNOSES.filter((d) => d.toLowerCase().includes(q) && !dx.includes(d)).slice(0, 8);
  }, [input, dx]);

  const commit = async (next: string[]) => {
    setDx(next);
    await p.act({ type: 'set_diagnoses', patientId: chart.id, diagnoses: next });
  };

  const add = (d: string) => {
    const v = d.trim();
    if (!v || dx.some((x) => x.toLowerCase() === v.toLowerCase())) return;
    void commit([...dx, v]);
    setInput('');
    setHi(0);
  };

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= dx.length) return;
    const next = [...dx];
    [next[i], next[j]] = [next[j], next[i]];
    void commit(next);
  };

  const decided = chart.disposition;
  const submit = async () => {
    if (!decision) return;
    setSaving(true);
    const r = await p.act(
      { type: 'disposition', patientId: chart.id, decision, service: service || undefined, diagnoses: dx, ...(decision === 'discharge' && { instructions, wheelchair }) },
      decision === 'discharge' ? undefined : `Disposition entered: ${DISPO_LABELS[decision]}`,
    );
    setSaving(false);
    if (r.ok) setConfirm(false);
  };

  return (
    <div className="ehr-grid two">
      <div className="ehr-card">
        <div className="ehr-card-h">Working / ED diagnoses</div>
        <div className="ehr-hint">The first diagnosis is treated as the principal diagnosis. Free text is accepted.</div>
        <div className="ehr-dx-input">
          <input
            className="ehr-input"
            placeholder="Add diagnosis (e.g. sepsis, appendicitis, STEMI)…"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setHi(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setHi((h) => Math.min(suggestions.length - 1, h + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setHi((h) => Math.max(0, h - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                add(suggestions[hi] ?? input);
              }
            }}
          />
          <button className="ehr-btn" onClick={() => add(suggestions[hi] ?? input)} disabled={!input.trim()}>
            Add
          </button>
          {suggestions.length > 0 && (
            <div className="ehr-suggest">
              {suggestions.map((s, i) => (
                <button key={s} className={classNames('ehr-suggest-item', i === hi && 'hi')} onMouseEnter={() => setHi(i)} onMouseDown={(e) => (e.preventDefault(), add(s))}>
                  {s}
                </button>
              ))}
              <button className="ehr-suggest-item free" onMouseDown={(e) => (e.preventDefault(), add(input))}>
                Use free text: “{input}”
              </button>
            </div>
          )}
        </div>
        {dx.length === 0 ? (
          <div className="ehr-empty">No diagnoses entered yet.</div>
        ) : (
          <ol className="ehr-dxlist">
            {dx.map((d, i) => (
              <li key={d}>
                <span className="ehr-dx-rank">{i === 0 ? 'Principal' : `#${i + 1}`}</span>
                <span className="ehr-dx-name">{d}</span>
                <button className="ehr-icon-b" onClick={() => move(i, -1)} disabled={i === 0} title="Move up">
                  ↑
                </button>
                <button className="ehr-icon-b" onClick={() => move(i, 1)} disabled={i === dx.length - 1} title="Move down">
                  ↓
                </button>
                <button className="ehr-icon-b del" onClick={() => void commit(dx.filter((x) => x !== d))} title="Remove">
                  ✕
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="ehr-card">
        <div className="ehr-card-h">Disposition</div>
        {decided && (
          <div className="ehr-decided">
            <b>{DISPO_LABELS[decided.decision]}</b>
            {decided.service ? ` — ${decided.service}` : ''} · entered {fmt(decided.t)}
            {decided.diagnoses.length > 0 && <div className="ehr-dim">Diagnoses: {decided.diagnoses.join('; ')}</div>}
            {chart.discharge && (
              <div role="status">
                {dischargeStatus(chart.discharge)}
                {chart.discharge.phase === 'paperwork' && chart.discharge.until !== undefined && ` · Ready around ${fmt(chart.discharge.until)}`}
                {(chart.discharge.phase === 'awaiting_nurse' || chart.discharge.phase === 'handoff') && chart.assignedNurse && ` · RN ${chart.assignedNurse}`}
                {chart.discharge.phase === 'awaiting_nurse' && chart.discharge.until !== undefined && ` · Expected ${fmt(chart.discharge.until)}`}
                {chart.discharge.phase === 'leaving' && chart.discharge.until !== undefined && ` · Expected exit ${fmt(chart.discharge.until)}`}
                {chart.discharge.phase === 'departed' && ` · ${fmt(chart.discharge.since)}`}
              </div>
            )}
          </div>
        )}
        {DISPO_GROUPS.map((g) => (
          <div key={g.title} className="ehr-dispo-group">
            <div className="ehr-dispo-gt">{g.title}</div>
            <div className="ehr-dispo-opts">
              {g.items.map((d) => (
                <label key={d} className={classNames('ehr-dispo-opt', decision === d && 'on')}>
                  <input type="radio" name="dispo" checked={decision === d} onChange={() => setDecision(d)} disabled={!!decided} />
                  {DISPO_LABELS[d]}
                </label>
              ))}
            </div>
          </div>
        ))}
        {decision && decision !== 'discharge' && decision !== 'ama' && (
          <label className="ehr-field">
            <span>Accepting service</span>
            <select className="ehr-input" value={service} onChange={(e) => setService(e.target.value)} disabled={!!decided}>
              <option value="">— select —</option>
              {SERVICES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
        )}
        {decision === 'discharge' && (
          <>
            <label className="ehr-field">
              <span>Discharge instructions & return precautions</span>
              <textarea className="ehr-input ehr-textarea" rows={4} value={decided?.instructions ?? instructions} onChange={(e) => setInstructions(e.target.value)} disabled={!!decided} placeholder="Diagnosis, medications, follow-up, when to return…" />
            </label>
            {!decided && !browserDemo && (
              <label className="ehr-dispo-opt">
                <input type="checkbox" checked={wheelchair} onChange={(e) => setWheelchair(e.target.checked)} />
                Request a wheelchair escort to the exit
              </label>
            )}
          </>
        )}
        {!decided && (
          <button className="ehr-btn sign" disabled={!decision || dx.length === 0} onClick={() => setConfirm(true)}>
            Submit disposition
          </button>
        )}
        {!decided && dx.length === 0 && <div className="ehr-hint">Enter at least one diagnosis before submitting a disposition.</div>}
      </div>

      {confirm && decision && (
        <div className="ehr-modal-back" onMouseDown={(e) => e.target === e.currentTarget && setConfirm(false)}>
          <div className="ehr-dialog">
            <div className="ehr-dialog-h">Confirm disposition</div>
            <p>
              <b>{chart.name}</b> ({chart.bedLabel}) → <b>{DISPO_LABELS[decision]}</b>
              {service ? ` (${service})` : ''}
            </p>
            <p className="ehr-dim">Principal diagnosis: {dx[0]}</p>
            {decision === 'discharge' && wheelchair && <p>Wheelchair escort requested.</p>}
            <p className="ehr-warn-inline">{browserDemo ? 'This records the final disposition for this tour visit.' : 'Dispositions are final for this encounter and will be scored.'}</p>
            <div className="ehr-dialog-actions">
              <button className="ehr-btn" onClick={() => setConfirm(false)}>
                Back
              </button>
              <button className="ehr-btn sign" onClick={submit} disabled={saving}>
                {saving ? 'Submitting…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
