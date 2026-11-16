import { useEffect, useState } from 'react';
import { EcgView } from '../../ecg/EcgView';
import { measurements } from '../../ecg/synth';
import { browserDemo } from '../../../demo/mode';
import { classNames } from '../util';
import type { SectionProps } from './common';

export function EcgSection(p: SectionProps & { ecgId?: string }) {
  const { chart, fmt } = p;
  const ecgs = [...chart.ecgs].sort((a, b) => b.acquiredAt - a.acquiredAt);
  const [sel, setSel] = useState<string | undefined>(p.ecgId ?? ecgs[0]?.id);
  const ecg = ecgs.find((e) => e.id === sel) ?? ecgs[0];
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => setText(''), [ecg?.id]);

  if (!ecg)
    return (
      <div className="ehr-card">
        <div className="ehr-empty big">No ECGs for this encounter.{!browserDemo && ' Order “ECG 12-lead” to obtain one.'}</div>
        {!browserDemo && <button className="ehr-btn primary" onClick={() => p.openOrderEntry()}>
          + New order
        </button>}
      </div>
    );

  const m = measurements(ecg.params);
  const sign = async () => {
    if (!text.trim()) return;
    setBusy(true);
    await p.act({ type: 'sign_ecg', ecgId: ecg.id, interpretation: text.trim() }, 'ECG signed.');
    setBusy(false);
  };

  return (
    <div className="ehr-ecg">
      <div className="ehr-ecg-list">
        {ecgs.map((e) => (
          <button key={e.id} className={classNames('ehr-ecg-item', e.id === ecg.id && 'on')} onClick={() => setSel(e.id)}>
            <b>{e.label}</b>
            <span>{fmt(e.acquiredAt)}</span>
            {e.signedAt !== undefined ? <span className="ehr-ok">✓ signed</span> : <span className="ehr-needs">needs review</span>}
          </button>
        ))}
      </div>
      <div className="ehr-ecg-main">
        <div className="ehr-ecg-paper">
          <div className="ehr-ecg-header mono">
            <span>
              <b>{chart.name}</b> · {chart.age} y {chart.sex} · MRN {chart.mrn}
            </span>
            <span>Acquired {fmt(ecg.acquiredAt)}</span>
            <span>
              Vent rate <b>{m.rate}</b> bpm · PR {m.pr ?? '—'} ms · QRS {m.qrs} ms · QT/QTc {m.qt}/{m.qtc} ms · Axis {m.axis}°
            </span>
          </div>
          <EcgView params={ecg.params} className="ehr-ecg-svg" title={`${ecg.label} — ${chart.name}`} />
        </div>
        <div className="ehr-ecg-side">
          <div className="ehr-card">
            <div className="ehr-card-h">Computer interpretation</div>
            <div className="ehr-machine mono">{ecg.machineRead}</div>
            <div className="ehr-hint">Unconfirmed computer read. Requires physician over-read.</div>
          </div>
          <div className="ehr-card">
            <div className="ehr-card-h">Physician interpretation</div>
            {ecg.signedAt !== undefined ? (
              <>
                <div className="ehr-signed">{ecg.physicianRead}</div>
                <div className="ehr-dim">Signed by you at {fmt(ecg.signedAt)}</div>
              </>
            ) : (
              <>
                <textarea
                  className="ehr-input ehr-textarea"
                  rows={5}
                  placeholder="Rate, rhythm, axis, intervals, ST/T changes, comparison, impression…"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sign();
                  }}
                />
                <button className="ehr-btn sign" disabled={!text.trim() || busy} onClick={sign}>
                  {busy ? 'Signing…' : 'Sign interpretation'}
                </button>
                <div className="ehr-hint">Door-to-ECG review goal for chest pain: ≤ 10 minutes.</div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
