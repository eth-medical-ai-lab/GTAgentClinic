import { ANALYTES } from '../../../../../shared/catalog';
import { browserDemo } from '../../../demo/mode';
import { DISPO_LABELS } from '../../../../../shared/types';
import { formatBP, formatGlucose, formatLabValue, formatTemp, labUnit, map, refRangeText } from '../../../../../shared/units';
import { classNames, flagClass, flagText, isActiveOrder, vitalAbnormal } from '../util';
import type { SectionProps } from './common';

export function Snapshot(p: SectionProps) {
  const { chart, view, units, fmt } = p;
  const last = chart.vitals[chart.vitals.length - 1];
  const live = view.monitors[chart.bed];
  const recent = chart.labs
    .filter((l) => !l.historical)
    .sort((a, b) => b.resultedAt - a.resultedAt)
    .slice(0, 10);
  const active = chart.orders.filter(isActiveOrder);
  const notes = [...chart.notes].sort((a, b) => b.t - a.t).slice(0, 4);
  const unsigned = chart.ecgs.filter((e) => !e.signedAt);
  const pendingImg = chart.imaging.filter((i) => i.status !== 'Final' && i.status !== 'Canceled');

  const V = ({ k, label, value, raw }: { k: string; label: string; value: string; raw?: number }) => (
    <div className={classNames('ehr-vital', vitalAbnormal(k, raw) && 'abn')}>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );

  return (
    <div className="ehr-grid">
      <div className="ehr-card span2">
        <div className="ehr-card-h">
          Latest vital signs
          {last && (
            <span className="ehr-card-sub">
              {fmt(last.t)} · {last.source}
              {last.by ? ` · ${last.by}` : ''}
            </span>
          )}
          <button className="ehr-link" onClick={() => p.go('vitals')}>
            Flowsheet →
          </button>
        </div>
        {last ? (
          <div className="ehr-vitals-row">
            <V k="hr" label="HR" value={last.hr !== undefined ? `${Math.round(last.hr)}` : '—'} raw={last.hr} />
            <V k="sbp" label="BP" value={formatBP(last)} raw={last.sbp} />
            <V k="map" label="MAP" value={map(last)?.toString() ?? '—'} raw={map(last)} />
            <V k="rr" label="RR" value={last.rr !== undefined ? `${Math.round(last.rr)}` : '—'} raw={last.rr} />
            <V k="spo2" label={`SpO₂${last.o2 ? ' · ' + last.o2 : ''}`} value={last.spo2 !== undefined ? `${Math.round(last.spo2)}%` : '—'} raw={last.spo2} />
            <V k="temp" label="Temp" value={formatTemp(last.temp, units)} raw={last.temp} />
            <V k="pain" label="Pain" value={last.pain !== undefined ? `${last.pain}/10` : '—'} raw={last.pain} />
            <V k="gcs" label="GCS" value={last.gcs !== undefined ? `${last.gcs}` : '—'} raw={last.gcs} />
            {last.glucose !== undefined && <V k="glucose" label="POC glu" value={formatGlucose(last.glucose, units)} raw={last.glucose} />}
          </div>
        ) : (
          <div className="ehr-empty">No vital signs documented.</div>
        )}
        {last?.comment && <div className="ehr-comment">Comment: {last.comment}</div>}
        {live && (
          <div className="ehr-live">
            <span className="ehr-live-dot" /> Bedside monitor (live): HR {Math.round(live.hr)} · BP {Math.round(live.sbp)}/{Math.round(live.dbp)} · SpO₂ {Math.round(live.spo2)}% · RR {Math.round(live.rr)} · {live.rhythm}
            {live.alarm && <b className="ehr-live-alarm"> ALARM: {live.alarm}</b>}
          </div>
        )}
      </div>

      <div className="ehr-card">
        <div className="ehr-card-h">
          Working diagnoses
          {!browserDemo && <button className="ehr-link" onClick={() => p.go('dx')}>
            Edit →
          </button>}
        </div>
        {chart.diagnoses.length ? (
          <ol className="ehr-list">
            {chart.diagnoses.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ol>
        ) : (
          <div className="ehr-empty">None entered.</div>
        )}
        <div className="ehr-kv">
          <span>Disposition</span>
          <b>{chart.disposition ? `${DISPO_LABELS[chart.disposition.decision]} (${fmt(chart.disposition.t)})` : 'Pending'}</b>
        </div>
      </div>

      <div className="ehr-card span2">
        <div className="ehr-card-h">
          Recent results
          <button className="ehr-link" onClick={() => p.go('results')}>
            All results →
          </button>
        </div>
        {recent.length ? (
          <table className="ehr-table compact">
            <tbody>
              {recent.map((r) => {
                const a = ANALYTES[r.analyte];
                return (
                  <tr key={r.id} className="ehr-click" onClick={() => p.go('results', r.analyte)}>
                    <td className="ehr-dim">{fmt(r.resultedAt)}</td>
                    <td>{a?.name ?? r.analyte}</td>
                    <td className={classNames('ehr-num', flagClass(r.flag))}>
                      {formatLabValue(r.analyte, r.value, units)} <span className="ehr-unit">{labUnit(r.analyte, units)}</span>
                    </td>
                    <td className={flagClass(r.flag)}>{flagText(r.flag)}</td>
                    <td className="ehr-dim">{refRangeText(r.analyte, chart.sex, units)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="ehr-empty">No results yet.</div>
        )}
      </div>

      <div className="ehr-card">
        <div className="ehr-card-h">
          Active orders <span className="ehr-badge">{active.length}</span>
          {!browserDemo && <button className="ehr-link" onClick={() => p.openOrderEntry()}>
            + New
          </button>}
        </div>
        {active.length ? (
          <ul className="ehr-list plain">
            {active.slice(0, 9).map((o) => (
              <li key={o.id}>
                <span className={`ehr-status s-${o.status.replace(/\s+/g, '-').toLowerCase()}`}>{o.status}</span> {o.name}
              </li>
            ))}
            {active.length > 9 && <li className="ehr-dim">+{active.length - 9} more…</li>}
          </ul>
        ) : (
          <div className="ehr-empty">No active orders.</div>
        )}
        {(unsigned.length > 0 || pendingImg.length > 0) && (
          <div className="ehr-attn">
            {unsigned.length > 0 && (
              <button className="ehr-attn-item" onClick={() => p.go('ecg')}>
                ∿ {unsigned.length} ECG awaiting physician review
              </button>
            )}
            {pendingImg.map((i) => (
              <button key={i.id} className="ehr-attn-item" onClick={() => p.go('imaging')}>
                ◩ {i.name}: {i.status}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="ehr-card">
        <div className="ehr-card-h">Problem list</div>
        {chart.problemList.length ? (
          <ul className="ehr-list plain">
            {chart.problemList.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        ) : (
          <div className="ehr-empty">No active problems documented.</div>
        )}
      </div>

      <div className="ehr-card">
        <div className="ehr-card-h">Home medications</div>
        {Array.isArray(chart.homeMeds) ? (
          chart.homeMeds.length ? (
            <ul className="ehr-list plain">
              {chart.homeMeds.map((m) => (
                <li key={m.name}>
                  <b>{m.name}</b> {m.dose} <span className="ehr-dim">{m.sig}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="ehr-empty">No home medications.</div>
          )
        ) : (
          <div className="ehr-warn-inline">⚠ {chart.homeMeds}</div>
        )}
        <div className="ehr-hint">Medication list from prior records — verify with patient.</div>
      </div>

      <div className="ehr-card">
        <div className="ehr-card-h">
          Recent notes
          <button className="ehr-link" onClick={() => p.go('notes')}>
            All notes →
          </button>
        </div>
        {notes.length ? (
          <ul className="ehr-list plain">
            {notes.map((n) => (
              <li key={n.id} className={classNames('ehr-click', n.unread && 'ehr-unread')} onClick={() => p.go('notes', n.id)}>
                <span className="ehr-note-type">{n.type}</span> {n.title} <span className="ehr-dim">· {fmt(n.t)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="ehr-empty">No notes.</div>
        )}
      </div>
    </div>
  );
}

export function ChartReview(p: SectionProps) {
  const { chart, units } = p;
  const hist = chart.labs.filter((l) => l.historical).sort((a, b) => b.collectedAt - a.collectedAt);
  return (
    <div className="ehr-stack">
      <div className="ehr-card">
        <div className="ehr-card-h">Encounters</div>
        {chart.encounters.length ? (
          <table className="ehr-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Department</th>
                <th>Reason</th>
                <th>Summary</th>
              </tr>
            </thead>
            <tbody>
              <tr className="ehr-current-enc">
                <td>Current</td>
                <td>ED visit</td>
                <td>Emergency</td>
                <td>{chart.chiefComplaint}</td>
                <td className="ehr-dim">
                  Arrived {p.fmt(chart.arrivedAt)} by {chart.arrivalMode.toLowerCase()} · {chart.bedLabel}
                </td>
              </tr>
              {chart.encounters.map((e) => (
                <tr key={e.id}>
                  <td className="ehr-nowrap">{e.date}</td>
                  <td>{e.type}</td>
                  <td>{e.department}</td>
                  <td>{e.reason}</td>
                  <td>{e.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="ehr-empty">No prior encounters in this health system. Outside records may exist — consider calling the PCP.</div>
        )}
      </div>
      <div className="ehr-card">
        <div className="ehr-card-h">Historical results (prior encounters)</div>
        {hist.length ? (
          <table className="ehr-table compact">
            <thead>
              <tr>
                <th>When</th>
                <th>Test</th>
                <th>Value</th>
                <th>Flag</th>
                <th>Reference</th>
              </tr>
            </thead>
            <tbody>
              {hist.map((r) => (
                <tr key={r.id} className="ehr-click" onClick={() => p.go('results', r.analyte)}>
                  <td>{p.fmt(r.collectedAt)}</td>
                  <td>{ANALYTES[r.analyte]?.name ?? r.analyte}</td>
                  <td className={classNames('ehr-num', flagClass(r.flag))}>
                    {formatLabValue(r.analyte, r.value, units)} <span className="ehr-unit">{labUnit(r.analyte, units)}</span>
                  </td>
                  <td className={flagClass(r.flag)}>{flagText(r.flag)}</td>
                  <td className="ehr-dim">{refRangeText(r.analyte, chart.sex, units)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="ehr-empty">No historical results.</div>
        )}
      </div>
      <div className="ehr-grid">
        <div className="ehr-card">
          <div className="ehr-card-h">Demographics</div>
          <div className="ehr-kv">
            <span>DOB</span>
            <b>{chart.dob}</b>
          </div>
          <div className="ehr-kv">
            <span>Language</span>
            <b>{chart.language}</b>
          </div>
          <div className="ehr-kv">
            <span>Code status</span>
            <b>{chart.codeStatus}</b>
          </div>
          <div className="ehr-kv">
            <span>Height / weight</span>
            <b>
              {chart.heightCm} cm / {chart.weightKg} kg
            </b>
          </div>
        </div>
        <div className="ehr-card">
          <div className="ehr-card-h">Care team & contacts</div>
          <div className="ehr-kv">
            <span>PCP</span>
            <b>{chart.pcp ? `${chart.pcp.name} — ${chart.pcp.practice} (${chart.pcp.phone})` : 'None on file'}</b>
          </div>
          <div className="ehr-kv">
            <span>Insurance</span>
            <b>{chart.insurance ? `${chart.insurance.payer} · ${chart.insurance.plan} · ID ${chart.insurance.memberId}` : 'Self-pay'}</b>
          </div>
          <div className="ehr-kv">
            <span>Emergency contact</span>
            <b>{chart.emergencyContact ? `${chart.emergencyContact.name} (${chart.emergencyContact.relation}) ${chart.emergencyContact.phone}` : 'None on file'}</b>
          </div>
        </div>
      </div>
    </div>
  );
}
