/**
 * AgentChart grows out of the monitor you logged into, and shrinks back into it when you close it.
 * The 3D side (sitting down, the badge, the camera easing to the screen) is world/workstation.ts;
 * this is the hand-over: the UI starts as the monitor's projected screen quad (a CSS matrix3d, so
 * it matches the screen even seen at an angle) and expands to nearly full screen, the backdrop
 * fading in. Closing reverses it, then the world signs you out and stands you up. Other ways of
 * opening AgentChart (the tablet: Tab → a patient, or its order button) open it as before.
 * E, Esc or a click finishes a morph at once; with reduced motion there is none.
 */
import { useLayoutEffect, useReducer, useRef, type ReactNode } from 'react';
import { store, type Panel } from '../store';
import type { InteractTarget, WorldApi } from '../world';
import { lerpQuad, quadTransform, rectQuad, type Quad } from './quadMorph';

type ComputerTarget = Extract<InteractTarget, { kind: 'computer' }>;

/** at the medication dispenser (Ehr notice) */
export const DISPENSER_NOTE = 'Medication dispenser · the nurse pulls each dose once pharmacy has verified the order. Review the MAR and your medication orders here.';

/** the patient a login is for, decided as you sit down (the tablet closes then) */
let context: { propId: string; patientId?: string } | null = null;

/**
 * App's world callback. 'check': may the player log in (`allowed`: App would open AgentChart for
 * this computer at all). 'begin': they sit down; the chart will open on the patient they were
 * talking to (tablet open), else on the patient in the bay a bedside computer serves, else on the
 * tracking board.
 */
export function workstationEvent(phase: 'check' | 'begin', t: ComputerTarget, allowed: boolean): boolean {
  if (!allowed) return false;
  if (phase === 'begin') {
    const s = store.get();
    const p = s.panel;
    let patientId = p?.kind === 'npc' ? s.view?.npcs.find((n) => n.id === p.npcId)?.patientId : undefined;
    if (!patientId && t.bedside) patientId = s.view?.board.find((r) => r.bed === t.bedside && r.flowStatus !== 'Departed')?.id;
    context = { propId: t.propId, patientId };
    store.set({ panel: null, tabletMin: false });
  }
  return true;
}

/** App: the AgentChart panel a workstation opens */
export function workstationPanel(t: ComputerTarget): Panel {
  const c = context?.propId === t.propId ? context : null;
  context = null;
  return { kind: 'ehr', patientId: c?.patientId, section: t.section };
}

const easeOut = (t: number) => 1 - (1 - t) ** 3;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * Morph the EHR's root between the monitor's quad and its own box. Returns a cancel function that
 * also clears every inline style. E / Esc / a click finish it at once.
 */
function morph(host: HTMLElement | null, screen: [number, number][], dir: 'in' | 'out', ms: number, done: (skipped: boolean) => void): () => void {
  const back = host?.querySelector<HTMLElement>('.ehr-backdrop');
  const root = host?.querySelector<HTMLElement>('.ehr-root');
  if (!back || !root) {
    done(false);
    return () => {};
  }
  let skipped = false;
  // the root's own (untransformed) box; the backdrop is fixed at the viewport's corner
  const br = back.getBoundingClientRect();
  const w = root.offsetWidth;
  const h = root.offsetHeight;
  const ox = br.left + root.offsetLeft;
  const oy = br.top + root.offsetTop;
  const monitor = screen.map(([x, y]) => [x - ox, y - oy]) as Quad;
  const full = rectQuad(0, 0, w, h);
  const unlisten = () => {
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('pointerdown', onPointer, true);
  };
  const clear = () => {
    for (const p of ['transform', 'transform-origin', 'opacity', 'will-change']) root.style.removeProperty(p);
    back.style.removeProperty('background-color');
    back.style.removeProperty('pointer-events');
    unlisten();
  };
  let t0 = performance.now();
  let raf = 0;
  const step = () => {
    const k = Math.min(1, (performance.now() - t0) / ms);
    const e = dir === 'in' ? easeOut(k) : easeInOut(k);
    // p: 0 = on the monitor, 1 = full size
    const p = dir === 'in' ? e : 1 - e;
    const tf = quadTransform(w, h, lerpQuad(monitor, full, p));
    if (tf) root.style.transform = tf;
    // fade over the first / last stretch, so the 3D screen and the page blend at the hand-over
    root.style.opacity = String(dir === 'in' ? Math.min(1, k / 0.24) : Math.min(1, (1 - k) / 0.24));
    back.style.backgroundColor = `rgba(4, 8, 10, ${(0.72 * p).toFixed(3)})`;
    if (k < 1) raf = requestAnimationFrame(step);
    else {
      // grown: plain page again; shrunk away: stays invisible until React removes it (no flash of the full UI)
      if (dir === 'in') clear();
      else unlisten();
      done(skipped);
    }
  };
  const finish = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    skipped = true;
    t0 = -1e9;
  };
  function onKey(e: KeyboardEvent) {
    if (!e.repeat && (e.code === 'KeyE' || e.key === 'Escape')) finish(e);
  }
  function onPointer(e: PointerEvent) {
    finish(e);
  }
  root.style.transformOrigin = '0 0';
  root.style.willChange = 'transform, opacity';
  back.style.pointerEvents = 'none';
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('pointerdown', onPointer, true);
  step();
  return () => {
    cancelAnimationFrame(raf);
    clear();
  };
}

/**
 * Wraps the Ehr element (children; null/false when AgentChart is closed). On a workstation login
 * it zooms out of the monitor, and on close it keeps the UI on screen while it shrinks back in.
 */
export function EhrTransition({ world, children }: { world: WorldApi | null; children: ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const open = !!children;
  const last = useRef<ReactNode>(null);
  const wasOpen = useRef(false);
  const closing = useRef(false);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const ws = world?.workstation;
  if (open) last.current = children;
  // just closed a workstation's AgentChart: keep it until it has shrunk back into the monitor
  const keep = !open && !!last.current && (closing.current || (wasOpen.current && ws?.phase() === 'open' && !store.get().panel));

  useLayoutEffect(() => {
    const was = wasOpen.current;
    wasOpen.current = open;
    if (open === was || !ws) {
      if (!open) last.current = null;
      return;
    }
    if (open) {
      // the zoom has reached the monitor: grow out of its screen
      if (ws.phase() !== 'handoff') return;
      ws.ui('open');
      const q = ws.screenQuad();
      const ms = ws.morphMs('in');
      if (!q || !ms) return;
      return morph(host.current, q, 'in', ms, () => undefined);
    }
    if (ws.phase() !== 'open') {
      last.current = null;
      return;
    }
    if (store.get().panel) {
      // another panel took the screen (Tab, help): sign out and stand up at once
      ws.ui('abort');
      last.current = null;
      return;
    }
    const q = ws.screenQuad();
    const ms = ws.morphMs('out');
    // skipped (E, Esc, a click): the rest of the sign-out happens at once too
    const end = (skipped: boolean) => {
      closing.current = false;
      last.current = null;
      ws.ui(skipped ? 'abort' : 'closed');
      rerender();
    };
    if (!q || !ms) {
      end(false);
      return;
    }
    closing.current = true;
    let finished = false;
    const stop = morph(host.current, q, 'out', ms, (skipped) => {
      finished = true;
      end(skipped);
    });
    return () => {
      stop();
      // reopened mid-shrink: still signed in, carry on
      if (!finished) closing.current = false;
    };
  }, [open, ws]);

  return (
    <div className="ehr-xfer" ref={host}>
      {open ? children : keep ? last.current : null}
    </div>
  );
}
