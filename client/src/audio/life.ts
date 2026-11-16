/**
 * The department's working noise, all positional and muffled by walls:
 *  - desk phones ring at the station and in the workroom now and then (2 s on / 4 s off); a nurse,
 *    clerk or doctor nearby picks up after a couple of rings (handset click, an optional spoken
 *    greeting, hang-up later). Nobody near: it rings out. Never while you're on that phone.
 *  - the station printer prints a job now and then, and the label printer runs when labs are ordered
 *  - infusion pumps alert ("infusion complete", "occlusion") at bays whose chart shows a running
 *    infusion, until a nurse silences them
 *  - staff seated at desks type; the nurse-call annunciator chimes when a roomed patient presses
 *    the call button; pneumatic-tube carriers arrive at the station
 *  - far away inside the building: carts rolling, doors closing
 */
import type { LayoutDef } from '../../../shared/layout';
import type { NpcView, PatientChart, PlayerView } from '../../../shared/types';
import { Emitter, dB, type Engine, type Vec3, type Voice } from './engine';
import { cartRoll, deskRing, doorClose, handset, labelPrinter, mulberry, nurseCall, printerJob, pumpBeeps, tubeArrival, typing } from './synth';

const LEVEL = {
  ring: dB(-18),
  handset: dB(-30),
  printer: dB(-29),
  label: dB(-31),
  pump: dB(-27),
  typing: dB(-33),
  call: dB(-27),
  tube: dB(-27),
  cart: dB(-27),
  door: dB(-26),
};
const STAFF = new Set(['nurse', 'clerk', 'tech', 'attending', 'resident']);

/** a staff member picked up a phone; returns how long the call lasts (s), if it knows */
export type Answer = (who: NpcView, at: Vec3, place: string) => number | void;

interface Phone {
  pos: Vec3;
  em: Emitter;
  place: string;
  every: [number, number];
  nextAt: number;
  ring?: { bursts: number; played: number; nextBurst: number; answerer?: NpcView; burst?: Voice };
  hangupAt: number;
  pitch: number;
}

interface Typist {
  em: Emitter;
  nextAt: number;
  voice?: Voice;
  stopAt: number;
  seen: number;
}

interface Pump {
  em: Emitter;
  nextAt: number;
  until: number;
  beepAt: number;
}

export class Life {
  private rand = mulberry(53);
  private phones: Phone[] = [];
  private printer?: { em: Emitter; nextAt: number; labelsAt: number };
  private pumps = new Map<string, Pump>();
  private typists = new Map<string, Typist>();
  private call?: { em: Emitter; nextAt: number; until: number; chimeAt: number };
  private tube?: { em: Emitter; nextAt: number };
  private farAt = 0;
  private farEm: Emitter[] = [];
  private pendingLabs = -1;
  private view: PlayerView | null = null;
  private charts: Record<string, PatientChart> = {};
  private ivPos = new Map<string, Vec3>();
  private bedPos = new Map<string, Vec3>();

  private snd: {
    ring: (() => AudioBuffer)[];
    pickup: () => AudioBuffer;
    hangup: () => AudioBuffer;
    labels: () => AudioBuffer;
    printer: () => AudioBuffer;
    pump: () => AudioBuffer;
    call: () => AudioBuffer;
    tube: () => AudioBuffer;
    typing: (() => AudioBuffer)[];
    cart: (() => AudioBuffer)[];
    swing: (() => AudioBuffer)[];
  };

  constructor(private eng: Engine, private layout: LayoutDef, private answer: Answer) {
    const sr = eng.sr;
    const four = [0, 1, 2, 3];
    this.snd = {
      ring: [eng.sound('ring:1', () => deskRing(sr, 1020, 1340)), eng.sound('ring:0.93', () => deskRing(sr, 1020 * 0.93, 1340 * 0.93))],
      pickup: eng.sound('pickup', () => handset(sr, mulberry(73), false)),
      hangup: eng.sound('hangup', () => handset(sr, mulberry(71), true)),
      labels: eng.sound('labels', () => labelPrinter(sr, mulberry(79))),
      printer: eng.sound('printer', () => printerJob(sr, mulberry(83))),
      pump: eng.sound('pump', () => pumpBeeps(sr)),
      call: eng.sound('call', () => nurseCall(sr)),
      tube: eng.sound('tube', () => tubeArrival(sr, mulberry(67))),
      typing: [0, 1, 2].map((k) => eng.sound(`typing:${k}`, () => typing(sr, mulberry(61 + k)))),
      cart: four.map((k) => eng.sound(`cart:${k}`, () => cartRoll(sr, mulberry(89 + k)))),
      swing: four.map((k) => eng.sound(`swing:${k}`, () => doorClose(sr, mulberry(97 + k)))),
    };
    for (const p of layout.props) {
      const pos = { x: p.x, y: (p.y ?? 0) + 0.15, z: p.z };
      if (p.kind === 'phone') {
        const station = layout.rooms.find((r) => r.id === p.room)?.kind === 'station';
        this.phones.push({ pos, em: new Emitter(eng, pos, { ref: 1.2, rolloff: 1.2, range: 32 }), place: p.room, every: station ? [150, 420] : [260, 700], nextAt: 0, hangupAt: 0, pitch: station ? 1 : 0.93 });
      } else if (p.kind === 'printer' && !this.printer) this.printer = { em: new Emitter(eng, pos, { ref: 1, rolloff: 1.5, range: 16 }), nextAt: 0, labelsAt: Infinity };
      else if (p.kind === 'ivPole' && p.bay) this.ivPos.set(p.bay, { x: p.x, y: 1.2, z: p.z });
      else if ((p.kind === 'bed' || p.kind === 'stretcher') && p.bay) this.bedPos.set(p.bay, { x: p.x, y: 0.9, z: p.z });
    }
    const st = layout.rooms.find((r) => r.kind === 'station');
    if (st) {
      this.call = { em: new Emitter(eng, { x: st.rect.x + st.rect.w / 2, y: 2.2, z: st.rect.z + st.rect.d / 2 }, { ref: 1.5, rolloff: 1.2, range: 26 }), nextAt: 0, until: 0, chimeAt: 0 };
      // the tube station sits at the closed west end of the island
      this.tube = { em: new Emitter(eng, { x: st.rect.x + 0.5, y: 1.2, z: st.rect.z + st.rect.d / 2 }, { ref: 1, rolloff: 1.4, range: 18 }), nextAt: 0 };
    }
    for (let i = 0; i < 2; i++) this.farEm.push(new Emitter(eng, { x: 0, y: 1, z: 0 }, { ref: 2, rolloff: 1, range: 60 }));
  }

  private between(a: number, b: number): number {
    return a + this.rand() * (b - a);
  }

  setView(v: PlayerView, charts: Record<string, PatientChart>): void {
    this.view = v;
    this.charts = charts;
    // labs just ordered: specimen labels print at the station a few seconds later
    const labs = v.board.reduce((n, r) => n + r.pendingLabs, 0);
    if (this.printer && this.pendingLabs >= 0 && labs > this.pendingLabs) this.printer.labelsAt = Math.min(this.printer.labelsAt, performance.now() / 1000 + this.between(2, 6));
    this.pendingLabs = labs;
  }

  frame(perfNow: number, night: boolean, inside: boolean, eachNpc: (fn: (v: NpcView, x: number, z: number, headY: number, moving: boolean) => void) => void): void {
    const v = this.view;
    if (!v) return;
    const staff: { v: NpcView; x: number; z: number; y: number }[] = [];
    eachNpc((n, x, z, y, moving) => {
      if (n.visible && STAFF.has(n.role)) {
        staff.push({ v: n, x, z, y });
        if (!moving && n.posture === 'sit' && /^desk/.test(n.spot)) this.typist(n.id, x, z, perfNow);
      }
    });
    this.phonesFrame(perfNow, night, staff);
    this.printerFrame(perfNow, night);
    this.pumpsFrame(perfNow);
    for (const [id, t] of this.typists) {
      t.em.update();
      if (perfNow - t.seen > 1) {
        t.voice?.stop(0.2);
        t.em.dispose();
        this.typists.delete(id);
      } else if (!t.voice && perfNow >= t.nextAt && t.em.inRange()) {
        const k = Math.floor(this.rand() * 3);
        const buf = this.snd.typing[k]();
        const len = this.between(1.8, 5.5);
        t.voice = t.em.play(buf, 0, { gain: LEVEL.typing, offset: this.rand() * (buf.duration - len), fadeIn: 0.05 }) ?? undefined;
        if (t.voice) this.eng.count('typing');
        t.stopAt = perfNow + len;
        t.nextAt = perfNow + len + this.between(2.5, 12);
      } else if (t.voice && perfNow >= t.stopAt) {
        t.voice.stop(0.12);
        t.voice = undefined;
      }
    }
    this.callFrame(perfNow, night);
    if (this.tube) {
      this.tube.em.update();
      if (!this.tube.nextAt) this.tube.nextAt = perfNow + this.between(60, 400);
      else if (perfNow >= this.tube.nextAt) {
        this.tube.nextAt = perfNow + this.between(night ? 400 : 240, night ? 900 : 600);
        if (this.tube.em.play(this.snd.tube(), 0, { gain: LEVEL.tube })) this.eng.count('tube');
      }
    }
    for (const e of this.farEm) e.update();
    if (inside && perfNow >= this.farAt) {
      this.farAt = perfNow + this.between(night ? 12 : 7, night ? 32 : 22);
      this.farEvent();
    }
  }

  private typist(id: string, x: number, z: number, perfNow: number): void {
    let t = this.typists.get(id);
    if (!t) {
      t = { em: new Emitter(this.eng, { x, y: 1.0, z }, { ref: 0.8, rolloff: 1.6, range: 9 }), nextAt: perfNow + this.between(1, 8), stopAt: 0, seen: perfNow };
      this.typists.set(id, t);
    }
    t.seen = perfNow;
  }

  private phonesFrame(perfNow: number, night: boolean, staff: { v: NpcView; x: number; z: number; y: number }[]): void {
    const v = this.view!;
    const l = this.eng.listener;
    for (const ph of this.phones) {
      ph.em.update();
      if (!ph.nextAt) ph.nextAt = perfNow + this.between(40, ph.every[1]);
      if (ph.hangupAt && perfNow >= ph.hangupAt) {
        ph.hangupAt = 0;
        ph.em.play(this.snd.hangup(), 0, { gain: LEVEL.handset });
      }
      const usingIt = v.player.focus === 'phone' && Math.hypot(l.x - ph.pos.x, l.z - ph.pos.z) < 4;
      if (!ph.ring) {
        if (perfNow < ph.nextAt || ph.hangupAt) continue;
        const k = night ? 1.5 : 1;
        ph.nextAt = perfNow + this.between(ph.every[0] * k, ph.every[1] * k);
        if (usingIt) continue;
        let best: (typeof staff)[number] | undefined;
        let bd = 8;
        for (const s of staff) {
          const d = Math.hypot(s.x - ph.pos.x, s.z - ph.pos.z);
          if (d < bd) {
            bd = d;
            best = s;
          }
        }
        ph.ring = { bursts: best ? 2 + Math.floor(this.rand() * 2) : 5, played: 0, nextBurst: perfNow, answerer: best?.v };
      }
      const r = ph.ring;
      if (usingIt) {
        r.burst?.stop(0.05);
        ph.ring = undefined;
        continue;
      }
      if (perfNow >= r.nextBurst) {
        if (r.played < r.bursts) {
          const buf = this.snd.ring[ph.pitch === 1 ? 0 : 1]();
          r.burst = ph.em.play(buf, 0, { gain: LEVEL.ring }) ?? undefined;
          r.played++;
          if (r.burst) this.eng.count('phone.ring');
          // answered within the 4 s gap after the last ring, else the next ring comes 6 s after this one
          r.nextBurst = perfNow + (r.played === r.bursts && r.answerer ? 2 + this.between(0.6, 1.8) : 6);
        } else {
          ph.ring = undefined;
          if (r.answerer) {
            ph.em.play(this.snd.pickup(), 0, { gain: LEVEL.handset });
            this.eng.count('phone.answered');
            const len = this.answer(r.answerer, ph.pos, ph.place);
            ph.hangupAt = perfNow + (typeof len === 'number' ? len : this.between(14, 45));
          }
        }
      }
    }
  }

  private printerFrame(perfNow: number, night: boolean): void {
    const p = this.printer;
    if (!p) return;
    p.em.update();
    if (!p.nextAt) p.nextAt = perfNow + this.between(30, 240);
    if (perfNow >= p.labelsAt) {
      p.labelsAt = Infinity;
      if (p.em.play(this.snd.labels(), 0, { gain: LEVEL.label })) this.eng.count('labels');
    }
    if (perfNow >= p.nextAt) {
      p.nextAt = perfNow + this.between(night ? 200 : 120, night ? 600 : 380);
      if (p.em.play(this.snd.printer(), 0, { gain: LEVEL.printer })) this.eng.count('printer');
    }
  }

  /** bays whose patient has an infusion running (charts the client has loaded) */
  private infusingBays(): Set<string> {
    const out = new Set<string>();
    const v = this.view!;
    for (const row of v.board) {
      if (row.flowStatus === 'Departed' || row.flowStatus === 'In imaging') continue;
      const c = this.charts[row.id];
      if (c && infusing(c)) out.add(row.bed);
    }
    return out;
  }

  private pumpsFrame(perfNow: number): void {
    const bays = this.infusingBays();
    for (const [bay, p] of this.pumps) {
      if (!bays.has(bay)) {
        p.em.dispose();
        this.pumps.delete(bay);
      }
    }
    for (const bay of bays) {
      let p = this.pumps.get(bay);
      if (!p) {
        const pos = this.ivPos.get(bay) ?? this.bedPos.get(bay);
        if (!pos) continue;
        p = { em: new Emitter(this.eng, pos, { ref: 1, rolloff: 1.4, range: 20 }), nextAt: perfNow + this.between(120, 600), until: 0, beepAt: 0 };
        this.pumps.set(bay, p);
      }
      p.em.update();
      if (perfNow >= p.nextAt && !p.until) {
        // alerting until the nurse comes: 20–70 s
        p.until = perfNow + this.between(20, 70);
        p.beepAt = perfNow;
      }
      if (p.until) {
        if (perfNow >= p.until) {
          p.until = 0;
          p.nextAt = perfNow + this.between(420, 1200);
        } else if (perfNow >= p.beepAt) {
          p.beepAt = perfNow + 3;
          if (p.em.play(this.snd.pump(), 0, { gain: LEVEL.pump })) this.eng.count('pump');
        }
      }
    }
  }

  private callFrame(perfNow: number, night: boolean): void {
    const c = this.call;
    if (!c) return;
    c.em.update();
    const roomed = this.view!.board.some((r) => r.flowStatus === 'Roomed');
    if (!c.nextAt) c.nextAt = perfNow + this.between(90, 500);
    if (!c.until && perfNow >= c.nextAt) {
      c.nextAt = perfNow + this.between(night ? 360 : 240, night ? 900 : 640);
      if (roomed) {
        c.until = perfNow + this.between(8, 35);
        c.chimeAt = perfNow;
      }
    }
    if (c.until) {
      if (perfNow >= c.until) c.until = 0;
      else if (perfNow >= c.chimeAt) {
        c.chimeAt = perfNow + 4;
        if (c.em.play(this.snd.call(), 0, { gain: LEVEL.call })) this.eng.count('nurse.call');
      }
    }
  }

  /** something happening somewhere else in the building, 12–30 m away */
  private farEvent(): void {
    const l = this.eng.listener;
    const em = this.farEm.find((e) => !e.busy);
    if (!em) return;
    for (let i = 0; i < 8; i++) {
      const a = this.rand() * Math.PI * 2;
      const r = this.between(12, 30);
      const x = l.x + Math.cos(a) * r;
      const z = l.z + Math.sin(a) * r;
      if (x < 1 || z < 1 || x > this.layout.width - 1 || z > this.layout.depth - 1) continue;
      em.setPosition({ x, y: 0.8, z }, true);
      em.update();
      const cart = this.rand() < 0.62;
      const k = Math.floor(this.rand() * 4);
      const buf = (cart ? this.snd.cart : this.snd.swing)[k]();
      if (em.play(buf, 0, { gain: cart ? LEVEL.cart : LEVEL.door, rate: 0.92 + this.rand() * 0.16 })) this.eng.count(cart ? 'far.cart' : 'far.door');
      return;
    }
  }

  stop(): void {
    for (const ph of this.phones) {
      ph.ring?.burst?.stop(0.05);
      ph.ring = undefined;
    }
    for (const t of this.typists.values()) {
      t.voice?.stop(0.05);
      t.voice = undefined;
    }
    for (const p of this.pumps.values()) p.until = 0;
    if (this.call) this.call.until = 0;
  }

  dispose(): void {
    this.stop();
    for (const ph of this.phones) ph.em.dispose();
    this.printer?.em.dispose();
    for (const p of this.pumps.values()) p.em.dispose();
    for (const t of this.typists.values()) t.em.dispose();
    this.call?.em.dispose();
    this.tube?.em.dispose();
    for (const e of this.farEm) e.dispose();
  }
}

/** a running infusion: an IV infusion/bolus the MAR shows started and not stopped, or an active drip order */
export function infusing(c: PatientChart): boolean {
  const running = new Set<string>();
  for (const e of [...c.mar].sort((a, b) => a.t - b.t)) {
    const key = e.orderId ?? e.med;
    if (e.status === 'Started') running.add(key);
    else if (e.status === 'Stopped') running.delete(key);
  }
  if (running.size) return true;
  return c.orders.some((o) => o.category === 'med' && o.status === 'Active' && /infusion|drip|continuous/i.test(`${o.name} ${o.params?.route ?? ''} ${o.params?.frequency ?? ''}`));
}
