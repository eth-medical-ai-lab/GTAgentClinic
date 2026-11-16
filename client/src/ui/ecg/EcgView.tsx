/**
 * 12-lead ECG on standard grid paper: 25 mm/s, 10 mm/mV, 3×4 layout (2.5 s per
 * column, simultaneous acquisition) + 10 s lead II rhythm strip (+ V4R strip for
 * right-sided recordings). Drawn in SVG with millimetre user units.
 */
import { useId, useMemo } from 'react';
import type { EcgParams, Lead } from '../../../../shared/types';
import { beatTimes, sampleLead } from './synth';

const MM_PER_S = 25;
const MM_PER_MV = 10;
const LEFT = 6; // calibration pulse area
const COL_S = 2.5;
const PAPER_W = LEFT + 4 * COL_S * MM_PER_S + 2; // 258 mm
const ROW_H = 33;
const TOP = 3;
const HZ = 400;

const GRID: Lead[][] = [
  ['I', 'aVR', 'V1', 'V4'],
  ['II', 'aVL', 'V2', 'V5'],
  ['III', 'aVF', 'V3', 'V6'],
];

function toPath(samples: number[], x0: number, base: number): string {
  const dx = MM_PER_S / HZ;
  let d = '';
  for (let i = 0; i < samples.length; i++) {
    const x = x0 + i * dx;
    const y = base - samples[i] * MM_PER_MV;
    d += (i === 0 ? 'M' : 'L') + x.toFixed(2) + ' ' + y.toFixed(2);
  }
  return d;
}

function calPulse(base: number): string {
  return `M0.6 ${base} L1.6 ${base} L1.6 ${base - 10} L3.6 ${base - 10} L3.6 ${base} L5.4 ${base}`;
}

export interface EcgViewProps {
  params: EcgParams;
  /** draws an additional 10 s V4R strip */
  rightSided?: boolean;
  className?: string;
  title?: string;
}

export function EcgView({ params, rightSided, className, title }: EcgViewProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const showV4R = rightSided || params.rightSided || params.st?.V4R !== undefined;
  const rows = 4 + (showV4R ? 1 : 0);
  const height = TOP + rows * ROW_H + 7;

  const traces = useMemo(() => {
    const beats = beatTimes(params, 10.5);
    const out: { d: string; label: string; lx: number; ly: number }[] = [];
    GRID.forEach((rowLeads, ri) => {
      const base = TOP + ri * ROW_H + ROW_H * 0.58;
      rowLeads.forEach((lead, ci) => {
        const t0 = ci * COL_S;
        const samples = sampleLead(lead, params, t0, t0 + COL_S, HZ, beats);
        const x0 = LEFT + ci * COL_S * MM_PER_S;
        out.push({ d: toPath(samples, x0, base), label: lead, lx: x0 + 1.2, ly: base - 11.5 });
      });
    });
    const rBase = TOP + 3 * ROW_H + ROW_H * 0.58;
    out.push({ d: toPath(sampleLead('II', params, 0, 10, HZ, beats), LEFT, rBase), label: 'II', lx: LEFT + 1.2, ly: rBase - 11.5 });
    if (showV4R) {
      const vBase = TOP + 4 * ROW_H + ROW_H * 0.58;
      out.push({ d: toPath(sampleLead('V4R', params, 0, 10, HZ, beats), LEFT, vBase), label: 'V4R', lx: LEFT + 1.2, ly: vBase - 11.5 });
    }
    return out;
  }, [params, showV4R]);

  const bases = Array.from({ length: rows }, (_, i) => TOP + i * ROW_H + ROW_H * 0.58);
  const sepX = [1, 2, 3].map((c) => LEFT + c * COL_S * MM_PER_S);

  return (
    <svg className={className} viewBox={`0 0 ${PAPER_W} ${height}`} preserveAspectRatio="xMidYMin meet" role="img" aria-label={title ?? '12-lead ECG'}>
      <defs>
        <pattern id={`s${uid}`} width="1" height="1" patternUnits="userSpaceOnUse">
          <path d="M1 0 L0 0 0 1" fill="none" stroke="#f2b8b5" strokeWidth="0.06" />
        </pattern>
        <pattern id={`b${uid}`} width="5" height="5" patternUnits="userSpaceOnUse">
          <rect width="5" height="5" fill={`url(#s${uid})`} />
          <path d="M5 0 L0 0 0 5" fill="none" stroke="#e08884" strokeWidth="0.16" />
        </pattern>
      </defs>
      <rect x="0" y="0" width={PAPER_W} height={height} fill="#fff8f6" />
      <rect x="0" y="0" width={PAPER_W} height={height - 5} fill={`url(#b${uid})`} />
      {bases.map((b, i) => (
        <path key={`cal${i}`} d={calPulse(b)} fill="none" stroke="#151515" strokeWidth="0.28" strokeLinejoin="round" />
      ))}
      {[0, 1, 2].map((ri) =>
        sepX.map((x) => (
          <line key={`sep${ri}-${x}`} x1={x} x2={x} y1={bases[ri] - 3} y2={bases[ri] + 3} stroke="#151515" strokeWidth="0.28" />
        )),
      )}
      {traces.map((tr, i) => (
        <g key={i}>
          <path d={tr.d} fill="none" stroke="#141414" strokeWidth="0.26" strokeLinejoin="round" strokeLinecap="round" />
          <text x={tr.lx} y={tr.ly} fontSize="3.1" fontFamily="Arial, Helvetica, sans-serif" fontWeight="700" fill="#2a2a2a">
            {tr.label}
          </text>
        </g>
      ))}
      <text x={PAPER_W - 2} y={height - 1.6} fontSize="2.6" textAnchor="end" fontFamily="Arial, Helvetica, sans-serif" fill="#7a5a58">
        25 mm/s · 10 mm/mV · 0.05–150 Hz · AgentChart ECG
      </text>
    </svg>
  );
}
