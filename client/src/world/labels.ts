/**
 * DOM overlay for NPC name tags and speech bubbles (cheaper and crisper than
 * text-in-3D). Positions are projected from 3D every frame by the world.
 */
import './world.css';
import { captionFor, revealed, type Caption } from '../ui/captions';

interface Entry {
  root: HTMLDivElement;
  name: HTMLSpanElement;
  dot: HTMLSpanElement;
  act: HTMLDivElement;
  bubble: HTMLDivElement;
  bubbleUntil: number;
  key: string;
  /** the bubble's whole line, its live caption (reveals in step with the voice), chars shown so far */
  full: string;
  cap?: Caption;
  shown: number;
}

/** a bubble shows at most this much: the latest part of a long line as it is said */
const BUBBLE_MAX = 150;

export class LabelLayer {
  readonly el: HTMLDivElement;
  private entries = new Map<string, Entry>();

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'wl-layer';
    container.appendChild(this.el);
  }

  ensure(id: string, name: string, title: string, dotColor: string | null, activity: string | undefined) {
    let e = this.entries.get(id);
    if (!e) {
      const root = document.createElement('div');
      root.className = 'wl-tag';
      const line = document.createElement('div');
      line.className = 'wl-line';
      const dot = document.createElement('span');
      dot.className = 'wl-dot';
      const nm = document.createElement('span');
      nm.className = 'wl-name';
      line.append(dot, nm);
      const act = document.createElement('div');
      act.className = 'wl-act';
      const bubble = document.createElement('div');
      bubble.className = 'wl-bubble';
      root.append(bubble, line, act);
      this.el.appendChild(root);
      e = { root, name: nm, dot, act, bubble, bubbleUntil: 0, key: '', full: '', shown: -1 };
      this.entries.set(id, e);
    }
    const key = `${name}|${title}|${dotColor}|${activity ?? ''}`;
    if (key !== e.key) {
      e.key = key;
      e.name.textContent = title ? `${name} · ${title}` : name;
      e.dot.style.display = dotColor ? 'inline-block' : 'none';
      if (dotColor) e.dot.style.background = dotColor;
      e.act.textContent = activity ?? '';
      e.act.style.display = activity ? 'block' : 'none';
    }
  }

  say(id: string, text: string, ms = 5500) {
    const e = this.entries.get(id);
    if (!e) return;
    // a spoken line has a live caption: the bubble then fills word by word as it is said (place())
    const cap = captionFor(id, text);
    if (cap && cap === e.cap) return; // same line again (re-render): keep streaming
    const clean = text.replace(/\s+/g, ' ').trim();
    e.full = clean;
    e.cap = cap;
    e.shown = -1;
    if (!cap) e.bubble.textContent = clean.length > BUBBLE_MAX ? clean.slice(0, BUBBLE_MAX - 3) + '…' : clean;
    e.bubbleUntil = performance.now() + ms;
    e.bubble.classList.add('on');
  }

  /** stream the bubble's caption: the words said so far (the tail of a long line) */
  private stream(e: Entry, now: number) {
    if (!e.cap) return;
    const n = Math.round((revealed(e.cap, now) / Math.max(1, e.cap.text.length)) * e.full.length);
    if (n === e.shown) return;
    e.shown = n;
    let s = e.full.slice(0, n);
    if (s.length > BUBBLE_MAX) s = '…' + s.slice(s.length - (BUBBLE_MAX - 1)).replace(/^\S*\s/, '');
    e.bubble.textContent = s || '…';
    // stay up while the line is being said, then a few seconds to finish reading
    e.bubbleUntil = Math.max(e.bubbleUntil, now + (n < e.full.length ? 2500 : 3000));
    if (n >= e.full.length) e.cap = undefined;
  }

  remove(id: string) {
    const e = this.entries.get(id);
    if (e) {
      e.root.remove();
      this.entries.delete(id);
    }
  }

  ids(): string[] {
    return [...this.entries.keys()];
  }

  /** visible tag (name) and/or bubble; bubble stays visible a bit farther than names */
  place(id: string, x: number, y: number, showTag: boolean, showBubble: boolean, scale = 1) {
    const e = this.entries.get(id);
    if (!e) return;
    const now = performance.now();
    this.stream(e, now);
    const bubbleOn = showBubble && e.bubbleUntil > now;
    if (e.bubbleUntil && e.bubbleUntil <= now) {
      e.bubble.classList.remove('on');
      e.bubbleUntil = 0;
    }
    if (!showTag && !bubbleOn) {
      e.root.style.display = 'none';
      return;
    }
    e.root.style.display = 'block';
    e.root.classList.toggle('notag', !showTag);
    // Up close, a speaker's head is near the top of the view and the bubble would ride off-screen.
    // Keep the whole tag on screen (its bottom sits at y): at least its own height plus a margin down.
    if (bubbleOn) y = Math.max(y, e.root.offsetHeight * scale + 10);
    e.root.style.transform = `translate(-50%, -100%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${scale.toFixed(3)})`;
  }

  dispose() {
    this.el.remove();
    this.entries.clear();
  }
}
