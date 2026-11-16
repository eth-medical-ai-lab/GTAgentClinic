import type { VitalsEntry } from '../../../../../shared/types';
import { browserDemo } from '../../../demo/mode';
import { formatGlucose, formatTemp, map } from '../../../../../shared/units';
import { Sparkline } from '../TrendChart';
import { classNames, vitalAbnormal } from '../util';
import type { SectionProps } from './common';

interface Row {
  key: string;
  label: string;
  get: (v: VitalsEntry) => number | undefined;
  show: (v: VitalsEntry) => string;
}

export function Vitals(p: SectionProps) {
  const { chart, units, fmt, view } = p;
  const entries = [...chart.vitals].sort((a, b) => a.t - b.t);
  const rows: Row[] = [
    { key: 'temp', label: 'Temperature', get: (v) => v.temp, show: (v) => (v.temp === undefined ? '—' : formatTemp(v.temp, units)) },
    { key: 'hr', label: 'Heart rate', get: (v) => v.hr, show: (v) => (v.hr === undefined ? '—' : `${Math.round(v.hr)}`) },
    { key: 'sbp', label: 'BP (systolic/diastolic)', get: (v) => v.sbp, show: (v) => (v.sbp === undefined ? '—' : `${Math.round(v.sbp)}/${Math.round(v.dbp ?? 0)}`) },
    { key: 'map', label: 'MAP', get: (v) => map(v), show: (v) => map(v)?.toString() ?? '—' },
    { key: 'rr', label: 'Respiratory rate', get: (v) => v.rr, show: (v) => (v.rr === undefined ? '—' : `${Math.round(v.rr)}`) },
    { key: 'spo2', label: 'SpO₂', get: (v) => v.spo2, show: (v) => (v.spo2 === undefined ? '—' : `${Math.round(v.spo2)}%`) },
    { key: 'o2', label: 'O₂ delivery', get: () => undefined, show: (v) => v.o2 ?? '—' },
    { key: 'pain', label: 'Pain (0–10)', get: (v) => v.pain, show: (v) => (v.pain === undefined ? '—' : `${v.pain}`) },
    { key: 'gcs', label: 'GCS', get: (v) => v.gcs, show: (v) => (v.gcs === undefined ? '—' : `${v.gcs}`) },
    { key: 'glucose', label: 'POC glucose', get: (v) => v.glucose, show: (v) => (v.glucose === undefined ? '—' : formatGlucose(v.glucose, units)) },
  ];
  const visibleRows = rows.filter((r) => r.key === 'temp' || r.key === 'o2' || entries.some((e) => r.get(e) !== undefined));
  const live = view.monitors[chart.bed];

  return (
    <div className="ehr-stack">
      {live && (
        <div className="ehr-live big">
          <span className="ehr-live-dot" /> Continuous monitor — HR <b>{Math.round(live.hr)}</b> · BP <b>{Math.round(live.sbp)}/{Math.round(live.dbp)}</b> · SpO₂ <b>{Math.round(live.spo2)}%</b> · RR <b>{Math.round(live.rr)}</b> · rhythm {live.rhythm}
          {live.alarm && <b className="ehr-live-alarm"> · ALARM: {live.alarm}</b>}
          <span className="ehr-dim"> (monitor values are charted to the flowsheet periodically)</span>
        </div>
      )}
      <div className="ehr-card">
        <div className="ehr-card-h">
          Vital signs flowsheet
          <span className="ehr-card-sub">{entries.length} entries</span>
          {!browserDemo && <button className="ehr-link" onClick={() => p.openOrderEntry()}>
            + Order vitals
          </button>}
        </div>
        {entries.length === 0 ? (
          <div className="ehr-empty">No vital signs documented.</div>
        ) : (
          <div className="ehr-scroll-x">
            <table className="ehr-table ehr-flow">
              <thead>
                <tr>
                  <th className="ehr-sticky">Measure</th>
                  {entries.map((e) => (
                    <th key={e.id} className="ehr-num">
                      {fmt(e.t)}
                      <div className="ehr-th-sub">{e.source}</div>
                    </th>
                  ))}
                  <th>Trend</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((r) => {
                  const nums = entries.map((e) => r.get(e)).filter((x): x is number => x !== undefined);
                  const lastAbn = vitalAbnormal(r.key, nums[nums.length - 1]);
                  return (
                    <tr key={r.key}>
                      <td className="ehr-sticky">{r.label}</td>
                      {entries.map((e) => {
                        const val = r.get(e);
                        const missing = r.key !== 'o2' && val === undefined;
                        return (
                          <td key={e.id} className={classNames('ehr-num', vitalAbnormal(r.key, val) && 'ehr-abn', missing && r.key === 'temp' && 'ehr-missing')} title={missing && e.comment ? e.comment : undefined}>
                            {r.show(e)}
                          </td>
                        );
                      })}
                      <td>{nums.length >= 2 ? <Sparkline values={nums} abnormal={lastAbn} /> : <span className="ehr-dim">—</span>}</td>
                    </tr>
                  );
                })}
                <tr>
                  <td className="ehr-sticky">Documented by</td>
                  {entries.map((e) => (
                    <td key={e.id} className="ehr-dim ehr-small">
                      {e.by ?? (e.source === 'Monitor' ? 'auto' : '—')}
                    </td>
                  ))}
                  <td />
                </tr>
                <tr>
                  <td className="ehr-sticky">Comment</td>
                  {entries.map((e) => (
                    <td key={e.id} className={classNames('ehr-small', e.comment && 'ehr-comment-cell')}>
                      {e.comment ?? ''}
                    </td>
                  ))}
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
