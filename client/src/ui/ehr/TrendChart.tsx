/**
 * Lab / vital trend chart (SVG) with reference-range band, critical thresholds,
 * flagged points and an optional dashed historical baseline.
 */
import type { ResultFlag } from '../../../../shared/types';
import { niceTicks } from './util';

export interface TrendPoint {
  t: number; // game seconds
  value: number; // already converted to display units
  label: string; // formatted value
  flag?: ResultFlag;
}

export interface TrendChartProps {
  points: TrendPoint[];
  timeLabel: (t: number) => string;
  refLow?: number;
  refHigh?: number;
  critLow?: number;
  critHigh?: number;
  baseline?: { value: number; label: string };
  unit?: string;
  width?: number;
  height?: number;
}

export function TrendChart({ points, timeLabel, refLow, refHigh, critLow, critHigh, baseline, unit, width = 720, height = 280 }: TrendChartProps) {
  const pad = { l: 56, r: 24, t: 18, b: 38 };
  const W = width - pad.l - pad.r;
  const H = height - pad.t - pad.b;
  if (points.length === 0) return <div className="ehr-empty">No results to trend.</div>;

  const ts = points.map((p) => p.t);
  let tMin = Math.min(...ts);
  let tMax = Math.max(...ts);
  if (tMax - tMin < 1800) {
    const mid = (tMin + tMax) / 2;
    tMin = mid - 1800;
    tMax = mid + 1800;
  }
  const tPad = (tMax - tMin) * 0.08;
  tMin -= tPad;
  tMax += tPad;

  const vals = points.map((p) => p.value);
  const extra = [refLow, refHigh, baseline?.value].filter((x): x is number => x !== undefined && Number.isFinite(x));
  let vMin = Math.min(...vals, ...extra);
  let vMax = Math.max(...vals, ...extra);
  for (const c of [critLow, critHigh]) {
    if (c !== undefined && c > vMin - (vMax - vMin) * 0.6 && c < vMax + (vMax - vMin) * 0.6) {
      vMin = Math.min(vMin, c);
      vMax = Math.max(vMax, c);
    }
  }
  const vPad = (vMax - vMin || Math.abs(vMax) || 1) * 0.15;
  vMin -= vPad;
  vMax += vPad;
  if (vMin < 0 && Math.min(...vals) >= 0) vMin = Math.max(vMin, 0);
  const ticks = niceTicks(vMin, vMax, 5).filter((v) => v >= vMin && v <= vMax);

  const x = (t: number) => pad.l + ((t - tMin) / (tMax - tMin)) * W;
  const y = (v: number) => pad.t + (1 - (v - vMin) / (vMax - vMin)) * H;

  const sorted = [...points].sort((a, b) => a.t - b.t);
  const line = sorted.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ');

  const timeTicks: number[] = [];
  const stepT = Math.max(900, Math.ceil((tMax - tMin) / 6 / 900) * 900);
  for (let t = Math.ceil(tMin / stepT) * stepT; t <= tMax; t += stepT) timeTicks.push(t);

  const bandTop = refHigh !== undefined ? y(Math.min(refHigh, vMax)) : undefined;
  const bandBot = refLow !== undefined ? y(Math.max(refLow, vMin)) : undefined;

  return (
    <svg className="ehr-trend" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Trend chart">
      <rect x={pad.l} y={pad.t} width={W} height={H} fill="#fbfcfd" stroke="#d5dbe0" />
      {bandTop !== undefined && bandBot !== undefined && bandBot > bandTop && (
        <rect x={pad.l} y={bandTop} width={W} height={bandBot - bandTop} fill="#e3f1ea" />
      )}
      {ticks.map((v) => (
        <g key={`y${v}`}>
          <line x1={pad.l} x2={pad.l + W} y1={y(v)} y2={y(v)} stroke="#e7ebee" />
          <text x={pad.l - 8} y={y(v) + 4} fontSize="11" textAnchor="end" fill="#5b6770">
            {Number.isInteger(v) ? v : v.toFixed(Math.abs(v) < 10 ? 1 : 0)}
          </text>
        </g>
      ))}
      {timeTicks.map((t) => (
        <g key={`x${t}`}>
          <line x1={x(t)} x2={x(t)} y1={pad.t} y2={pad.t + H} stroke="#eef1f3" />
          <text x={x(t)} y={pad.t + H + 16} fontSize="11" textAnchor="middle" fill="#5b6770">
            {timeLabel(t)}
          </text>
        </g>
      ))}
      {critHigh !== undefined && critHigh >= vMin && critHigh <= vMax && (
        <g>
          <line x1={pad.l} x2={pad.l + W} y1={y(critHigh)} y2={y(critHigh)} stroke="#c92a2a" strokeDasharray="5 4" />
          <text x={pad.l + W - 4} y={y(critHigh) - 4} fontSize="10" textAnchor="end" fill="#c92a2a">
            critical ≥ {critHigh}
          </text>
        </g>
      )}
      {critLow !== undefined && critLow >= vMin && critLow <= vMax && (
        <g>
          <line x1={pad.l} x2={pad.l + W} y1={y(critLow)} y2={y(critLow)} stroke="#c92a2a" strokeDasharray="5 4" />
          <text x={pad.l + W - 4} y={y(critLow) + 13} fontSize="10" textAnchor="end" fill="#c92a2a">
            critical ≤ {critLow}
          </text>
        </g>
      )}
      {baseline && baseline.value >= vMin && baseline.value <= vMax && (
        <g>
          <line x1={pad.l} x2={pad.l + W} y1={y(baseline.value)} y2={y(baseline.value)} stroke="#6b5bd2" strokeDasharray="2 4" />
          <text x={pad.l + 6} y={y(baseline.value) - 5} fontSize="10" fill="#6b5bd2">
            {baseline.label}
          </text>
        </g>
      )}
      <path d={line} fill="none" stroke="#0f6e6e" strokeWidth="2.2" />
      {sorted.map((p, i) => {
        const crit = p.flag === 'HH' || p.flag === 'LL';
        const abn = !!p.flag && !crit;
        return (
          <g key={i}>
            <circle cx={x(p.t)} cy={y(p.value)} r={crit ? 6 : 5} fill={crit ? '#c92a2a' : abn ? '#d9480f' : '#0f6e6e'} stroke="#fff" strokeWidth="2">
              <title>{`${timeLabel(p.t)} — ${p.label}${unit ? ' ' + unit : ''}${p.flag ? ' (' + p.flag + ')' : ''}`}</title>
            </circle>
            <text x={x(p.t)} y={y(p.value) - 11} fontSize="12" fontWeight="700" textAnchor="middle" fill={crit ? '#c92a2a' : '#1f2d33'}>
              {p.label}
            </text>
          </g>
        );
      })}
      <text x={pad.l} y={height - 6} fontSize="10" fill="#8a969d">
        {unit ? `Units: ${unit}` : ''}
        {refLow !== undefined || refHigh !== undefined ? '   ▇ reference range' : ''}
      </text>
    </svg>
  );
}

export function Sparkline({ values, width = 110, height = 26, abnormal }: { values: number[]; width?: number; height?: number; abnormal?: boolean }) {
  const vs = values.filter((v) => Number.isFinite(v));
  if (vs.length < 2) return <svg width={width} height={height} />;
  const min = Math.min(...vs);
  const max = Math.max(...vs);
  const span = max - min || 1;
  const pts = vs.map((v, i) => `${((i / (vs.length - 1)) * (width - 6) + 3).toFixed(1)},${(height - 4 - ((v - min) / span) * (height - 8)).toFixed(1)}`);
  const last = pts[pts.length - 1].split(',');
  return (
    <svg width={width} height={height} className="ehr-spark">
      <polyline points={pts.join(' ')} fill="none" stroke={abnormal ? '#d9480f' : '#0f6e6e'} strokeWidth="1.6" />
      <circle cx={last[0]} cy={last[1]} r="2.4" fill={abnormal ? '#d9480f' : '#0f6e6e'} />
    </svg>
  );
}
