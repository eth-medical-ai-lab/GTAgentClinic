import { useMemo, useState } from 'react';
import { ANALYTES, refRange } from '../../../../../shared/catalog';
import type { LabResultView, LabSection } from '../../../../../shared/types';
import { convertLab, formatLabValue, labUnit, refRangeText } from '../../../../../shared/units';
import { TrendChart, type TrendPoint } from '../TrendChart';
import { classNames, flagClass, flagText, isActiveOrder } from '../util';
import type { SectionProps } from './common';

const ORDER_INDEX: Record<string, number> = Object.fromEntries(Object.keys(ANALYTES).map((k, i) => [k, i]));
const SECTION_ORDER: LabSection[] = ['Point of Care', 'Blood Gas', 'Hematology', 'Chemistry', 'Cardiac', 'Coagulation', 'Inflammatory', 'Urinalysis', 'Endocrine', 'Toxicology', 'Microbiology', 'Blood Bank'];

export function Results(p: SectionProps & { analyte?: string; setAnalyte: (a?: string) => void }) {
  const { chart, units, fmt } = p;
  const current = useMemo(() => chart.labs.filter((l) => !l.historical), [chart.labs]);
  const sections = useMemo(() => {
    const m = new Map<LabSection, number>();
    for (const r of current) {
      const s = ANALYTES[r.analyte]?.section;
      if (s) m.set(s, (m.get(s) ?? 0) + 1);
    }
    return SECTION_ORDER.filter((s) => m.has(s)).map((s) => ({ s, n: m.get(s)! }));
  }, [current]);
  const [sel, setSel] = useState<LabSection | 'All'>('All');
  const pending = chart.orders.filter((o) => o.category === 'lab' && isActiveOrder(o));

  if (p.analyte) return <Trend {...p} analyte={p.analyte} />;

  const shown = sel === 'All' ? current : current.filter((r) => ANALYTES[r.analyte]?.section === sel);
  return (
    <div className="ehr-results">
      <div className="ehr-subnav">
        <div className="ehr-subnav-h">Result categories</div>
        <button className={classNames('ehr-subnav-b', sel === 'All' && 'on')} onClick={() => setSel('All')}>
          All results <span className="ehr-count">{current.length}</span>
        </button>
        {sections.map(({ s, n }) => (
          <button key={s} className={classNames('ehr-subnav-b', sel === s && 'on')} onClick={() => setSel(s)}>
            {s} <span className="ehr-count">{n}</span>
          </button>
        ))}
        <div className="ehr-subnav-h" style={{ marginTop: 14 }}>
          Pending <span className="ehr-count">{pending.length}</span>
        </div>
        {pending.length === 0 && <div className="ehr-subnav-note">No pending lab orders.</div>}
        {pending.map((o) => (
          <div key={o.id} className="ehr-subnav-note">
            <b>{o.name}</b>
            <br />
            {o.statusText ?? o.status}
            {o.collectedAt !== undefined ? ` · coll. ${fmt(o.collectedAt)}` : ` · ordered ${fmt(o.placedAt)}`}
          </div>
        ))}
      </div>
      <div className="ehr-results-main">
        {shown.length === 0 ? (
          <div className="ehr-empty big">No resulted labs{sel !== 'All' ? ` in ${sel}` : ''} for this encounter yet.</div>
        ) : (
          (sel === 'All' ? sections.map((x) => x.s) : [sel]).map((s) => <ResultGrid key={s} {...p} section={s as LabSection} labs={shown.filter((r) => ANALYTES[r.analyte]?.section === s)} />)
        )}
        <div className="ehr-hint">Click a test name to open its trend. Times are specimen collection times; ‘!!’ marks critical values.</div>
      </div>
    </div>
  );
}

function ResultGrid(p: SectionProps & { section: LabSection; labs: LabResultView[]; setAnalyte: (a?: string) => void }) {
  const { labs, units, chart, fmt } = p;
  const times = [...new Set(labs.map((l) => l.collectedAt))].sort((a, b) => a - b);
  const analytes = [...new Set(labs.map((l) => l.analyte))].sort((a, b) => (ORDER_INDEX[a] ?? 999) - (ORDER_INDEX[b] ?? 999));
  const cell = new Map<string, LabResultView>();
  for (const l of labs) cell.set(`${l.analyte}@${l.collectedAt}`, l);
  return (
    <div className="ehr-card ehr-resgrid">
      <div className="ehr-card-h">{p.section}</div>
      <div className="ehr-scroll-x">
        <table className="ehr-table ehr-labtable">
          <thead>
            <tr>
              <th className="ehr-sticky">Component</th>
              {times.map((t) => (
                <th key={t} className="ehr-num">
                  {fmt(t)}
                  <div className="ehr-th-sub">collected</div>
                </th>
              ))}
              <th>Reference</th>
              <th>Units</th>
            </tr>
          </thead>
          <tbody>
            {analytes.map((a) => {
              const def = ANALYTES[a];
              return (
                <tr key={a}>
                  <td className="ehr-sticky">
                    <button className="ehr-linkcell" onClick={() => p.setAnalyte(a)} title="Open trend">
                      {def?.name ?? a}
                    </button>
                  </td>
                  {times.map((t) => {
                    const r = cell.get(`${a}@${t}`);
                    return (
                      <td key={t} className={classNames('ehr-num', r && flagClass(r.flag))} title={r?.comment}>
                        {r ? (
                          <>
                            {formatLabValue(a, r.value, units)}
                            {r.flag && <span className="ehr-flag"> {flagText(r.flag)}</span>}
                          </>
                        ) : (
                          ''
                        )}
                      </td>
                    );
                  })}
                  <td className="ehr-dim ehr-nowrap">{refRangeText(a, chart.sex, units)}</td>
                  <td className="ehr-dim ehr-nowrap">{labUnit(a, units)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Trend(p: SectionProps & { analyte: string; setAnalyte: (a?: string) => void }) {
  const { chart, units, analyte, fmt } = p;
  const def = ANALYTES[analyte];
  const all = chart.labs.filter((l) => l.analyte === analyte).sort((a, b) => b.collectedAt - a.collectedAt);
  const current = all.filter((l) => !l.historical);
  const hist = all.filter((l) => l.historical && typeof l.value === 'number');
  const numeric = current.filter((l) => typeof l.value === 'number');
  const points: TrendPoint[] = numeric.map((l) => ({
    t: l.collectedAt,
    value: convertLab(analyte, l.value as number, units),
    label: formatLabValue(analyte, l.value, units),
    flag: l.flag,
  }));
  const rr = def ? refRange(def, chart.sex) : undefined;
  const cv = (v?: number) => (v === undefined ? undefined : convertLab(analyte, v, units));
  const baseline = hist[0] ? { value: convertLab(analyte, hist[0].value as number, units), label: `Prior ${formatLabValue(analyte, hist[0].value, units)} (${fmt(hist[0].collectedAt)})` } : undefined;
  const siblings = [...new Set(chart.labs.filter((l) => ANALYTES[l.analyte]?.section === def?.section).map((l) => l.analyte))];

  let delta: string | null = null;
  if (numeric.length >= 2) {
    const [a, b] = [numeric[0].value as number, numeric[1].value as number];
    const d = convertLab(analyte, a - b, units);
    const pct = b !== 0 ? ((a - b) / Math.abs(b)) * 100 : 0;
    delta = `${d >= 0 ? '+' : ''}${d.toFixed(def?.decimals ?? 1)} (${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%) vs previous`;
  }

  return (
    <div className="ehr-trendview">
      <div className="ehr-trend-top">
        <button className="ehr-btn" onClick={() => p.setAnalyte(undefined)}>
          ← Results
        </button>
        <div>
          <div className="ehr-trend-title">{def?.name ?? analyte}</div>
          <div className="ehr-dim">
            {def?.section} · Reference {refRangeText(analyte, chart.sex, units) || '—'} {labUnit(analyte, units)}
            {delta && <span className="ehr-delta"> · Latest {delta}</span>}
          </div>
        </div>
        <div className="ehr-trend-sibs">
          {siblings.map((s) => (
            <button key={s} className={classNames('ehr-pill', s === analyte && 'on')} onClick={() => p.setAnalyte(s)}>
              {ANALYTES[s]?.short ?? s}
            </button>
          ))}
        </div>
      </div>
      <div className="ehr-card">
        {points.length ? (
          <TrendChart
            points={points}
            timeLabel={(t) => fmt(t)}
            refLow={cv(rr?.[0])}
            refHigh={cv(rr?.[1])}
            critLow={cv(def?.critLow)}
            critHigh={cv(def?.critHigh)}
            baseline={baseline}
            unit={labUnit(analyte, units)}
            width={1000}
            height={310}
          />
        ) : (
          <div className="ehr-empty big">{current.length ? 'Text result — no graph available.' : 'No results in this encounter.'}</div>
        )}
      </div>
      <div className="ehr-card">
        <div className="ehr-card-h">All values</div>
        <table className="ehr-table compact">
          <thead>
            <tr>
              <th>Collected</th>
              <th>Resulted</th>
              <th>Value</th>
              <th>Flag</th>
              <th>Comment</th>
            </tr>
          </thead>
          <tbody>
            {all.map((r) => (
              <tr key={r.id} className={r.historical ? 'ehr-hist' : ''}>
                <td>{fmt(r.collectedAt)}</td>
                <td>{r.historical ? 'prior encounter' : fmt(r.resultedAt)}</td>
                <td className={classNames('ehr-num', flagClass(r.flag))}>
                  {formatLabValue(analyte, r.value, units)} <span className="ehr-unit">{labUnit(analyte, units)}</span>
                </td>
                <td className={flagClass(r.flag)}>{flagText(r.flag)}</td>
                <td className="ehr-dim">{r.comment ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
