/**
 * Floor 2 and the elevators: the storey model (shared/floors.ts), the bank's logic
 * (client/src/world/elevatorModel.ts) and the server's view of a player upstairs.
 */
import { describe, expect, it } from 'vitest';
import { LAYOUTS, roomAt, roomById } from '../shared/layout';
import { elevatorBanks, levelAtHeight, levelY, locationLabel, onSlab, roomAnyLevel, roomAtLevel, shaftExtent, upperLevels, walkSecondsAny } from '../shared/floors';
import { ElevatorBank, doorEase, rideProfile, type CarState } from '../client/src/world/elevatorModel';
import { standHeight } from '../client/src/world/stairs';
import { NpcBrain } from '../server/npc/brain';
import { GameSession } from '../server/sim/session';

const ed = LAYOUTS.ed;
const [ward] = upperLevels(ed);
const inside = (r: { x: number; z: number; w: number; d: number }, x: number, z: number) => x > r.x && x < r.x + r.w && z > r.z && z < r.z + r.d;

describe('Floor 2 (shared/floors.ts)', () => {
  it('sits on the east wing at the stair landing’s height, with its rooms inside its outline', () => {
    expect(ward.y).toBe(3.0);
    // Stair 1's upper landing is the floor up there
    const landing = ed.landings!.find((l) => l.id === 'stair1_upper')!;
    expect(landing.y).toBe(ward.y);
    for (const r of ward.rooms) {
      expect(r.rect.x, r.id).toBeGreaterThanOrEqual(ward.outline.x);
      expect(r.rect.x + r.rect.w, r.id).toBeLessThanOrEqual(ward.outline.x + ward.outline.w + 1e-9);
      expect(r.rect.z + r.rect.d, r.id).toBeLessThanOrEqual(ward.outline.z + ward.outline.d + 1e-9);
    }
  });

  it('has an inpatient unit: a lobby, a corridor, a nurses’ station, 4–6 patient rooms, a medication room and a lounge', () => {
    const ids = ward.rooms.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining(['f2_lobby', 'f2_corridor', 'f2_station', 'f2_meds', 'f2_lounge']));
    const patientRooms = ids.filter((id) => /^f2_room_/.test(id));
    expect(patientRooms.length).toBeGreaterThanOrEqual(4);
    expect(patientRooms.length).toBeLessThanOrEqual(6);
    // every patient room has a bed and a window; the corridor is as wide as the hospital street below
    for (const id of patientRooms) {
      expect(ward.props.some((p) => p.room === id && p.kind === 'bed'), id).toBe(true);
      expect(ward.windows.some((w) => w.room === id), id).toBe(true);
    }
    expect(roomAnyLevel(ed, 'f2_corridor')!.rect.d).toBe(roomById(ed, 'street')!.rect.d);
  });

  it('keeps room ids unique across storeys, and the ground floor’s room list (agents’ move tool) unchanged', () => {
    const ground = new Set(ed.rooms.map((r) => r.id));
    for (const r of ward.rooms) expect(ground.has(r.id), r.id).toBe(false);
    expect(ed.rooms.some((r) => r.id.startsWith('f2_'))).toBe(false);
  });

  it('looks rooms up per storey: the same spot is the cafeteria downstairs and Room 203 upstairs', () => {
    expect(roomAt(ed, 66, 5)?.id).toBe('cafeteria');
    expect(roomAtLevel(ed, 66, 5, 0)?.id).toBe('cafeteria');
    expect(roomAtLevel(ed, 66, 5, 1)?.id).toBe('f2_room_203');
    expect(roomAtLevel(ed, 60, 11, 1)?.id).toBe('f2_corridor');
    expect(roomAtLevel(ed, 60, 14, 1)?.id).toBe('f2_station');
    // the stair core rises through Floor 2: up there it is still Stair 1
    expect(roomAtLevel(ed, 50.2, 4.6, 1)?.id).toBe('stairs');
  });

  it('labels upstairs locations for the HUD and leaves the ground floor’s as they were', () => {
    expect(locationLabel(ed, 'f2_station')).toBe("Floor 2 · Nurses' station");
    expect(locationLabel(ed, 'f2_room_205')).toBe('Floor 2 · Room 205');
    expect(locationLabel(ed, 'cafeteria')).toBe('Cafeteria');
    expect(locationLabel(ed, 'bed_4')).toBe('Bed 4');
  });

  it('has a slab everywhere but over the stair core, and a threshold through Stair 1’s door', () => {
    expect(onSlab(ward, 60, 11)).toBe(true);
    expect(onSlab(ward, 49.5, 5)).toBe(false); // the stairwell
    expect(onSlab(ward, 50.95, 4.6)).toBe(true); // through the double wall at the landing
    expect(levelAtHeight(ed, 0)).toBe(0);
    expect(levelAtHeight(ed, 3.0)).toBe(1);
    expect(levelY(ed, 1)).toBe(3.0);
  });

  it('opens Stair 1 onto Floor 2: a door in the core’s east wall at the upper landing, on the lobby’s stair door', () => {
    const stairs = roomById(ed, 'stairs')!;
    const door = stairs.doors.find((d) => d.side === 'e' && (d.y ?? 0) > 0)!;
    expect(door.y).toBe(3.0);
    const landing = ed.landings!.find((l) => l.id === 'stair1_upper')!;
    const z0 = stairs.rect.z + door.offset;
    expect(z0).toBeGreaterThanOrEqual(landing.rect.z);
    expect(z0 + door.width).toBeLessThanOrEqual(landing.rect.z + landing.rect.d);
    const lobby = roomAnyLevel(ed, 'f2_lobby')!;
    const lobbyDoor = lobby.doors.find((d) => d.side === 'w')!;
    expect(lobby.rect.z + lobbyDoor.offset).toBeCloseTo(z0, 6);
    expect(lobbyDoor.width).toBe(door.width);
    // walking height: the landing, through the door, onto the floor
    expect(standHeight(ed, 50.3, 4.6)).toBe(3.0);
  });

  it('times walks between storeys via the elevator lobby, and keeps ground-floor walks as before', () => {
    expect(walkSecondsAny(ed, 'station', 'lobby')).toBeGreaterThan(15);
    const up = walkSecondsAny(ed, 'lobby', 'f2_station');
    expect(up).toBeGreaterThan(25);
    expect(up).toBeLessThan(60);
    expect(walkSecondsAny(ed, 'f2_lobby', 'f2_room_206')).toBeLessThan(30);
  });

  it('builds the elevator shafts behind the lobby’s north wall, clear of the building', () => {
    const [bank] = elevatorBanks(ed);
    const sh = shaftExtent(bank);
    expect(sh.z1).toBe(0);
    expect(sh.z0).toBeLessThan(-bank.car.d);
    const lobby = roomById(ed, 'lobby')!;
    for (const c of bank.cars) {
      expect(c.x - bank.car.w / 2).toBeGreaterThan(sh.x0);
      expect(c.x + bank.car.w / 2).toBeLessThan(sh.x1);
      // the lobby wall has an opening at each car, on both storeys
      expect(lobby.doors.some((d) => d.side === 'n' && Math.abs(lobby.rect.x + d.offset + d.width / 2 - c.x) < 0.05)).toBe(true);
      expect(roomAnyLevel(ed, 'f2_lobby')!.doors.some((d) => d.side === 'n' && Math.abs(51 + d.offset + d.width / 2 - c.x) < 0.05)).toBe(true);
    }
    for (const r of ed.rooms) if (r.kind !== 'exterior') expect(inside(r.rect, (sh.x0 + sh.x1) / 2, (sh.z0 + sh.z1) / 2), r.id).toBe(false);
  });
});

describe('the server with a player upstairs', () => {
  const brain = new NpcBrain(null); // offline, deterministic
  it('accepts Floor 2 rooms as locations (the HUD), with the same seed giving the same shift', async () => {
    const run = async (visit: boolean) => {
      const s = new GameSession({ scenarioId: 'night_shift', seed: 7, playerName: 'Test', mode: 'step', brain });
      if (visit) {
        for (const to of ['lobby', 'f2_lobby', 'f2_station', 'f2_room_205', 'f2_lobby', 'lobby']) {
          const r = await s.act({ type: 'move', to });
          expect(r.ok, to).toBe(true);
          expect(s.playerLocation).toBe(to);
        }
      }
      return s;
    };
    const s = await run(true);
    expect((await s.act({ type: 'move', to: 'f2_nowhere' })).ok).toBe(false);
    // a detour upstairs only costs walking time: at the same game time the shift is the same
    const a = await run(false);
    const b = await run(true);
    const target = Math.max(a.t, b.t) + 40 * 60;
    a.advance(target - a.t);
    b.advance(target - b.t);
    const summary = (x: GameSession) => [...x.patients.values()].map((p) => [p.id, p.bed, p.arrived, x.trueVitals(p).hr.toFixed(1)]);
    expect(summary(b)).toEqual(summary(a));
  });
});

describe('elevator bank (elevatorModel.ts)', () => {
  const Y = (l: number) => l * 3;
  const step = (bank: ElevatorBank, secs: number, doorway: (c: CarState) => boolean = () => false) => {
    for (let t = 0; t < secs; t += 1 / 60) bank.update(1 / 60, doorway);
  };

  it('answers a hall call with the car already there: doors open, with a chime', () => {
    const bank = new ElevatorBank(['A', 'B'], [0, 1], Y, undefined, [0, 1]);
    const events: string[] = [];
    bank.on((e) => events.push(e.kind));
    const car = bank.call(0, 'up');
    expect(car.id).toBe('A');
    step(bank, 2);
    expect(car.phase).toBe('open');
    expect(bank.passable(car, 0)).toBe(true);
    expect(events).toContain('arrive');
  });

  it('rides: doors close, a smooth ride (no step in speed), a chime, doors open on the other floor', () => {
    const bank = new ElevatorBank(['A'], [0, 1], Y, undefined, [0]);
    const car = bank.car('A')!;
    bank.call(0);
    step(bank, 2);
    bank.send('A', 1);
    let maxJump = 0;
    let prevV = 0;
    let moved = false;
    let arrivedDir: string | null = null;
    bank.on((e) => {
      if (e.kind === 'arrive') arrivedDir = e.dir;
    });
    for (let t = 0; t < 14; t += 1 / 60) {
      bank.update(1 / 60);
      if (car.ride) {
        moved = true;
        // never moving with the doors open
        expect(car.door).toBe(0);
        expect(bank.passable(car, 0)).toBe(false);
        expect(bank.passable(car, 1)).toBe(false);
      }
      maxJump = Math.max(maxJump, Math.abs(car.v - prevV));
      prevV = car.v;
    }
    expect(moved).toBe(true);
    expect(car.y).toBe(3);
    expect(car.level).toBe(1);
    expect(car.phase === 'open' || car.phase === 'opening').toBe(true);
    // jerk-limited: speed changes by tiny steps per frame
    expect(maxJump).toBeLessThan(0.03);
    expect(arrivedDir).toBe('down');
  });

  it('never closes on someone in the doorway, and reverses closing doors (light curtain)', () => {
    const bank = new ElevatorBank(['A'], [0, 1], Y, undefined, [0]);
    const car = bank.car('A')!;
    bank.call(0);
    step(bank, 2);
    bank.send('A', 1);
    // someone stands in the doorway: the doors stay open, the car stays
    step(bank, 12, () => true);
    expect(car.phase).toBe('open');
    expect(car.ride).toBe(null);
    // they step in; the doors start closing; someone steps into them again: they reopen
    step(bank, 1.6 + 0.4);
    expect(car.phase).toBe('closing');
    step(bank, 0.2, () => true);
    expect(car.phase === 'opening' || car.phase === 'open').toBe(true);
    // clear: it goes
    step(bank, 14);
    expect(car.level).toBe(1);
  });

  it('opens a parked car from inside at once (nobody is trapped), but not mid-ride', () => {
    const bank = new ElevatorBank(['A'], [0, 1], Y, undefined, [0]);
    const car = bank.car('A')!;
    expect(car.phase).toBe('closed');
    expect(bank.open('A')).toBe(true);
    step(bank, 2);
    expect(car.phase).toBe('open');
    bank.send('A', 1);
    step(bank, 0.9 + 2.2 + 0.7);
    expect(!!car.ride).toBe(true);
    expect(bank.open('A')).toBe(false);
    expect(car.door).toBe(0);
  });

  it('a floor pressed while the doors are still opening: they close after a short dwell, not the full one', () => {
    const bank = new ElevatorBank(['A'], [0, 1], Y, undefined, [0]);
    const car = bank.car('A')!;
    bank.call(0);
    step(bank, 0.8);
    expect(car.phase).toBe('opening');
    bank.send('A', 1);
    // 0.8 s more to open fully, ~0.9 s dwell, then closing (the full dwell would keep them open 4.5 s)
    step(bank, 0.8 + 1.2);
    expect(car.phase).toBe('closing');
    step(bank, 2.2 + 0.6 + 5.5 + 0.2);
    expect(car.level).toBe(1);
  });

  it('sends the nearest idle car to a call, and serves both floors', () => {
    const bank = new ElevatorBank(['A', 'B'], [0, 1], Y, undefined, [0, 0]);
    const c = bank.call(1, 'down');
    // start 0.6 s + ride 5 s + doors 1.6 s, then a 4.5 s dwell
    step(bank, 9);
    expect(c.level).toBe(1);
    expect(c.phase === 'open' || c.phase === 'opening').toBe(true);
    // the other car is still downstairs
    expect(bank.cars.find((x) => x !== c)!.level).toBe(0);
  });

  it('eases doors and rides in and out', () => {
    expect(doorEase(0)).toBe(0);
    expect(doorEase(1)).toBe(1);
    expect(rideProfile(0)).toBe(0);
    expect(rideProfile(1)).toBeCloseTo(1, 9);
    expect(rideProfile(0.5)).toBeCloseTo(0.5, 9);
  });
});
