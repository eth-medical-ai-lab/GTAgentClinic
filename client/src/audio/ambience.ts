/**
 * The building's beds: HVAC room tone that changes a little with the room you stand in (corridor,
 * bay, waiting room, closed office…), outdoor air and distant traffic outside (and leaking in
 * through the exterior doors), and the electrical/mechanical hum of equipment near you: vending
 * machine, medication and drinks fridges (their compressors cycle), the CT gantry's cooling, the
 * station's computers, restroom exhaust fans.
 */
import { roomAt, type LayoutDef, type RoomDef, type RoomKind } from '../../../shared/layout';
import { Bed, Emitter, Loop, dB, type Engine, type Vec3 } from './engine';
import { hum, mulberry, outdoorBed, roomToneBed, thud, type HumKind } from './synth';

interface Tone {
  /** linear gain of the bed (its buffer is at −20 dBFS RMS) */
  g: number;
  /** low-pass corner: lower = more duct rumble, higher = more air */
  lp: number;
  /** diffuser hiss above 2.5 kHz */
  air: number;
}

const BY_KIND: Record<RoomKind, Tone> = {
  corridor: { g: dB(-24), lp: 520, air: 0.25 },
  station: { g: dB(-24), lp: 560, air: 0.25 },
  bay: { g: dB(-25), lp: 480, air: 0.2 },
  resus: { g: dB(-23), lp: 600, air: 0.3 },
  waiting: { g: dB(-25), lp: 450, air: 0.18 },
  triage: { g: dB(-27), lp: 450, air: 0.15 },
  room: { g: dB(-27), lp: 440, air: 0.15 },
  office: { g: dB(-29), lp: 400, air: 0.12 },
  utility: { g: dB(-27), lp: 520, air: 0.2 },
  imaging: { g: dB(-24), lp: 650, air: 0.3 },
  exterior: { g: 0, lp: 400, air: 0 },
};
const BY_ID: Record<string, Tone> = {
  stairs: { g: dB(-31), lp: 380, air: 0.1 },
  restrooms: { g: dB(-23), lp: 900, air: 0.35 },
  restroom_acc: { g: dB(-23), lp: 900, air: 0.35 },
};

const HUMS: Partial<Record<string, { kind: HumKind; gain: number; range: number; cycles?: boolean }>> = {
  vending: { kind: 'vending', gain: dB(-31), range: 7, cycles: true },
  fridge: { kind: 'fridge', gain: dB(-30), range: 6, cycles: true },
  drinksFridge: { kind: 'fridge', gain: dB(-28), range: 8, cycles: true },
  ctScanner: { kind: 'ct', gain: dB(-26), range: 13 },
  medDispenser: { kind: 'pc', gain: dB(-33), range: 4 },
  handDryer: { kind: 'exhaust', gain: dB(-34), range: 6 },
};

interface Hum {
  loop: Loop;
  base: number;
  cycles: boolean;
  /** compressor on/off schedule (perf s) */
  until: number;
  on: boolean;
}

interface ExtDoor {
  pos: Vec3;
}

export class Ambience {
  private hvac: Bed;
  private outdoor: Bed;
  private hums: Hum[] = [];
  private extDoors: ExtDoor[] = [];
  private rand = mulberry(7);
  private room: RoomDef | undefined;
  private roomAt = 0;
  private outside = false;
  private doorOpen: (pos: Vec3) => boolean = () => false;
  private clunk: () => AudioBuffer;
  /** built-in ambiences other systems can switch (startAmbience/stopAmbience 'hvac' | 'traffic') */
  hvacOn = true;
  trafficOn = true;

  constructor(private eng: Engine, private layout: LayoutDef) {
    const sr = eng.sr;
    this.hvac = new Bed(eng, eng.sound('bed:hvac', () => roomToneBed(sr, mulberry(11))), true);
    this.outdoor = new Bed(eng, eng.sound('bed:outdoor', () => outdoorBed(sr, mulberry(13))), false);
    this.clunk = eng.sound('thud', () => thud(sr, mulberry(23)));
    for (const p of layout.props) {
      const h = HUMS[p.kind];
      if (!h) continue;
      const em = new Emitter(eng, { x: p.x, y: (p.y ?? 0) + 1, z: p.z }, { ref: 1, rolloff: 1.6, range: h.range });
      const loop = new Loop(em, eng.sound(`hum:${h.kind}`, () => hum(sr, mulberry(17), h.kind)), h.gain, 1.5);
      this.hums.push({ loop, base: h.gain, cycles: !!h.cycles, until: 0, on: true });
    }
    // the station's six workstations and their fans: one quiet source in the middle of the island
    const st = layout.rooms.find((r) => r.kind === 'station');
    if (st) {
      const em = new Emitter(eng, { x: st.rect.x + st.rect.w / 2, y: 1.1, z: st.rect.z + st.rect.d / 2 }, { ref: 1, rolloff: 1.6, range: 6 });
      this.hums.push({ loop: new Loop(em, eng.sound('hum:pc', () => hum(sr, mulberry(19), 'pc')), dB(-31), 1.5), base: dB(-31), cycles: false, until: 0, on: true });
    }
    for (const r of layout.rooms) {
      for (const d of r.doors) {
        if (!d.exterior) continue;
        const along = d.offset + d.width / 2;
        const x = d.side === 'n' || d.side === 's' ? r.rect.x + along : d.side === 'w' ? r.rect.x : r.rect.x + r.rect.w;
        const z = d.side === 'e' || d.side === 'w' ? r.rect.z + along : d.side === 'n' ? r.rect.z : r.rect.z + r.rect.d;
        this.extDoors.push({ pos: { x, y: 1.5, z } });
      }
    }
  }

  /** tells whether a door (by position) stands open right now: exterior doors let the outside in */
  setDoorProbe(fn: (pos: Vec3) => boolean): void {
    this.doorOpen = fn;
  }

  /** the room the listener is in (refreshed 4× a second), undefined outdoors */
  get current(): RoomDef | undefined {
    return this.room;
  }

  get isOutside(): boolean {
    return this.outside;
  }

  frame(perfNow: number, clockHour: number, night: boolean): void {
    const l = this.eng.listener;
    if (perfNow >= this.roomAt) {
      this.roomAt = perfNow + 0.25;
      const r = roomAt(this.layout, l.x, l.z);
      const inside = l.x >= 0 && l.x <= this.layout.width && l.z >= 0 && l.z <= this.layout.depth;
      this.outside = r ? r.kind === 'exterior' : !inside;
      this.room = r && r.kind !== 'exterior' ? r : undefined;
    }
    // HVAC: per room; a closed department runs on night setback
    let tone: Tone = this.outside ? BY_KIND.exterior : this.room ? BY_ID[this.room.id] ?? BY_KIND[this.room.kind] : BY_KIND.corridor;
    const h = this.room?.hours;
    if (h && !(clockHour >= h[0] && clockHour < h[1])) tone = { ...tone, g: tone.g * dB(-4) };
    this.hvac.set(this.hvacOn ? tone.g : 0, tone.lp, tone.air);
    // outside: traffic and air (quieter at night); inside: what leaks through the nearest exterior door
    const traffic = this.trafficOn ? dB(night ? -27 : -23) : 0;
    if (this.outside) this.outdoor.set(traffic, 3200);
    else {
      let leak = 0;
      for (const d of this.extDoors) {
        const dist = Math.hypot(d.pos.x - l.x, d.pos.z - l.z);
        leak = Math.max(leak, Math.max(0, 1 - dist / 9) * (this.doorOpen(d.pos) ? 0.45 : 0.1));
      }
      this.outdoor.set(traffic * leak, 900);
    }
    for (const hm of this.hums) {
      if (hm.cycles && hm.until === 0) {
        hm.on = this.rand() < 0.6;
        hm.until = perfNow + 30 + this.rand() * 200;
        hm.loop.setGain(hm.on ? hm.base : hm.base * dB(-12), 0.05);
      } else if (hm.cycles && perfNow >= hm.until) {
        // compressors run a few minutes, rest a few minutes; the start is a soft clunk
        hm.on = !hm.on;
        hm.until = perfNow + (hm.on ? 180 + this.rand() * 300 : 120 + this.rand() * 240);
        if (hm.on && hm.loop.em.inRange()) this.eng.count('compressor.start');
        if (hm.on && hm.loop.em.inRange()) hm.loop.em.play(this.clunk(), 0, { gain: hm.base * 0.25, rate: 1.4 });
        hm.loop.setGain(hm.on ? hm.base : hm.base * dB(-12), 1.2);
      }
      hm.loop.em.update();
      hm.loop.update();
    }
  }

  /** ambience switched off: fade out and stop every source */
  stop(): void {
    this.hvac.halt();
    this.outdoor.halt();
    for (const hm of this.hums) hm.loop.stop();
  }

  dispose(): void {
    this.hvac.dispose();
    this.outdoor.dispose();
    for (const hm of this.hums) {
      hm.loop.stop(0.05);
      hm.loop.em.dispose();
    }
  }
}
