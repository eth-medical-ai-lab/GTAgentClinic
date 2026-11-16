import { useEffect, useRef, useState } from 'react';
import { resUrl } from '../resCache';
import type { LoadingState } from '../world';
import { PTT_KEY_LABEL } from './Chat';
import { Wordmark } from './Wordmark';
import { browserDemo } from '../demo/mode';
import { client } from '../net';
import { ecgPath, ecgPoints } from './ecgWave';

/** game tips, all true to how this build plays (see HelpPanel) */
const TIPS = browserDemo ? [
  'Marcus, the ED tech, is at the nurses’ station. Ask him where to start.',
  'At the bedside, choose a question or type one of your own.',
  'Open the tablet to read a patient’s chart.',
] : [
  'Sickest first: check each patient’s 1–5 triage badge (ESI 1 = most critical) in your patient list, on your tablet (Tab), or on the tracking board.',
  `Press E (or click someone) to talk to them; hold ${PTT_KEY_LABEL} (under Esc) or 🎤 to speak — letting go sends.`,
  'Chest pain? Order a 12-lead ECG and sign your read in AgentChart within 10 minutes of arrival.',
  'Patients only know their symptoms — talk to family at the bedside, or call GP offices and family from a station phone.',
  'Order labs, imaging, and meds at any workstation, in a patient’s Bedside tab, or via Tab → a patient.',
  'Give nurses verbal orders: “Tom, give 324 mg of aspirin for Bed 2.”',
  'Tests cost money and time; low-value tests cost points.',
  'Staff can make mistakes: check vitals for completeness, and check patient identity.',
  'Hold Shift+W or double-tap W to run, Space to jump, V to switch camera.',
  'Press Tab or right-drag down/right to tuck a conversation away. You can also swipe down (up with reversed scrolling).',
];

/**
 * Comic panels rendered from the game's own characters (scripts/assets/render-loading-art.mjs).
 * `focus` is where a narrow (phone) crop centres.
 */
const PANELS = [
  { id: 'crew', focus: '66% 50%' },
  { id: 'clear', focus: '71% 50%' },
  { id: 'cart', focus: '60% 50%' },
  { id: 'walk', focus: '62% 50%' },
  { id: 'stare', focus: '77% 45%' },
];
const PANEL_MS = 7000;

/**
 * One sequence per page load. The "connecting" screen and the world's loading screen are separate
 * mounts, so the panel and its slow pan carry on across the hand-over instead of starting again.
 */
const seq = { t0: performance.now(), first: Math.floor(Math.random() * PANELS.length) };
const slotNow = () => Math.floor((performance.now() - seq.t0) / PANEL_MS);

function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState(() => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduce(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduce;
}

/** the panel slot (one per PANEL_MS since page load); frozen when motion is reduced */
function useSlot(still: boolean): number {
  const [slot, setSlot] = useState(slotNow);
  useEffect(() => {
    if (still) return;
    let iv = 0;
    const to = window.setTimeout(
      () => {
        setSlot(slotNow());
        iv = window.setInterval(() => setSlot(slotNow()), PANEL_MS);
      },
      PANEL_MS - ((performance.now() - seq.t0) % PANEL_MS) + 20,
    );
    return () => {
      window.clearTimeout(to);
      window.clearInterval(iv);
    };
  }, [still]);
  return slot;
}

const panelUrl = (slot: number) => resUrl(`/res/loading/${PANELS[(seq.first + slot) % PANELS.length].id}.webp`);

/** panels already decoded once: a remount (connecting → world loading) shows them at once */
const loaded = new Set<string>();

/** a panel fades in over the previous one and pans slowly; both are transform/opacity animations */
function Panel({ slot, still }: { slot: number; still: boolean }) {
  const src = panelUrl(slot);
  const [ready, setReady] = useState(() => loaded.has(src));
  const p = PANELS[(seq.first + slot) % PANELS.length];
  // a remount mid-slot continues where the animation was
  const delay = `${-Math.max(0, performance.now() - seq.t0 - slot * PANEL_MS)}ms`;
  return (
    <img
      className={`ls-panel ${slot % 2 ? 'pan-b' : 'pan-a'}${ready ? ' ready' : ''}${still ? ' still' : ''}`}
      src={src}
      alt=""
      aria-hidden
      decoding="async"
      style={{ objectPosition: p.focus, animationDelay: `${delay}, ${delay}` }}
      onLoad={() => {
        loaded.add(src);
        setReady(true);
      }}
      onError={() => setReady(false)}
    />
  );
}

// ── the monitor trace ──

/** one heartbeat (SVG units; baseline y = 26 of 40, R wave to y 4): a realistic, smoothly curved P–QRS–T (ecgWave.ts) */
const BEAT_W = 120;
const BEAT: [number, number][] = ecgPoints(BEAT_W, 26, 22);
const BEAT_PX = 56; // one beat on screen
const BEAT_MS = 1000; // 60/min: calm
const PEN_PX = 150; // where the trace is written; nothing to the right of it yet
const H_PX = 36;
const BEATS = 6; // drawn width: enough to cover the strip plus one beat of scroll
const beatPath = ecgPath(BEATS, BEAT_W, 26, 22);

function beatY(x: number): number {
  const u = ((x % BEAT_W) + BEAT_W) % BEAT_W;
  for (let i = 1; i < BEAT.length; i++) {
    const [x0, y0] = BEAT[i - 1];
    const [x1, y1] = BEAT[i];
    if (u <= x1) return y0 + ((y1 - y0) * (u - x0)) / Math.max(1e-6, x1 - x0);
  }
  return BEAT[0][1];
}

/**
 * An ECG strip that scrolls like a monitor in "scroll" mode, with a bright pen dot where the trace is
 * written. Both run as Web Animations on transform only, so they stay smooth while the main thread is
 * busy compiling shaders. The pen's keyframes are the waveform itself, so it rides the trace exactly.
 */
function Ecg({ still }: { still: boolean }) {
  const track = useRef<SVGSVGElement>(null);
  const pen = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const t = track.current;
    const d = pen.current;
    if (!t || !d) return;
    const k = H_PX / 40;
    const penX = (f: number) => ((PEN_PX + f * BEAT_PX) / BEAT_PX) * BEAT_W; // trace x under the pen at phase f
    if (still || typeof t.animate !== 'function') {
      d.style.transform = `translateY(${beatY(penX(0)) * k}px)`;
      return;
    }
    const scroll = t.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${-BEAT_PX}px)` }], { duration: BEAT_MS, iterations: Infinity });
    const phases = new Set([0, 1]);
    BEAT.forEach(([x], i) => {
      if (i % 3 === 0 || (x > BEAT_W * 0.35 && x < BEAT_W * 0.45)) phases.add(((((x / BEAT_W) * BEAT_PX - PEN_PX) % BEAT_PX) + BEAT_PX) % BEAT_PX / BEAT_PX);
    });
    const frames = [...phases].sort((a, b) => a - b).map((f) => ({ offset: f, transform: `translateY(${(beatY(penX(f)) * k).toFixed(2)}px)` }));
    const ride = d.animate(frames, { duration: BEAT_MS, iterations: Infinity });
    // same start on the document timeline: the pen stays on the trace
    const now = document.timeline?.currentTime ?? null;
    if (now !== null) scroll.startTime = ride.startTime = now;
    return () => {
      scroll.cancel();
      ride.cancel();
    };
  }, [still]);
  return (
    <div className="ls-ecg" aria-hidden style={{ width: PEN_PX + 6, height: H_PX }}>
      <div className="ls-ecg-strip" style={{ width: PEN_PX }}>
        <svg ref={track} width={BEATS * BEAT_PX} height={H_PX} viewBox={`0 0 ${BEATS * BEAT_W} 40`} preserveAspectRatio="none">
          <path d={beatPath} />
        </svg>
      </div>
      <span ref={pen} className="ls-ecg-pen" style={{ left: PEN_PX - 4 }} />
    </div>
  );
}

/**
 * Full-screen loading screen: shown while connecting and while the 3D world starts (GPU renderer,
 * textures, people, shader compilation), then fades out on the first clean frames. No progress bar:
 * the world's progress jumps (assets load fast, the first frames stall), so a bar only misled.
 */
export function LoadingScreen({ state, title }: { state: LoadingState; title: string }) {
  const still = useReducedMotion();
  const slot = useSlot(still);
  const [tip, setTip] = useState(() => Math.floor(Math.random() * TIPS.length));
  const [gone, setGone] = useState(false);
  useEffect(() => {
    const id = window.setInterval(() => setTip((t) => (t + 1) % TIPS.length), 5500);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => {
    if (!state.done) {
      setGone(false);
      return;
    }
    const id = window.setTimeout(() => setGone(true), 700); // after the fade-out
    return () => window.clearTimeout(id);
  }, [state.done]);
  // warm the next panel a little before it is due
  useEffect(() => {
    if (still) return;
    const id = window.setTimeout(() => {
      const img = new Image();
      img.decoding = 'async';
      img.src = panelUrl(slot + 1);
    }, PANEL_MS / 2);
    return () => window.clearTimeout(id);
  }, [slot, still]);
  if (gone) return null;
  return (
    <div className={`loading-screen${state.done ? ' done' : ''}`} aria-busy={!state.done}>
      <div className="ls-art">
        {!still && slot > 0 && <Panel key={slot - 1} slot={slot - 1} still={still} />}
        <Panel key={slot} slot={slot} still={still} />
      </div>
      <div className="ls-shade" />
      <div className="ls-inner">
        <Wordmark className="ls-logo" />
        {/* what GTA stands for here, spelled out once */}
        <p className="ls-expansion">Grand Therapy Agent Clinic</p>
        <h1 className="ls-title">
          <span>{title}</span>
        </h1>
        <div className="ls-status">
          <Ecg still={still} />
          <span className="ls-stage" role="status">
            {state.error ? 'Graphics unavailable' : state.done ? 'Ready' : `${state.stage}…`}
          </span>
        </div>
        {state.error ? <div role="alert"><p>{state.error}</p>
          <button className="btn" onClick={() => client.leaveSolo()}>{browserDemo ? 'Back to demo menu' : 'Back to the menu'}</button></div> :
        <p className="ls-tip" key={tip}>
          <b>Tip</b> {TIPS[tip]}
        </p>}
      </div>
    </div>
  );
}
