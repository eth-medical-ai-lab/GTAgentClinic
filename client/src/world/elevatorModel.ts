/**
 * Elevator bank logic (no three.js, so tests and NPCs can drive it): cars with doors, hall calls
 * (the ▲/▼ buttons in a lobby), car calls (the buttons inside), dispatch, and a smooth,
 * jerk-limited ride profile.
 *
 * Safety rules the world relies on:
 *   - a car only moves with its doors fully closed, and its doors only open at a landing;
 *   - closing doors reverse whenever someone is in the doorway (the light curtain), and an open
 *     door stays open while someone stands in it;
 *   - someone inside a parked car with closed doors is never stuck: `open()` (walking up to the
 *     doors, or the door-open button) opens them at once.
 *
 * API for other systems (NPCs riding later):
 *   bank.call(level, dir)      press a hall button; returns the car that answers
 *   bank.send(carId, level)    press a floor button inside a car
 *   bank.open(carId)           door-open button / light curtain
 *   bank.on(fn)                events: arrive (with the lantern direction), depart, doors, call
 *   bank.update(dt, sense)     advance; `sense(car)` says whether its doorway is occupied
 */

export type Dir = 'up' | 'down';
export type DoorPhase = 'closed' | 'opening' | 'open' | 'closing';

export interface CarState {
  readonly id: string;
  /** floor height of the car (m) */
  y: number;
  /** the landing it is at, or the one it left / is passing (nearest) */
  level: number;
  /** a ride in progress: elapsed seconds and its duration */
  ride: { from: number; to: number; t: number; T: number } | null;
  /** 0 closed … 1 fully open */
  door: number;
  phase: DoorPhase;
  /** seconds the doors stay fully open before closing */
  dwell: number;
  /** landings this car must stop at (car calls and the hall calls it took) */
  stops: Set<number>;
  /** car calls only (lights the buttons inside) */
  calls: Set<number>;
  /** direction shown by the hall lantern / the car's arrow while the doors are open, or of travel */
  dir: Dir | null;
  /** seconds since the brake released (motor start) for the current ride, or −1 */
  departIn: number;
  /** speed (m/s, signed) and acceleration (m/s²) of the car this frame */
  v: number;
  a: number;
  /** a floor was pressed inside while the doors were opening: they close after a short dwell */
  hurry?: boolean;
}

export interface BankSave {
  cars: (Omit<CarState, 'stops' | 'calls'> & { stops: number[]; calls: number[] })[];
  hall: [number, Dir[]][];
}

export type ElevatorEvent =
  | { kind: 'arrive'; car: CarState; level: number; dir: Dir | null }
  | { kind: 'depart'; car: CarState; from: number; to: number }
  | { kind: 'doors'; car: CarState; opening: boolean }
  | { kind: 'call'; level: number; dir: Dir; car: CarState }
  | { kind: 'press'; car: CarState; level: number };

export interface BankTiming {
  /** door travel times (s) */
  open: number;
  close: number;
  /** doors fully open before they close (s) */
  dwell: number;
  /** brake release → motion (s) */
  start: number;
  /** ride between adjacent landings (s, for ~3 m) */
  ride: number;
}

export const DEFAULT_TIMING: BankTiming = { open: 1.6, close: 2.1, dwell: 4.5, start: 0.6, ride: 5.0 };

/** door opening fraction → leaf position: eases in and out like a VVVF door operator */
export function doorEase(p: number): number {
  const t = Math.max(0, Math.min(1, p));
  return t * t * (3 - 2 * t);
}

/**
 * Ride profile: fraction of the distance covered at fraction u of the ride time. Velocity is
 * 1 − cos(2πu) (zero at both ends) and so is acceleration, so the start and stop are jerk-free.
 */
export function rideProfile(u: number): number {
  const t = Math.max(0, Math.min(1, u));
  return t - Math.sin(2 * Math.PI * t) / (2 * Math.PI);
}

export class ElevatorBank {
  readonly cars: CarState[];
  /** pending hall calls: level → directions pressed */
  readonly hall = new Map<number, Set<Dir>>();
  private listeners: ((e: ElevatorEvent) => void)[] = [];

  constructor(
    carIds: string[],
    readonly levels: number[],
    private levelY: (level: number) => number,
    readonly timing: BankTiming = DEFAULT_TIMING,
    /** where each car starts (level index); default: spread over the landings */
    start?: number[],
  ) {
    this.cars = carIds.map((id, i) => {
      const level = start?.[i] ?? levels[i % levels.length];
      return { id, y: levelY(level), level, ride: null, door: 0, phase: 'closed', dwell: 0, stops: new Set(), calls: new Set(), dir: null, departIn: -1, v: 0, a: 0 };
    });
  }

  on(fn: (e: ElevatorEvent) => void): () => void {
    this.listeners.push(fn);
    return () => (this.listeners = this.listeners.filter((f) => f !== fn));
  }

  snapshot(): BankSave {
    return { cars: this.cars.map(c => ({ ...c, ride: c.ride && { ...c.ride }, stops: [...c.stops], calls: [...c.calls] })),
      hall: Array.from(this.hall, ([level, dirs]) => [level, [...dirs]]) };
  }

  restore(saved: BankSave) {
    for (const car of this.cars) {
      const row = saved.cars.find(c => c.id === car.id);
      if (row) Object.assign(car, row, { calls: new Set(row.calls), stops: new Set(row.stops) });
    }
    this.hall.clear();
    for (const [level, dirs] of saved.hall) this.hall.set(level, new Set(dirs));
  }

  private emit(e: ElevatorEvent) {
    for (const f of this.listeners) f(e);
  }

  car(id: string): CarState | undefined {
    return this.cars.find((c) => c.id === id);
  }

  /** the car standing at a landing (doors in any state), if one is */
  carAt(level: number): CarState | undefined {
    return this.cars.find((c) => !c.ride && c.departIn < 0 && c.level === level);
  }

  /** is this car's entrance at `level` open far enough to walk through? */
  passable(car: CarState, level: number): boolean {
    return !car.ride && car.departIn < 0 && car.level === level && car.door > 0.82;
  }

  private top(): number {
    return Math.max(...this.levels);
  }

  private bottom(): number {
    return Math.min(...this.levels);
  }

  /** press a hall button at `level`; the answering car (already there, or the best one to come) */
  call(level: number, dir?: Dir): CarState {
    const d: Dir = dir ?? (level >= this.top() ? 'down' : 'up');
    const here = this.carAt(level);
    if (here) {
      // a car is standing here: its doors open (again) for you
      here.dir = d;
      this.openDoors(here, true);
      this.emit({ kind: 'call', level, dir: d, car: here });
      return here;
    }
    let set = this.hall.get(level);
    if (!set) this.hall.set(level, (set = new Set()));
    set.add(d);
    // already coming?
    const coming = this.cars.find((c) => c.stops.has(level));
    if (coming) {
      this.emit({ kind: 'call', level, dir: d, car: coming });
      return coming;
    }
    // the nearest car with nothing to do, else the one with the fewest stops
    const cost = (c: CarState) => Math.abs(c.y - this.levelY(level)) + c.stops.size * 8 + (c.ride ? 4 : 0) + (c.phase !== 'closed' ? 2 : 0);
    const best = [...this.cars].sort((a, b) => cost(a) - cost(b))[0];
    best.stops.add(level);
    this.emit({ kind: 'call', level, dir: d, car: best });
    return best;
  }

  /** press a floor button inside a car */
  send(carId: string, level: number): boolean {
    const c = this.car(carId);
    if (!c || !this.levels.includes(level)) return false;
    if (!c.ride && c.departIn < 0 && c.level === level) {
      // the floor you're on: the doors open
      this.openDoors(c, false);
      return true;
    }
    if (c.stops.has(level) && c.calls.has(level)) return true;
    c.stops.add(level);
    c.calls.add(level);
    this.emit({ kind: 'press', car: c, level });
    // doors open (or opening): they close soon (no need to wait out the dwell)
    if (c.phase === 'open') c.dwell = Math.min(c.dwell, 0.9);
    if (c.phase === 'opening') c.hurry = true;
    return true;
  }

  /** door-open button / someone walking into the doors from inside: open at once if parked at a landing */
  open(carId: string): boolean {
    const c = this.car(carId);
    if (!c || c.ride) return false;
    if (c.departIn >= 0) {
      // the brake hasn't lifted yet: cancel the start (a real car would too)
      c.departIn = -1;
    }
    this.openDoors(c, false);
    return true;
  }

  private openDoors(c: CarState, hallCall: boolean) {
    if (c.ride) return;
    if (c.phase === 'open') {
      c.dwell = Math.max(c.dwell, this.timing.dwell);
      return;
    }
    if (c.phase !== 'opening') {
      c.phase = 'opening';
      this.emit({ kind: 'doors', car: c, opening: true });
    }
    if (hallCall && c.door < 0.05) this.emit({ kind: 'arrive', car: c, level: c.level, dir: c.dir });
  }

  /**
   * Advance by dt seconds. `doorway(car)` = something is in the car's entrance at its landing (the
   * light curtain); `inside(car)` = someone is in the car (keeps a parked car's doors honest).
   */
  update(dt: number, doorway: (c: CarState) => boolean = () => false) {
    const T = this.timing;
    for (const c of this.cars) {
      c.a = 0;
      const prevV = c.v;
      c.v = 0;
      // ── a ride in progress ──
      if (c.ride) {
        const r = c.ride;
        r.t = Math.min(r.T, r.t + dt);
        const y0 = this.levelY(r.from);
        const y1 = this.levelY(r.to);
        const u = r.t / r.T;
        c.y = y0 + (y1 - y0) * rideProfile(u);
        c.v = ((y1 - y0) / r.T) * (1 - Math.cos(2 * Math.PI * u));
        c.a = dt > 0 ? (c.v - prevV) / dt : 0;
        // the indicator shows the landing being passed / approached
        c.level = Math.abs(c.y - y0) < Math.abs(c.y - y1) ? r.from : r.to;
        if (r.t >= r.T) {
          c.y = y1;
          c.level = r.to;
          c.ride = null;
          c.v = 0;
          this.arrive(c);
        }
        continue;
      }
      // ── brake lift before the motor turns ──
      if (c.departIn >= 0) {
        c.departIn += dt;
        if (c.departIn >= T.start) {
          c.departIn = -1;
          const to = this.nextStop(c);
          if (to === null || to === c.level) continue;
          const span = Math.abs(this.levelY(to) - this.levelY(c.level));
          c.ride = { from: c.level, to, t: 0, T: T.ride * Math.max(0.6, Math.sqrt(span / 3)) };
          c.dir = to > c.level ? 'up' : 'down';
          this.emit({ kind: 'depart', car: c, from: c.level, to });
        }
        continue;
      }
      // ── doors ──
      const blocked = doorway(c);
      switch (c.phase) {
        case 'opening':
          c.door = Math.min(1, c.door + dt / T.open);
          if (c.door >= 1) {
            c.phase = 'open';
            c.dwell = c.hurry ? 0.9 : Math.max(c.dwell, T.dwell);
            c.hurry = false;
          }
          break;
        case 'open':
          if (blocked) c.dwell = Math.max(c.dwell, 1.6);
          else c.dwell -= dt;
          if (c.dwell <= 0) {
            c.phase = 'closing';
            this.emit({ kind: 'doors', car: c, opening: false });
          }
          break;
        case 'closing':
          if (blocked) {
            // light curtain: reverse
            c.phase = 'opening';
            this.emit({ kind: 'doors', car: c, opening: true });
            break;
          }
          c.door = Math.max(0, c.door - dt / T.close);
          if (c.door <= 0) c.phase = 'closed';
          break;
        case 'closed': {
          const to = this.nextStop(c);
          if (to === null) {
            c.dir = null;
            break;
          }
          if (to === c.level) {
            // a stop here (someone called while it was closing): open again
            c.stops.delete(to);
            c.calls.delete(to);
            this.clearHall(to);
            this.openDoors(c, true);
            break;
          }
          c.departIn = 0;
          c.dir = to > c.level ? 'up' : 'down';
          break;
        }
      }
    }
  }

  /** the next landing this car should go to (nearest stop in its direction, else any) */
  private nextStop(c: CarState): number | null {
    if (!c.stops.size) return null;
    const stops = [...c.stops];
    const ahead = stops.filter((l) => (c.dir === 'up' ? l > c.level : c.dir === 'down' ? l < c.level : true));
    const pool = ahead.length ? ahead : stops;
    return pool.sort((a, b) => Math.abs(a - c.level) - Math.abs(b - c.level))[0];
  }

  private clearHall(level: number) {
    this.hall.delete(level);
  }

  private arrive(c: CarState) {
    const level = c.level;
    c.stops.delete(level);
    c.calls.delete(level);
    // the lantern says where the car goes next: its remaining stops, else the hall call answered
    const pending = this.hall.get(level);
    const next = this.nextStop(c);
    let dir: Dir | null = next === null ? null : next > level ? 'up' : 'down';
    if (!dir && pending?.size) dir = pending.has('up') && level < this.top() ? 'up' : pending.has('down') && level > this.bottom() ? 'down' : [...pending][0];
    if (!dir) dir = level >= this.top() ? 'down' : level <= this.bottom() ? 'up' : null;
    c.dir = dir;
    this.clearHall(level);
    this.emit({ kind: 'arrive', car: c, level, dir });
    c.phase = 'opening';
    this.emit({ kind: 'doors', car: c, opening: true });
  }
}
