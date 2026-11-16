/**
 * The GTAgentClinic wordmark: "GT" in white, the "A" in warm red, "gentClinic" in black with a white
 * keyline. The red A belongs to both halves: it ends GTA and starts Agent. Set in Anton (SIL OFL 1.1,
 * bundled in client/public/res/fonts), with a black extrusion and a red pulse underneath.
 * Genre-inspired, not copied: no Pricedown, no boxed stack, no emblem.
 *
 * Geometry is fixed (Anton at 200 units, baseline y = 0: ink x 6…1076, y −185…25), and textLength
 * pins the advance, so a fallback font can't spill out of the viewBox before Anton has loaded.
 */
import type { SVGProps } from 'react';
import { ecgPulse } from './ecgWave';

const TEXT = { x: 0, y: 0, fontFamily: "Anton, 'Arial Narrow', Impact, sans-serif", fontSize: 200, letterSpacing: 1, textLength: 1082, lengthAdjust: 'spacingAndGlyphs' } as const;

/**
 * a flat line and one smooth heartbeat under the word (x 6…1076, baseline y 98, R wave up to y 56;
 * ecgWave.ts). The R wave's casing stays ~20 units clear of the letters' black casing (to y ~25):
 * at baseline 78 it touched them.
 */
const PULSE = ecgPulse(6, 1076, 530, 560, 98, 42);

/** the brand's warm red (styles.css --ac-accent) */
const RED = '#d94a38';

type Part = SVGProps<SVGTSpanElement>;
function Word({ gt, a, gent, ...rest }: { gt?: Part; a?: Part; gent?: Part } & SVGProps<SVGTextElement>) {
  return (
    <text {...TEXT} strokeLinejoin="round" paintOrder="stroke" {...rest}>
      <tspan {...gt}>GT</tspan>
      <tspan {...a}>A</tspan>
      <tspan {...gent}>gentClinic</tspan>
    </text>
  );
}

export function Wordmark({ className, pulse = true }: { className?: string; pulse?: boolean }) {
  return (
    <svg className={className} viewBox={pulse ? '-8 -200 1112 324' : '-8 -200 1112 262'} role="img" aria-label="GTAgentClinic">
      {/* extrusion and casing */}
      {[8, 7, 6, 5, 4, 3, 2, 1].map((i) => (
        <Word key={i} transform={`translate(${i * 1.6} ${i * 2})`} fill="#000" stroke="#000" strokeWidth={18} />
      ))}
      <Word fill="#000" stroke="#000" strokeWidth={18} />
      {pulse && <path d={PULSE} fill="none" stroke="#000" strokeWidth={22} strokeLinejoin="round" strokeLinecap="round" />}
      {pulse && <path className="wm-pulse" d={PULSE} fill="none" stroke={RED} strokeWidth={9} strokeLinejoin="round" strokeLinecap="round" />}
      {/* the face: white GT and a red A with a black line, black gentClinic with a white keyline */}
      <Word gt={{ fill: '#fff', stroke: '#000', strokeWidth: 8 }} a={{ fill: RED, stroke: '#000', strokeWidth: 8 }} gent={{ fill: '#0b0b0b', stroke: '#fff', strokeWidth: 12 }} />
    </svg>
  );
}
