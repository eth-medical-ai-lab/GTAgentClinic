/**
 * Workstation logins (client/src/world/workstationPlan.ts, client/src/ui/quadMorph.ts): every
 * computer in the layout, the medication cabinet and the carts can be logged into; chairs count
 * only when they face the screen; the badge reader sits beside the keyboard within reach; and the
 * CSS matrix3d that grows AgentChart out of the monitor lands exactly on the screen's corners.
 * The 3D sequence itself is checked on the real GPU by tests/workstation-e2e.ts.
 */
import { describe, expect, it } from 'vitest';
import { LAYOUTS } from '../shared/layout';
import { planWorkstations } from '../client/src/world/workstationPlan';
import { homography, lerpQuad, mapPoint, quadTransform, rectQuad, type Quad } from '../client/src/ui/quadMorph';

// details.ts parks two workstations on wheels in the corridor, facing the bays
const WOWS = [
  { id: 'wow0', x: 10.0, z: 7.75, rot: Math.PI },
  { id: 'wow1', x: 21.6, z: 7.75, rot: Math.PI },
];
const angle = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

describe('workstation plans', () => {
  for (const [id, layout] of Object.entries(LAYOUTS)) {
    const plans = planWorkstations(layout, WOWS);

    it(`${id}: every computer and the med cabinet can be logged into`, () => {
      const devices = layout.props.filter((p) => p.kind === 'computer' || p.kind === 'medDispenser');
      expect(devices.length).toBeGreaterThan(10);
      for (const p of devices) expect(plans.find((w) => w.id === p.id), p.id).toBeTruthy();
      expect(plans.filter((w) => w.kind === 'wow')).toHaveLength(2);
      expect(new Set(plans.map((w) => w.id)).size).toBe(plans.length);
    });

    it(`${id}: a chair counts only when it faces the screen, close by`, () => {
      for (const w of plans) {
        if (!w.seat) continue;
        const toScreen = Math.atan2(w.screen.x - w.seat.x, w.screen.z - w.seat.z);
        expect(angle(w.seat.yaw, toScreen), w.id).toBeLessThan(1e-6);
        expect(Math.hypot(w.screen.x - w.seat.x, w.screen.z - w.seat.z), w.id).toBeLessThan(1.35);
        const chair = layout.props.find((p) => p.id === w.seat!.id)!;
        if (chair.kind === 'chair') expect(angle(chair.rot ?? 0, toScreen), `${w.id}: ${chair.id} faces it`).toBeLessThan(0.95);
      }
    });

    it(`${id}: the badge reader is beside the keyboard (or the cabinet's screen), within reach`, () => {
      for (const w of plans) {
        const right = { x: Math.cos(w.rot), z: -Math.sin(w.rot) };
        const dx = w.reader.x - w.keyboard.x;
        const dz = w.reader.z - w.keyboard.z;
        if (w.reader.mount === 'flat') {
          // on the user's right of the keyboard, at the work surface height, not under the screen
          expect(dx * right.x + dz * right.z, w.id).toBeGreaterThan(0.15);
          expect(Math.abs(w.reader.y - (w.keyboard.y - (w.kind === 'wow' ? 0.02 : 0.02))), w.id).toBeLessThan(0.03);
        } else {
          expect(Math.abs(w.reader.y - w.screen.y), w.id).toBeLessThan(0.12);
        }
        const from = w.seat ?? w.stand;
        expect(Math.hypot(w.reader.x - from.x, w.reader.z - from.z), w.id).toBeLessThan(0.95);
      }
    });
  }

  it('ed: clinical screens open for a doctor, front desks are staff-only', () => {
    const plans = new Map(planWorkstations(LAYOUTS.ed, WOWS).map((w) => [w.id, w]));
    const clinical = ['st_pc_1', 'st_pc_2', 'st_pc_3', 'st_pc_4', 'st_pc_5', 'st_pc_6', 'tr_pc', 'wr_pc_a', 'wr_pc_b', 'wr_pc_c', 'wow0', 'wow1', 'med_disp', 'ex1_pc', 'clh_pc'];
    for (const id of clinical) expect(plans.get(id)?.access, id).toBe('clinical');
    for (const id of ['w_pc', 'cl_pc']) expect(plans.get(id)?.access, id).toBe('staff');
    expect(plans.get('w_pc')?.staff).toEqual({ name: 'Registration workstation', line: "Sorry, Doc, that one's registration only." });
    expect(plans.get('cl_pc')?.staff?.name).toBe('Clinic reception workstation');
    expect(plans.get('st_pc_1')?.staff).toBeUndefined();
  });

  it('a new computer defaults by its room and desk: clinical in clinical rooms, staff-only elsewhere', () => {
    const ed = LAYOUTS.ed;
    const roomOf = (kind: string) => ed.rooms.find((r) => r.kind === kind)!;
    const at = (room: (typeof ed.rooms)[number]) => ({ x: room.rect.x + room.rect.w / 2, z: room.rect.z + room.rect.d / 2 });
    const resus = roomOf('resus');
    const hall = roomOf('corridor');
    const extra = [
      { id: 'new_resus_pc', kind: 'computer' as const, room: resus.id, ...at(resus), y: 0.9, rot: 0 },
      { id: 'new_hall_pc', kind: 'computer' as const, room: hall.id, ...at(hall), y: 0.9, rot: 0 },
      // an information desk in a clinical-looking place is still a front desk
      { id: 'info_desk', kind: 'desk' as const, room: resus.id, x: at(resus).x + 1.5, z: at(resus).z, label: 'Information' },
      { id: 'info_pc', kind: 'computer' as const, room: resus.id, x: at(resus).x + 1.5, z: at(resus).z, y: 0.78, rot: 0 },
    ];
    const plans = new Map(planWorkstations({ ...ed, props: [...ed.props, ...extra] }).map((w) => [w.id, w]));
    expect(plans.get('new_resus_pc')?.access).toBe('clinical');
    expect(plans.get('new_hall_pc')?.access).toBe('staff');
    expect(plans.get('info_pc')?.access).toBe('staff');
    expect(plans.get('info_pc')?.staff?.name).toBe('Information desk computer');
  });

  it('ed: the station and triage seat you, the carts have you stand, the cabinet opens the MAR', () => {
    const plans = new Map(planWorkstations(LAYOUTS.ed, WOWS).map((w) => [w.id, w]));
    for (const n of [1, 2, 3, 4, 5, 6]) expect(plans.get(`st_pc_${n}`)?.seat?.id).toBe(`st_chair_${n}`);
    expect(plans.get('w_pc')?.seat?.id).toBe('w_desk_chair');
    // the triage nurse's own chair (while she sits in it, the computer is in use: workstation.ts userAt)
    expect(plans.get('tr_pc')?.seat?.id).toBe('tr_desk_chair');
    // the attending's chair faces into the room, away from the screen: you stand at that one
    expect(plans.get('wr_pc_a')?.seat).toBeNull();
    expect(plans.get('wow0')).toMatchObject({ kind: 'wow', seat: null, bedside: 'bed_3', inspect: 'wow' });
    expect(plans.get('wow1')?.bedside).toBe('bed_6');
    expect(plans.get('med_disp')).toMatchObject({ kind: 'cabinet', section: 'mar', inspect: 'medDispenser', reader: { mount: 'wall' } });
    expect(plans.get('ex2_pc')?.bedside).toBe('exam_2');
    expect(plans.get('st_pc_3')?.bedside).toBeUndefined();
  });
});

describe('the AgentChart morph (matrix3d)', () => {
  const close = (p: [number, number], q: [number, number]) => {
    expect(p[0]).toBeCloseTo(q[0], 6);
    expect(p[1]).toBeCloseTo(q[1], 6);
  };

  it('puts the box corners on a perspective quad', () => {
    const q: Quad = [
      [612, 240],
      [1010, 262],
      [1001, 498],
      [618, 470],
    ];
    const m = homography(1580, 880, q)!;
    close(mapPoint(m, 0, 0), q[0]);
    close(mapPoint(m, 1580, 0), q[1]);
    close(mapPoint(m, 1580, 880), q[2]);
    close(mapPoint(m, 0, 880), q[3]);
  });

  it('is the identity at full size and a plain scale for an upright rectangle', () => {
    const id = homography(800, 450, rectQuad(0, 0, 800, 450))!;
    expect(id.map((v) => +v.toFixed(9))).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const s = homography(800, 450, rectQuad(100, 50, 400, 225))!;
    close(mapPoint(s, 400, 225), [300, 162.5]);
    expect(s[6]).toBe(0);
    expect(s[7]).toBe(0);
  });

  it('writes a column-major matrix3d and morphs through convex quads', () => {
    const q: Quad = [
      [10, 20],
      [300, 30],
      [290, 200],
      [15, 190],
    ];
    const css = quadTransform(400, 300, q)!;
    const n = css.slice('matrix3d('.length, -1).split(',').map(Number);
    expect(n).toHaveLength(16);
    // the translation is the top-left corner; z untouched
    expect([n[12], n[13], n[10], n[15]]).toEqual([10, 20, 1, 1]);
    const mid = lerpQuad(q, rectQuad(0, 0, 400, 300), 0.5);
    expect(mid[0]).toEqual([5, 10]);
    expect(homography(400, 300, mid)).not.toBeNull();
    expect(homography(400, 300, [[0, 0], [0, 0], [0, 0], [0, 0]])).toBeNull();
  });
});
