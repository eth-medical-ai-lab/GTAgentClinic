/**
 * Putting a panel away with a gesture, as with the patient tablet (useTuck in NpcPanel.tsx): a
 * two-finger swipe down on the trackpad (macOS natural scrolling: fingers down = wheel deltaY < 0)
 * or a right-button drag down/right slides it off, and past a threshold it tucks away (onTuck runs
 * after the slide-out). Over a scrollable list the swipe only counts once that list is scrolled to
 * the top, and not straight after a scroll, so momentum from reading back can't tuck it by accident.
 * Once a pull has begun, it continues even where the sliding panel has left the cursor.
 * Used by the watcher's tablet and the AI resident's transcript panel (observe mode).
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent } from 'react';

/** a scrollable element between `t` and `root` that can still scroll in the wheel's direction */
function canScroll(t: HTMLElement | null, root: HTMLElement, dy: number): boolean {
  for (let el = t; el && el !== root; el = el.parentElement) {
    if (el.scrollHeight <= el.clientHeight + 1 || !/(auto|scroll)/.test(getComputedStyle(el).overflowY)) continue;
    if (dy < 0 ? el.scrollTop > 0 : el.scrollTop + el.clientHeight < el.scrollHeight - 1) return true;
  }
  return false;
}

const isEditable = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable]');

/** how far a swipe pulls before it tucks (wheel delta), and how far a right-drag must go (px) */
const PULL = 150;
const DRAG_DOWN = 90;
const DRAG_RIGHT = 120;
const SLIDE_MS = 220;

export function useTuck<T extends HTMLElement>(opts: { minimized: boolean; onTuck: () => void }) {
  const ref = useRef<T>(null);
  const [off, setOff] = useState<{ x: number; y: number } | null>(null);
  const [tucking, setTucking] = useState(false);
  const g = useRef<{ pull: number; lastScroll: number; timer?: ReturnType<typeof setTimeout>; drag: { x: number; y: number; id: number } | null }>({ pull: 0, lastScroll: 0, drag: null });
  const onTuck = useRef(opts.onTuck);
  onTuck.current = opts.onTuck;

  const tuck = () => {
    setTucking(true);
    setOff(null);
    (document.activeElement as HTMLElement | null)?.blur?.();
    setTimeout(() => {
      setTucking(false);
      onTuck.current();
    }, SLIDE_MS);
  };
  const tuckRef = useRef(tuck);
  tuckRef.current = tuck;

  useEffect(() => {
    const el = ref.current;
    if (!el || opts.minimized) return;
    const s = g.current;
    const pullBy = (e: WheelEvent) => {
      e.preventDefault();
      s.pull += -e.deltaY;
      clearTimeout(s.timer);
      if (s.pull > PULL) {
        s.pull = 0;
        tuckRef.current();
        return;
      }
      setOff({ x: 0, y: Math.min(120, s.pull * 0.6) });
      s.timer = setTimeout(() => {
        s.pull = 0;
        setOff(null);
      }, 200);
    };
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      const now = performance.now();
      if (canScroll(e.target as HTMLElement, el, e.deltaY)) {
        s.lastScroll = now;
        s.pull = 0;
        return;
      }
      if (e.deltaY >= 0 || now - s.lastScroll < 350) return;
      pullBy(e);
    };
    // a pull that began on the panel goes on while the fingers keep moving: the panel slides out from
    // under the cursor, and those wheel events must not reach (and zoom) the 3D view underneath
    const onAnyWheel = (e: WheelEvent) => {
      if (s.pull <= 0 || e.deltaY >= 0 || el.contains(e.target as Node)) return;
      e.stopPropagation();
      pullBy(e);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('wheel', onAnyWheel, { capture: true, passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      window.removeEventListener('wheel', onAnyWheel, { capture: true });
      clearTimeout(s.timer);
    };
  }, [opts.minimized]);

  const up = (e: ReactPointerEvent) => {
    const d = g.current.drag;
    if (!d || d.id !== e.pointerId) return;
    g.current.drag = null;
    if (e.clientY - d.y > DRAG_DOWN || e.clientX - d.x > DRAG_RIGHT) tuck();
    else setOff(null);
  };
  const handlers = {
    onContextMenu: (e: ReactMouseEvent) => {
      if (!isEditable(e.target)) e.preventDefault();
    },
    onPointerDown: (e: ReactPointerEvent) => {
      if (e.button !== 2 || isEditable(e.target)) return;
      g.current.drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: ReactPointerEvent) => {
      const d = g.current.drag;
      if (d && d.id === e.pointerId) setOff({ x: Math.max(-30, e.clientX - d.x), y: Math.max(-30, e.clientY - d.y) });
    },
    onPointerUp: up,
    onPointerCancel: up,
  };
  return { ref, off, tucking, tuck, handlers };
}

/** two fingers up on a docked chip (natural scrolling: deltaY > 0) brings the panel back */
export function useDockPull(restore: () => void) {
  const pull = useRef(0);
  return (e: { deltaY: number }) => {
    pull.current = e.deltaY > 0 ? pull.current + e.deltaY : 0;
    if (pull.current > 80) {
      pull.current = 0;
      restore();
    }
  };
}
